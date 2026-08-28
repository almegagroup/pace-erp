/*
 * File-Path: supabase/functions/api/_core/procurement/so_map.handlers.ts
 * Domain: PROCUREMENT / Sales
 * Purpose: SO Map (SO01 Tab 2) — FO-based (Dependent Direct/Depot/No-Inbound)
 *          and manual-Customer-Address-based allocation of Sales Order
 *          items, per feasibility doc §133.9 (2026-08-28). Independent Party
 *          / Independent Party (Asian-billed) SOs are Auto Mapped and never
 *          appear here.
 * Authority: Backend
 */

import type { ContextResolution } from "../../_pipeline/context.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { errorResponse, okResponse } from "../response.ts";
import { assertCompanyScope } from "../../_shared/companyScope.ts";
import { readAclSnapshotDecisionAny } from "../../_shared/acl_snapshot.ts";

type JsonRecord = Record<string, unknown>;
type ProcurementHandlerContext = {
  context: Extract<ContextResolution, { status: "RESOLVED" }>;
  request_id: string;
  auth_user_id: string;
  roleCode: string;
};

const MAPPABLE_DISPATCH_TYPES = new Set(["DEPENDENT_DIRECT", "DEPENDENT_DEPOT", "DEPENDENT_NO_INBOUND"]);
// §133.9 — the SKU-name-mismatch soft-warning exception is FG-only, and only
// for these 3 FG types. MTS/RM/PM/INT/SFG always hard-block a material mismatch.
const SKU_MISMATCH_EXEMPT_FG_TYPES = new Set(["MTO", "HPS", "MTEST"]);
const QTY_TOL = 0.0001;

function parseBody(req: Request): Promise<JsonRecord> {
  return req.json().catch(() => ({} as JsonRecord));
}
function toTrimmedString(value: unknown): string {
  return String(value ?? "").trim();
}
function toUpperTrimmedString(value: unknown): string {
  return toTrimmedString(value).toUpperCase();
}
function parsePositiveNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
function soMapErrorResponse(req: Request, ctx: ProcurementHandlerContext, code: string, status: number, message: string): Response {
  return errorResponse(code, message, ctx.request_id, "NONE", status, {}, req);
}
function getIdFromPath(req: Request): string {
  return new URL(req.url).pathname.split("/").filter(Boolean)[3] ?? "";
}

async function getCompanyScope(ctx: ProcurementHandlerContext, requestedCompanyId?: string): Promise<string> {
  const scopedCompanyId = toTrimmedString(ctx.context.companyId);
  const companyId = toTrimmedString(requestedCompanyId) || scopedCompanyId;
  if (companyId) await assertCompanyScope(ctx, companyId);
  return companyId;
}

// Same pattern as sales_order.handlers.ts's canMaintainSo01Create — SO Map's
// real resource_code is PROC_SO_LIST (view/EDIT-tier action) once wired in
// the ACL registry; this mirrors that convention so the same capability
// (Stores/Accounts/Logistics per §133.11) governs both.
async function canMaintainSoMap(ctx: ProcurementHandlerContext, companyId: string): Promise<boolean> {
  if (ctx.context.isAdmin) return true;
  if (!companyId) return false;
  let workContextIds: string[];
  if (companyId === ctx.context.companyId) {
    workContextIds = ctx.context.workContextIds && ctx.context.workContextIds.length > 0
      ? ctx.context.workContextIds
      : ctx.context.workContextId ? [ctx.context.workContextId] : [];
  } else {
    const { data: workContextRows, error: workContextError } = await serviceRoleClient
      .schema("erp_acl").from("user_work_contexts")
      .select("work_context:work_context_id!inner(work_context_id, is_active)")
      .eq("auth_user_id", ctx.auth_user_id).eq("company_id", companyId);
    if (workContextError) return false;
    workContextIds = ((workContextRows ?? []) as Array<{ work_context: unknown }>)
      .map((row) => {
        const wc = Array.isArray(row.work_context) ? row.work_context[0] : row.work_context;
        return wc && typeof wc === "object" ? (wc as { work_context_id: string; is_active: boolean }) : null;
      })
      .filter((wc): wc is { work_context_id: string; is_active: boolean } => Boolean(wc && wc.is_active === true))
      .map((wc) => wc.work_context_id);
  }
  if (workContextIds.length === 0) return false;
  const { data: versionRow, error: versionError } = await serviceRoleClient
    .schema("acl").from("acl_versions").select("acl_version_id")
    .eq("company_id", companyId).eq("is_active", true).single();
  if (versionError || !versionRow?.acl_version_id) return false;
  const { data, error } = await readAclSnapshotDecisionAny({
    db: serviceRoleClient, aclVersionId: versionRow.acl_version_id as string, authUserId: ctx.auth_user_id,
    companyId, workContextIds, resourceCode: "PROC_SO_LIST", actionCode: "EDIT",
  });
  if (error || !data) return false;
  return data.decision === "ALLOW";
}

async function fetchSoWithLines(soId: string): Promise<{ so: JsonRecord; lines: JsonRecord[] }> {
  const { data: so, error: soError } = await serviceRoleClient
    .schema("erp_procurement").from("sales_order").select("*").eq("id", soId).maybeSingle();
  if (soError || !so) throw new Error("SO_MAP_SO_NOT_FOUND");
  const { data: lines, error: lineError } = await serviceRoleClient
    .schema("erp_procurement").from("sales_order_line").select("*").eq("so_id", soId);
  if (lineError) throw new Error("SO_MAP_LINE_FETCH_FAILED");
  return { so: so as JsonRecord, lines: (lines ?? []) as JsonRecord[] };
}

async function fetchActiveAllocationsForSo(soId: string): Promise<JsonRecord[]> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement").from("sales_order_map_allocation")
    .select("*").eq("so_id", soId).eq("status", "ACTIVE");
  if (error) throw new Error("SO_MAP_ALLOCATION_FETCH_FAILED");
  return (data ?? []) as JsonRecord[];
}

// §133.9 — SOs needing SO Map action: DEPENDENT_* types only (Independent
// Party variants are Auto Mapped and excluded here).
export async function listSoForMapHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const url = new URL(req.url);
    const companyId = await getCompanyScope(ctx, toTrimmedString(url.searchParams.get("company_id")));
    if (!companyId) return soMapErrorResponse(req, ctx, "SO_MAP_COMPANY_REQUIRED", 400, "company_id is required.");
    try {
      await assertCompanyScope(ctx, companyId);
    } catch {
      return soMapErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }
    if (!(await canMaintainSoMap(ctx, companyId))) {
      return soMapErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have SO Map access at this company.");
    }

    const { data: sos, error: soError } = await serviceRoleClient
      .schema("erp_procurement").from("sales_order")
      .select("id, so_number, so_date, dispatch_type, status, material_types")
      .eq("company_id", companyId)
      .in("dispatch_type", Array.from(MAPPABLE_DISPATCH_TYPES))
      .not("status", "in", "(CANCELLED,CLOSED)")
      .order("so_date", { ascending: false });
    if (soError) return soMapErrorResponse(req, ctx, "SO_MAP_LIST_FAILED", 500, "Unable to list SOs pending mapping.");

    const soRows = (sos ?? []) as JsonRecord[];
    const soIds = soRows.map((row) => String(row.id));
    const [lineResp, allocResp] = await Promise.all([
      soIds.length
        ? serviceRoleClient.schema("erp_procurement").from("sales_order_line").select("id, so_id, quantity, base_qty").in("so_id", soIds)
        : Promise.resolve({ data: [], error: null }),
      soIds.length
        ? serviceRoleClient.schema("erp_procurement").from("sales_order_map_allocation").select("so_id, so_line_id, allocated_qty").in("so_id", soIds).eq("status", "ACTIVE")
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (lineResp.error) return soMapErrorResponse(req, ctx, "SO_MAP_LINE_FETCH_FAILED", 500, "Unable to load SO lines.");
    if (allocResp.error) return soMapErrorResponse(req, ctx, "SO_MAP_ALLOCATION_FETCH_FAILED", 500, "Unable to load allocations.");

    const totalBySoId = new Map<string, number>();
    for (const line of (lineResp.data ?? []) as JsonRecord[]) {
      const soId = String(line.so_id);
      const qty = Number(line.base_qty ?? line.quantity ?? 0);
      totalBySoId.set(soId, (totalBySoId.get(soId) ?? 0) + qty);
    }
    const mappedBySoId = new Map<string, number>();
    for (const alloc of (allocResp.data ?? []) as JsonRecord[]) {
      const soId = String(alloc.so_id);
      mappedBySoId.set(soId, (mappedBySoId.get(soId) ?? 0) + Number(alloc.allocated_qty ?? 0));
    }

    const result = soRows.map((row) => {
      const total = totalBySoId.get(String(row.id)) ?? 0;
      const mapped = mappedBySoId.get(String(row.id)) ?? 0;
      return {
        ...row,
        total_qty: total,
        mapped_qty: mapped,
        map_status: mapped <= QTY_TOL ? "UNMAPPED" : mapped >= total - QTY_TOL ? "FULLY_MAPPED" : "PARTIALLY_MAPPED",
      };
    });
    return okResponse(result, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "SO_MAP_LIST_FAILED";
    return soMapErrorResponse(req, ctx, code, 500, code);
  }
}

// Per-line mapped/remaining detail for one SO — used by the mapping drawer.
export async function getSoMapStatusHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const soId = getIdFromPath(req);
    if (!soId) return soMapErrorResponse(req, ctx, "SO_MAP_ID_MISSING", 400, "SO id required.");
    const { so, lines } = await fetchSoWithLines(soId);
    try {
      await assertCompanyScope(ctx, toTrimmedString(so.company_id));
    } catch {
      return soMapErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }
    const allocations = await fetchActiveAllocationsForSo(soId);
    const mappedByLine = new Map<string, number>();
    for (const alloc of allocations) {
      const lineId = String(alloc.so_line_id);
      mappedByLine.set(lineId, (mappedByLine.get(lineId) ?? 0) + Number(alloc.allocated_qty ?? 0));
    }
    const lineStatus = lines.map((line) => {
      const total = Number(line.base_qty ?? line.quantity ?? 0);
      const mapped = mappedByLine.get(String(line.id)) ?? 0;
      return { ...line, total_qty: total, mapped_qty: mapped, remaining_qty: Number((total - mapped).toFixed(6)) };
    });
    return okResponse({ so, lines: lineStatus, allocations }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "SO_MAP_STATUS_FAILED";
    return soMapErrorResponse(req, ctx, code, 500, code);
  }
}

// FO options for a given SO — company-scoped, ACTIVE, with remaining balance
// (§133.9 — ordered_qty_kg minus this FO's own active allocations across ALL
// SOs, since one FO can be split across multiple SOs, §133.9's resolved
// cardinality rule).
export async function listFoOptionsForSoHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const url = new URL(req.url);
    const soId = toTrimmedString(url.searchParams.get("so_id"));
    if (!soId) return soMapErrorResponse(req, ctx, "SO_MAP_ID_MISSING", 400, "so_id is required.");
    const { so } = await fetchSoWithLines(soId);
    try {
      await assertCompanyScope(ctx, toTrimmedString(so.company_id));
    } catch {
      return soMapErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }

    const { data: foRows, error: foError } = await serviceRoleClient
      .schema("erp_production").from("plan_feed")
      .select("id, fo_number, party_id, party_name, material_id, ordered_qty_kg, status")
      .eq("company_id", so.company_id).neq("status", "CANCELLED");
    if (foError) return soMapErrorResponse(req, ctx, "SO_MAP_FO_LIST_FAILED", 500, "Unable to list FO numbers.");

    const foIds = ((foRows ?? []) as JsonRecord[]).map((row) => String(row.id));
    const [{ data: allocRows, error: allocError }, { data: soMapAllocRows, error: soMapAllocError }] = await Promise.all([
      foIds.length
        ? serviceRoleClient.schema("erp_procurement").from("sales_order_map_allocation").select("fo_id, allocated_qty").in("fo_id", foIds).eq("status", "ACTIVE")
        : Promise.resolve({ data: [] as JsonRecord[], error: null }),
      foIds.length
        ? serviceRoleClient.schema("erp_procurement").from("sales_order_map_allocation").select("id, fo_id").in("fo_id", foIds)
        : Promise.resolve({ data: [] as JsonRecord[], error: null }),
    ]);
    if (allocError) return soMapErrorResponse(req, ctx, "SO_MAP_ALLOCATION_FETCH_FAILED", 500, "Unable to load FO allocations.");
    if (soMapAllocError) return soMapErrorResponse(req, ctx, "SO_MAP_ALLOCATION_FETCH_FAILED", 500, "Unable to load FO allocations.");

    // §133.18 -- an FO isn't pickable here unless (a) it already has at
    // least one Packing PO allocated (plan_feed_packing_order_allocation --
    // no point mapping an SO to demand nothing's been produced against yet)
    // and (b) it isn't already fully dispatched. Both were previously
    // unchecked -- this endpoint only excluded CANCELLED FOs.
    const { data: pkoAllocRows, error: pkoAllocError } = foIds.length
      ? await serviceRoleClient.schema("erp_production").from("plan_feed_packing_order_allocation")
          .select("plan_feed_id, packing_order_id, allocated_qty_kg").in("plan_feed_id", foIds)
      : { data: [] as JsonRecord[], error: null };
    if (pkoAllocError) return soMapErrorResponse(req, ctx, "SO_MAP_FO_PACKING_ALLOCATION_FETCH_FAILED", 500, "Unable to load FO Packing PO allocations.");
    const pkoCountByFo = new Map<string, number>();
    const allocatedKgByFo = new Map<string, number>();
    for (const row of (pkoAllocRows ?? []) as JsonRecord[]) {
      const foId = toTrimmedString(row.plan_feed_id);
      pkoCountByFo.set(foId, (pkoCountByFo.get(foId) ?? 0) + 1);
      allocatedKgByFo.set(foId, (allocatedKgByFo.get(foId) ?? 0) + Number(row.allocated_qty_kg ?? 0));
    }

    // Real dispatched qty per FO -- same chain as Plan Feed's own Total
    // Table (plan_feed.handlers.ts), duplicated locally rather than
    // cross-imported (small, domain-local helper, matches this codebase's
    // existing convention of not sharing handler internals across files).
    const soMapAllocIds = ((soMapAllocRows ?? []) as JsonRecord[]).map((row) => String(row.id));
    const foBySoMapAllocId = new Map(((soMapAllocRows ?? []) as JsonRecord[]).map((row) => [String(row.id), toTrimmedString(row.fo_id)]));
    const dispatchedByFo = new Map<string, number>();
    if (soMapAllocIds.length > 0) {
      const { data: dcLineRows, error: dcLineError } = await serviceRoleClient
        .schema("erp_procurement").from("delivery_challan_line").select("id, so_map_allocation_id").in("so_map_allocation_id", soMapAllocIds);
      if (dcLineError) return soMapErrorResponse(req, ctx, "SO_MAP_FO_DISPATCH_LOOKUP_FAILED", 500, "Unable to load DO lines for dispatch status.");
      const foByDcLineId = new Map(((dcLineRows ?? []) as JsonRecord[]).map((row) => [String(row.id), foBySoMapAllocId.get(toTrimmedString(row.so_map_allocation_id)) ?? ""]));
      const dcLineIds = [...foByDcLineId.keys()];
      if (dcLineIds.length > 0) {
        const { data: invoiceLineRows, error: invoiceLineError } = await serviceRoleClient
          .schema("erp_procurement").from("sales_invoice_line").select("dc_line_id, quantity, sales_invoice:invoice_id(status)").in("dc_line_id", dcLineIds);
        if (invoiceLineError) return soMapErrorResponse(req, ctx, "SO_MAP_FO_DISPATCH_LOOKUP_FAILED", 500, "Unable to load invoice lines for dispatch status.");
        for (const row of (invoiceLineRows ?? []) as JsonRecord[]) {
          if (toUpperTrimmedString((row.sales_invoice as JsonRecord | null)?.status) !== "POSTED") continue;
          const foId = foByDcLineId.get(toTrimmedString(row.dc_line_id));
          if (!foId) continue;
          dispatchedByFo.set(foId, (dispatchedByFo.get(foId) ?? 0) + Number(row.quantity ?? 0));
        }
      }
    }

    const allocatedByFo = new Map<string, number>();
    for (const alloc of (allocRows ?? []) as JsonRecord[]) {
      const foId = String(alloc.fo_id);
      allocatedByFo.set(foId, (allocatedByFo.get(foId) ?? 0) + Number(alloc.allocated_qty ?? 0));
    }

    // §133.18 -- once the user picks an FO, they need to see what it
    // actually has available (material/pack/volume) before mapping, per the
    // locked flow: "FO বেছে নিলে তবেই material/pack/volume দেখাবে, user নিজের
    // দরকার মতো change করতে পারে". Pulled from the allocated Packing POs'
    // own material_id/num_packs/fill_qty_per_pack/actual_qty_kg.
    const pkoIdsForDetail = [...new Set(((pkoAllocRows ?? []) as JsonRecord[]).map((row) => toTrimmedString(row.packing_order_id)).filter(Boolean))];
    const { data: pkoDetailRows, error: pkoDetailError } = pkoIdsForDetail.length
      ? await serviceRoleClient.schema("erp_production").from("packing_order")
          .select("id, po_number, batch_number, material_id, num_packs, fill_qty_per_pack, actual_qty_kg, status").in("id", pkoIdsForDetail)
      : { data: [] as JsonRecord[], error: null };
    if (pkoDetailError) return soMapErrorResponse(req, ctx, "SO_MAP_FO_PACKING_DETAIL_FETCH_FAILED", 500, "Unable to load Packing PO details.");
    const pkoMaterialIds = [...new Set(((pkoDetailRows ?? []) as JsonRecord[]).map((row) => toTrimmedString(row.material_id)).filter(Boolean))];
    const { data: pkoMaterialRows, error: pkoMaterialError } = pkoMaterialIds.length
      ? await serviceRoleClient.schema("erp_master").from("material_master").select("id, pace_code, material_name").in("id", pkoMaterialIds)
      : { data: [] as JsonRecord[], error: null };
    if (pkoMaterialError) return soMapErrorResponse(req, ctx, "SO_MAP_FO_PACKING_DETAIL_FETCH_FAILED", 500, "Unable to load Packing PO material details.");
    const pkoMaterialMap = new Map(((pkoMaterialRows ?? []) as JsonRecord[]).map((row) => [String(row.id), row]));
    const pkoDetailMap = new Map(((pkoDetailRows ?? []) as JsonRecord[]).map((row) => [String(row.id), row]));
    const pkoDetailsByFo = new Map<string, JsonRecord[]>();
    for (const row of (pkoAllocRows ?? []) as JsonRecord[]) {
      const foId = toTrimmedString(row.plan_feed_id);
      const pko = pkoDetailMap.get(toTrimmedString(row.packing_order_id));
      if (!pko || toUpperTrimmedString(pko.status) !== "FINAL") continue;
      const material = pkoMaterialMap.get(toTrimmedString(pko.material_id));
      if (!pkoDetailsByFo.has(foId)) pkoDetailsByFo.set(foId, []);
      pkoDetailsByFo.get(foId)!.push({
        packing_order_id: pko.id,
        po_number: pko.po_number,
        batch_number: pko.batch_number,
        material_display: material ? `${material.pace_code ?? ""} ${material.material_name ?? ""}`.trim() : null,
        num_packs: pko.num_packs,
        fill_qty_per_pack: pko.fill_qty_per_pack,
        actual_qty_kg: pko.actual_qty_kg,
        allocated_qty_kg: row.allocated_qty_kg,
      });
    }

    const result = ((foRows ?? []) as JsonRecord[]).map((row) => {
      const foId = String(row.id);
      const allocated = allocatedByFo.get(foId) ?? 0;
      const remaining = Number((Number(row.ordered_qty_kg ?? 0) - allocated).toFixed(6));
      const packingPoCount = pkoCountByFo.get(foId) ?? 0;
      const allocatedPkoKg = allocatedKgByFo.get(foId) ?? 0;
      const dispatchedKg = Number((dispatchedByFo.get(foId) ?? 0).toFixed(6));
      const dispatchComplete = packingPoCount > 0 && dispatchedKg >= allocatedPkoKg - QTY_TOL;
      return {
        ...row,
        allocated_qty: allocated,
        remaining_qty: remaining,
        packing_po_count: packingPoCount,
        dispatched_qty_kg: dispatchedKg,
        dispatch_complete: dispatchComplete,
        packing_po_details: pkoDetailsByFo.get(foId) ?? [],
      };
    }).filter((row) => row.remaining_qty > QTY_TOL && row.packing_po_count > 0 && !row.dispatch_complete);

    return okResponse(result, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "SO_MAP_FO_LIST_FAILED";
    return soMapErrorResponse(req, ctx, code, 500, code);
  }
}

// Customer Address options for the manual (no-FO) mapping loop — §133.9:
// scoped to the SO's own resolved VDC (Dependent Direct/No-Inbound-Direct)
// or Depot (Dependent Depot/No-Inbound-Depot has no loop, single destination).
export async function listCustomerAddressesForSoHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const url = new URL(req.url);
    const soId = toTrimmedString(url.searchParams.get("so_id"));
    if (!soId) return soMapErrorResponse(req, ctx, "SO_MAP_ID_MISSING", 400, "so_id is required.");
    const { so } = await fetchSoWithLines(soId);
    try {
      await assertCompanyScope(ctx, toTrimmedString(so.company_id));
    } catch {
      return soMapErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }
    const vdcId = toTrimmedString(so.bill_to_vdc_id);
    if (!vdcId) return soMapErrorResponse(req, ctx, "SO_MAP_NO_VDC", 422, "This SO has no VDC to resolve addresses under.");

    const { data, error } = await serviceRoleClient
      .schema("erp_master").from("customer_address")
      .select("id, customer_id, site_name, address_line, town, state, pin_code, status")
      .eq("depot_code_id", vdcId).eq("status", "ACTIVE");
    if (error) return soMapErrorResponse(req, ctx, "SO_MAP_ADDRESS_LIST_FAILED", 500, "Unable to list customer addresses.");
    return okResponse(data ?? [], ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "SO_MAP_ADDRESS_LIST_FAILED";
    return soMapErrorResponse(req, ctx, code, 500, code);
  }
}

async function validateAndUpsertAllocation(
  req: Request, ctx: ProcurementHandlerContext, body: JsonRecord, source: "fo" | "address",
): Promise<Response> {
  const soId = toTrimmedString(body.so_id);
  const soLineId = toTrimmedString(body.so_line_id);
  const qty = parsePositiveNumber(body.allocated_qty);
  if (!soId || !soLineId || !qty) {
    return soMapErrorResponse(req, ctx, "SO_MAP_ALLOCATION_INVALID", 400, "so_id, so_line_id, and allocated_qty are required.");
  }
  const { so, lines } = await fetchSoWithLines(soId);
  try {
    await assertCompanyScope(ctx, toTrimmedString(so.company_id));
  } catch {
    return soMapErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
  }
  if (!(await canMaintainSoMap(ctx, toTrimmedString(so.company_id)))) {
    return soMapErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have SO Map access at this company.");
  }
  const line = lines.find((entry) => String(entry.id) === soLineId);
  if (!line) return soMapErrorResponse(req, ctx, "SO_MAP_LINE_NOT_FOUND", 404, "SO line not found on this SO.");

  // §133.9 universal rule — per-item mapped qty must never exceed the SO
  // line's own qty (existing active allocations across every source, plus
  // this new one).
  const existingAllocations = await fetchActiveAllocationsForSo(soId);
  const alreadyMappedForLine = existingAllocations
    .filter((entry) => String(entry.so_line_id) === soLineId)
    .reduce((sum, entry) => sum + Number(entry.allocated_qty ?? 0), 0);
  const lineTotalQty = Number(line.base_qty ?? line.quantity ?? 0);
  if (alreadyMappedForLine + qty > lineTotalQty + QTY_TOL) {
    return soMapErrorResponse(req, ctx, "SO_MAP_QTY_EXCEEDS_LINE", 422, `Mapped quantity would exceed this SO line's own quantity (${lineTotalQty}).`);
  }

  const insertPayload: JsonRecord = {
    so_id: soId,
    so_line_id: soLineId,
    allocated_qty: qty,
    status: "ACTIVE",
    created_by: ctx.auth_user_id,
  };

  if (source === "fo") {
    const foId = toTrimmedString(body.fo_id);
    if (!foId) return soMapErrorResponse(req, ctx, "SO_MAP_FO_REQUIRED", 400, "fo_id is required.");
    const { data: fo, error: foError } = await serviceRoleClient
      .schema("erp_production").from("plan_feed").select("id, company_id, material_id, ordered_qty_kg, status").eq("id", foId).maybeSingle();
    if (foError || !fo) return soMapErrorResponse(req, ctx, "SO_MAP_FO_NOT_FOUND", 404, "FO not found.");
    if (toTrimmedString((fo as JsonRecord).company_id) !== toTrimmedString(so.company_id)) {
      return soMapErrorResponse(req, ctx, "SO_MAP_FO_COMPANY_MISMATCH", 422, "FO belongs to a different company.");
    }
    if (toUpperTrimmedString((fo as JsonRecord).status) === "CANCELLED") {
      return soMapErrorResponse(req, ctx, "SO_MAP_FO_CANCELLED", 422, "This FO is cancelled.");
    }
    // §133.9 — item mismatch: hard block, except FG MTO/HPS/MTEST (soft warning).
    const materialMismatch = toTrimmedString((fo as JsonRecord).material_id) !== toTrimmedString(line.material_id);
    if (materialMismatch) {
      const fgType = toUpperTrimmedString(line.fg_type);
      const isExempt = toTrimmedString(line.line_material_type) === "FG" && SKU_MISMATCH_EXEMPT_FG_TYPES.has(fgType);
      if (!isExempt) {
        return soMapErrorResponse(req, ctx, "SO_MAP_ITEM_MISMATCH", 422, "This FO's material does not match the SO line's item — not allowed for this material type.");
      }
      if (!body.sku_mismatch_confirmed) {
        return soMapErrorResponse(req, ctx, "SO_MAP_SKU_MISMATCH_CONFIRM_REQUIRED", 409, "SKU differs from this FO's declared material — confirm to map anyway.");
      }
      insertPayload.sku_mismatch_confirmed = true;
    }
    // §133.9 — FO capacity: sum of this FO's allocations (across every SO) must not exceed its own ordered_qty_kg.
    const { data: foAllocRows, error: foAllocError } = await serviceRoleClient
      .schema("erp_procurement").from("sales_order_map_allocation").select("allocated_qty").eq("fo_id", foId).eq("status", "ACTIVE");
    if (foAllocError) return soMapErrorResponse(req, ctx, "SO_MAP_ALLOCATION_FETCH_FAILED", 500, "Unable to verify FO capacity.");
    const alreadyAllocatedForFo = ((foAllocRows ?? []) as JsonRecord[]).reduce((sum, entry) => sum + Number(entry.allocated_qty ?? 0), 0);
    if (alreadyAllocatedForFo + qty > Number((fo as JsonRecord).ordered_qty_kg ?? 0) + QTY_TOL) {
      return soMapErrorResponse(req, ctx, "SO_MAP_QTY_EXCEEDS_FO", 422, "Mapped quantity would exceed this FO's own ordered quantity.");
    }
    insertPayload.fo_id = foId;
  } else {
    const customerAddressId = toTrimmedString(body.customer_address_id);
    if (!customerAddressId) return soMapErrorResponse(req, ctx, "SO_MAP_ADDRESS_REQUIRED", 400, "customer_address_id is required.");
    insertPayload.customer_address_id = customerAddressId;
  }

  const { data: created, error: insertError } = await serviceRoleClient
    .schema("erp_procurement").from("sales_order_map_allocation").insert(insertPayload).select("*").single();
  if (insertError || !created) return soMapErrorResponse(req, ctx, "SO_MAP_ALLOCATION_CREATE_FAILED", 500, "Unable to save mapping.");
  return okResponse(created, ctx.request_id, req);
}

export async function mapSoLineToFoHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    return await validateAndUpsertAllocation(req, ctx, await parseBody(req), "fo");
  } catch (error) {
    const code = error instanceof Error ? error.message : "SO_MAP_ALLOCATION_CREATE_FAILED";
    return soMapErrorResponse(req, ctx, code, 500, code);
  }
}

export async function mapSoLineToCustomerAddressHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    return await validateAndUpsertAllocation(req, ctx, await parseBody(req), "address");
  } catch (error) {
    const code = error instanceof Error ? error.message : "SO_MAP_ALLOCATION_CREATE_FAILED";
    return soMapErrorResponse(req, ctx, code, 500, code);
  }
}

// §133.9 — unmap is append-on-reversal (status=RELEASED), never a hard
// delete, matching PR19/COR6's established audit-preserving convention.
export async function unmapSoAllocationHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const allocationId = getIdFromPath(req);
    if (!allocationId) return soMapErrorResponse(req, ctx, "SO_MAP_ALLOCATION_ID_MISSING", 400, "Allocation id required.");
    const { data: allocation, error: fetchError } = await serviceRoleClient
      .schema("erp_procurement").from("sales_order_map_allocation").select("*, so:so_id(company_id)").eq("id", allocationId).maybeSingle();
    if (fetchError || !allocation) return soMapErrorResponse(req, ctx, "SO_MAP_ALLOCATION_NOT_FOUND", 404, "Allocation not found.");
    const companyId = toTrimmedString((allocation as JsonRecord).so && ((allocation as JsonRecord).so as JsonRecord).company_id);
    try {
      await assertCompanyScope(ctx, companyId);
    } catch {
      return soMapErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }
    if (!(await canMaintainSoMap(ctx, companyId))) {
      return soMapErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have SO Map access at this company.");
    }
    const { error: updateError } = await serviceRoleClient
      .schema("erp_procurement").from("sales_order_map_allocation")
      .update({ status: "RELEASED", last_updated_by: ctx.auth_user_id, last_updated_at: new Date().toISOString() })
      .eq("id", allocationId).eq("status", "ACTIVE");
    if (updateError) return soMapErrorResponse(req, ctx, "SO_MAP_UNMAP_FAILED", 500, "Unable to release mapping.");
    return okResponse({ id: allocationId, status: "RELEASED" }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "SO_MAP_UNMAP_FAILED";
    return soMapErrorResponse(req, ctx, code, 500, code);
  }
}
