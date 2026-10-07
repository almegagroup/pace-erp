/*
 * File-Path: supabase/functions/api/_core/procurement/crcp_discrepancy.handlers.ts
 * Domain: PROCUREMENT / PO12 (Plant Transfer Order, PTO)
 * Purpose: Tab 1 — CRCP Discrepancy List + the CRCP Cost Component Entry
 *          write-path. Design: docs/PROCUREMENT-DESIGN-DOC.md "PO12 (PTO) —
 *          Tab 1 Design" + "CRCP Cost Component Entry" sections, locked
 *          2026-10-03/04.
 *
 * Row grain = one GRN. A row exists here only when that GRN's Bill-To
 * (its PO's own company_id, or its STO's own receiving_company_id) differs
 * from its Actual Receiver (the GRN's own company_id) — a genuine CRCP
 * discrepancy, regardless of whether crcp_enabled happens to be set (locked
 * rule: the trigger is the actual mismatch, not the flag).
 *
 * Visibility: a company sees a row whenever it is that row's own Bill-To,
 * Ship-To (goods_receipt.ship_to_company_id), or Actual Receiver — any one
 * of the three CRCP-triangle roles, not just the one it happens to hold
 * most often.
 *
 * Authority: Backend
 */

import type { ContextResolution } from "../../_pipeline/context.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { errorResponse, okResponse } from "../response.ts";
import { assertCompanyScope } from "../../_shared/companyScope.ts";
import { fetchInChunks } from "../../_shared/chunkedIn.ts";
import { readAclSnapshotDecisionAny } from "../../_shared/acl_snapshot.ts";
// §PO12 Tab 1 "smart" component columns (2026-10-06) -- reuses AC01's own
// per-component breakdown math + column-set assembly exactly, so the Bulk
// Component Mapper's PO12-origin grid shows the same thing AC01's own grid
// does, not an independently re-derived (and possibly drifting) copy.
import { assembleSmartComponentsList, computeComponentBreakdown } from "./ac01.handlers.ts";

type JsonRecord = Record<string, unknown>;
type ProcurementHandlerContext = {
  context: Extract<ContextResolution, { status: "RESOLVED" }>;
  request_id: string;
  auth_user_id: string;
  roleCode: string;
};

function parseBody(req: Request): Promise<JsonRecord> {
  return req.json().catch(() => ({} as JsonRecord));
}

function toTrimmedString(value: unknown): string {
  return String(value ?? "").trim();
}

// Do not stringify nullable UUID columns before sending them to PostgREST's
// `.in()` filter: `String(null)` becomes the literal UUID candidate "null",
// which Postgres rejects with 22P02. A GRN legitimately has only one of
// po_id/sto_id (and several optional master references), so every bulk lookup
// must omit absent identifiers first.
function collectIds(rows: JsonRecord[], field: string): string[] {
  return [...new Set(rows.map((row) => toTrimmedString(row[field])).filter(Boolean))];
}

function crcpErrorResponse(
  req: Request,
  ctx: ProcurementHandlerContext,
  code: string,
  status: number,
  message: string,
): Response {
  return errorResponse(code, message, ctx.request_id, "NONE", status, {}, req);
}

function toMap<T extends JsonRecord>(rows: T[]): Map<string, T> {
  return new Map(rows.map((row) => [String(row.id), row]));
}

// Every PO12 write handler on this feature (CRCP Cost Component Entry,
// Settlement create/reverse) resolves its own companyId independently of
// ctx.context.companyId (the session's active company) -- a write against
// a DIFFERENT company than the session's own active one. The route-level
// stepAcl() gate only validates PROC_PLANT_TRANSFER_LIST:WRITE at
// ctx.context.companyId, and assertCompanyScope() only proves company
// MEMBERSHIP, not that the caller's ACL grant AT THAT SPECIFIC company is
// WRITE/EDIT. Mirrors ac01.handlers.ts's own canWriteAC01()/
// requireAC01WriteAccess() (same gap, same fix shape, found there
// 2026-08-11) -- flagged live by scripts/company-scope-write-acl-guard.mjs.
// resourceCode defaults to PROC_PLANT_TRANSFER_LIST (Tab 1's own resource).
// PO12 Tab 2 (returnable_transfer.handlers.ts) passes "PROC_RETURNABLE_TRANSFER"
// instead -- Tab 1 and Tab 2 used to share this one resource_code, which meant
// granting a Logistics capability WRITE on Tab 2 silently also unlocked Tab 1's
// Accounts-only Settlement/Cost-Component actions (CLAUDE.md bug pattern #6 --
// "one resource code reused for two different actions"). Split 2026-10-06.
export async function canWriteCrcp(
  ctx: ProcurementHandlerContext,
  companyId: string,
  actionCode: "WRITE" | "EDIT" = "WRITE",
  resourceCode: string = "PROC_PLANT_TRANSFER_LIST",
): Promise<boolean> {
  if (ctx.context.isAdmin) return true;
  if (!companyId) return false;

  let workContextIds: string[];
  if (companyId === ctx.context.companyId) {
    workContextIds =
      ctx.context.workContextIds && ctx.context.workContextIds.length > 0
        ? ctx.context.workContextIds
        : ctx.context.workContextId
          ? [ctx.context.workContextId]
          : [];
  } else {
    const { data: workContextRows, error: workContextError } = await serviceRoleClient
      .schema("erp_acl")
      .from("user_work_contexts")
      .select("work_context:work_context_id!inner(work_context_id, is_active)")
      .eq("auth_user_id", ctx.auth_user_id)
      .eq("company_id", companyId);
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
    .schema("acl")
    .from("acl_versions")
    .select("acl_version_id")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .single();
  if (versionError || !versionRow?.acl_version_id) return false;

  const { data, error } = await readAclSnapshotDecisionAny({
    db: serviceRoleClient,
    aclVersionId: versionRow.acl_version_id as string,
    authUserId: ctx.auth_user_id,
    companyId,
    workContextIds,
    resourceCode,
    actionCode,
  });
  if (error || !data) return false;
  return data.decision === "ALLOW";
}

export async function requireCrcpWriteAccess(
  req: Request,
  ctx: ProcurementHandlerContext,
  companyId: string,
  actionCode: "WRITE" | "EDIT" = "WRITE",
  resourceCode: string = "PROC_PLANT_TRANSFER_LIST",
): Promise<Response | null> {
  const allowed = await canWriteCrcp(ctx, companyId, actionCode, resourceCode);
  if (allowed) return null;
  return crcpErrorResponse(
    req, ctx, "CRCP_WRITE_FORBIDDEN", 403,
    "You do not have edit access to this PO12 action for this company.",
  );
}

// A GRN whose po_id/sto_id can't resolve a Bill-To at all (orphan reference,
// or neither set — shouldn't happen for a real GRN) is never a discrepancy
// row: there's nothing to compare against.
function resolveBillTo(
  grn: JsonRecord,
  poMap: Map<string, JsonRecord>,
  stoMap: Map<string, JsonRecord>,
): string | null {
  if (grn.po_id) return toTrimmedString(poMap.get(String(grn.po_id))?.company_id) || null;
  if (grn.sto_id) return toTrimmedString(stoMap.get(String(grn.sto_id))?.receiving_company_id) || null;
  return null;
}

async function resolveCompanyName(companyId: string | null, companyMap: Map<string, JsonRecord>) {
  if (!companyId) return null;
  const company = companyMap.get(companyId);
  return company ? `${company.company_code} — ${company.company_name}` : null;
}

function buildDiscrepancyRow(
  grn: JsonRecord,
  billToCompanyId: string,
  materialMap: Map<string, JsonRecord>,
  vendorMap: Map<string, JsonRecord>,
  companyMap: Map<string, JsonRecord>,
  poMap: Map<string, JsonRecord>,
  stoMap: Map<string, JsonRecord>,
  landedCostMap: Map<string, JsonRecord>,
  transporterMap: Map<string, JsonRecord>,
  costLinesByLc: Map<string, JsonRecord[]>,
  deductionLinesByLc: Map<string, JsonRecord[]>,
  deductionTypeNameMap: Map<string, string>,
): JsonRecord {
  const material = materialMap.get(String(grn.material_id));
  const vendor = vendorMap.get(String(grn.vendor_id));
  const po = grn.po_id ? poMap.get(String(grn.po_id)) : null;
  const sto = grn.sto_id ? stoMap.get(String(grn.sto_id)) : null;
  const landedCost = landedCostMap.get(String(grn.id));
  const transporter = grn.transporter_id ? transporterMap.get(String(grn.transporter_id)) : null;
  const billToCompany = companyMap.get(billToCompanyId);
  const shipToCompany = grn.ship_to_company_id ? companyMap.get(String(grn.ship_to_company_id)) : billToCompany;
  const actualReceiverCompany = companyMap.get(String(grn.company_id));
  // §PO12 Tab 1 "smart" component columns (2026-10-06) -- same math as
  // AC01's own list, see computeComponentBreakdown's own comment.
  const rowCostLines = landedCost ? (costLinesByLc.get(String(landedCost.id)) ?? []) : [];
  const rowDeductionLines = landedCost ? (deductionLinesByLc.get(String(landedCost.id)) ?? []) : [];
  const { breakdown: componentBreakdown } = computeComponentBreakdown(
    grn, rowCostLines, rowDeductionLines, deductionTypeNameMap,
  );

  return {
    grn_id: grn.id,
    // 1. CRCP Triangle — §8A, never a raw UUID.
    bill_to_company_id: billToCompanyId,
    bill_to_company_name: billToCompany ? `${billToCompany.company_code} — ${billToCompany.company_name}` : null,
    ship_to_company_id: grn.ship_to_company_id ?? billToCompanyId,
    ship_to_company_name: shipToCompany ? `${shipToCompany.company_code} — ${shipToCompany.company_name}` : null,
    actual_receiver_company_id: grn.company_id,
    actual_receiver_company_name: actualReceiverCompany
      ? `${actualReceiverCompany.company_code} — ${actualReceiverCompany.company_name}`
      : null,
    // 2. Quantity
    grn_qty: grn.received_qty,
    base_uom_code: material?.base_uom_code ?? null,
    // 3. Identification
    grn_number: grn.grn_number,
    grn_date: grn.grn_date,
    po_number: po?.po_number ?? null,
    sto_number: sto?.sto_number ?? null,
    vendor_name: vendor?.vendor_name ?? null,
    material_name: material?.material_name ?? null,
    external_code: material?.external_code ?? null,
    // 4. Document Numbers + Dates
    invoice_number: grn.invoice_number ?? null,
    invoice_date: grn.invoice_date ?? null,
    bulk_challan_number: grn.bulk_challan_number ?? null,
    bulk_challan_date: grn.bulk_challan_date ?? null,
    container_number: grn.bulk_container_number ?? null,
    ewaybill_number: grn.bulk_ewaybill_number ?? null,
    rst_number: grn.rst_number ?? null,
    lr_number: grn.lr_number ?? null,
    lr_date: grn.lr_date ?? null,
    transporter_name: transporter ? `${transporter.transporter_code} — ${transporter.transporter_name}` : null,
    // 5. AC01 Relation
    landed_cost_total: landedCost ? Number(landedCost.total_cost ?? 0) : 0,
    component_breakdown: componentBreakdown,
    rate_confirmed: Boolean(grn.rate_confirmed),
    settlement_status: grn.settlement_invoice_id ? "SETTLED" : "PENDING",
    settlement_invoice_id: grn.settlement_invoice_id ?? null,
  };
}

// Shared by both the full Tab 1 list and the Settlement page's "Pending"
// tab (same grid, filtered to Settlement Status = Pending there).
export async function fetchCrcpDiscrepancyRows(
  companyId: string,
  opts: { settlementStatus?: "PENDING" | "SETTLED" } = {},
): Promise<JsonRecord[]> {
  // Known interim scaling simplification (brand-new, low-volume feature):
  // the Bill-To/Ship-To/Actual-Receiver visibility rule genuinely needs a
  // join goods_receipt has no FK-expressible path for (po_id -> purchase_
  // order.company_id, sto_id -> stock_transfer_order.receiving_company_id),
  // so this pulls a bounded recent window and joins/filters server-side in
  // TS rather than at the DB level. Revisit with a dedicated view/RPC if
  // this ever needs to page past a few thousand GRNs.
  const { data: grnRows, error: grnError } = await serviceRoleClient
    .schema("erp_procurement")
    .from("goods_receipt")
    .select("*")
    .or("po_id.not.is.null,sto_id.not.is.null")
    .order("created_at", { ascending: false })
    .limit(2000);
  if (grnError) throw new Error("CRCP_DISCREPANCY_LIST_FAILED");

  const allGrns = (grnRows ?? []) as JsonRecord[];
  // Re-filter cleanly in TS so a Postgrest quirk in the .or() clause above
  // can't silently widen the set.
  const candidateGrns = allGrns.filter((row) => row.po_id || row.sto_id);

  const poIds = collectIds(candidateGrns, "po_id");
  const stoIds = collectIds(candidateGrns, "sto_id");

  const [poRows, stoRows] = await Promise.all([
    fetchInChunks<JsonRecord>(poIds, (chunk) =>
      serviceRoleClient.schema("erp_procurement").from("purchase_order")
        .select("id, po_number, company_id").in("id", chunk)),
    fetchInChunks<JsonRecord>(stoIds, (chunk) =>
      serviceRoleClient.schema("erp_procurement").from("stock_transfer_order")
        .select("id, sto_number, receiving_company_id").in("id", chunk)),
  ]);
  const poMap = toMap(poRows);
  const stoMap = toMap(stoRows);

  const discrepancyGrns = candidateGrns
    .map((grn) => ({ grn, billTo: resolveBillTo(grn, poMap, stoMap) }))
    .filter(({ grn, billTo }) => billTo && billTo !== String(grn.company_id))
    .filter(({ grn, billTo }) =>
      // Visibility: viewer must be Bill-To, Ship-To, or Actual Receiver.
      billTo === companyId
      || String(grn.company_id) === companyId
      || String(grn.ship_to_company_id ?? "") === companyId)
    .filter(({ grn }) => {
      if (!opts.settlementStatus) return true;
      const isSettled = Boolean(grn.settlement_invoice_id);
      return opts.settlementStatus === "SETTLED" ? isSettled : !isSettled;
    });

  const grns = discrepancyGrns.map((row) => row.grn);
  const billToByGrnId = new Map(discrepancyGrns.map((row) => [String(row.grn.id), row.billTo as string]));

  const materialIds = collectIds(grns, "material_id");
  const vendorIds = collectIds(grns, "vendor_id");
  const transporterIds = collectIds(grns, "transporter_id");
  const grnIds = collectIds(grns, "id");
  const companyIdsInvolved = [...new Set([
    ...grns.map((row) => toTrimmedString(row.company_id)),
    ...grns.map((row) => toTrimmedString(row.ship_to_company_id)),
    ...[...billToByGrnId.values()],
  ].filter(Boolean))];

  const [materials, vendors, transporters, companies, landedCosts] = await Promise.all([
    fetchInChunks<JsonRecord>(materialIds, (chunk) =>
      serviceRoleClient.schema("erp_master").from("material_master")
        .select("id, material_name, external_code, base_uom_code").in("id", chunk)),
    fetchInChunks<JsonRecord>(vendorIds, (chunk) =>
      serviceRoleClient.schema("erp_master").from("vendor_master")
        .select("id, vendor_name").in("id", chunk)),
    fetchInChunks<JsonRecord>(transporterIds, (chunk) =>
      serviceRoleClient.schema("erp_master").from("transporter_master")
        .select("id, transporter_code, transporter_name").in("id", chunk)),
    fetchInChunks<JsonRecord>(companyIdsInvolved, (chunk) =>
      serviceRoleClient.schema("erp_master").from("companies")
        .select("id, company_code, company_name").in("id", chunk)),
    fetchInChunks<JsonRecord>(grnIds, (chunk) =>
      serviceRoleClient.schema("erp_procurement").from("landed_cost")
        .select("id, grn_id, total_cost, created_at").in("grn_id", chunk)),
  ]);

  const materialMap = toMap(materials);
  const vendorMap = toMap(vendors);
  const transporterMap = toMap(transporters);
  const companyMap = toMap(companies);
  const landedCostMap = new Map<string, JsonRecord>();
  for (const lc of landedCosts) {
    const existing = landedCostMap.get(String(lc.grn_id));
    if (!existing || String(lc.created_at) > String(existing.created_at)) {
      landedCostMap.set(String(lc.grn_id), lc);
    }
  }

  // §PO12 Tab 1 "smart" component columns (2026-10-06) -- fetch each GRN's
  // own cost/deduction lines (only the latest landed_cost per GRN, same as
  // landedCostMap above) so buildDiscrepancyRow can compute the same
  // per-component breakdown AC01's own list already does.
  const lcIds = [...landedCostMap.values()].map((lc) => String(lc.id));
  const [costLineRows, deductionLineRows] = await Promise.all([
    lcIds.length > 0
      ? fetchInChunks<JsonRecord>(lcIds, (chunk) =>
        serviceRoleClient.schema("erp_procurement").from("landed_cost_line")
          .select("lc_id, cost_type, amount, entry_mode, has_gst, gst_treatment, gst_rate").in("lc_id", chunk))
      : Promise.resolve([] as JsonRecord[]),
    lcIds.length > 0
      ? fetchInChunks<JsonRecord>(lcIds, (chunk) =>
        serviceRoleClient.schema("erp_procurement").from("landed_cost_deduction_line")
          .select("lc_id, deduction_type_id, amount, round_off, in_landed").in("lc_id", chunk))
      : Promise.resolve([] as JsonRecord[]),
  ]);
  const deductionTypeIds = [...new Set(
    deductionLineRows.map((row) => toTrimmedString(row.deduction_type_id)).filter(Boolean),
  )];
  const deductionTypeRows = deductionTypeIds.length > 0
    ? await fetchInChunks<JsonRecord>(deductionTypeIds, (chunk) =>
      serviceRoleClient.schema("erp_procurement").from("deduction_type_master")
        .select("id, name").in("id", chunk))
    : [];
  const deductionTypeNameMap = new Map(
    deductionTypeRows.map((row) => [String(row.id), toTrimmedString(row.name) || "Deduction"]),
  );
  const costLinesByLc = new Map<string, JsonRecord[]>();
  for (const line of costLineRows) {
    const key = String(line.lc_id);
    if (!costLinesByLc.has(key)) costLinesByLc.set(key, []);
    costLinesByLc.get(key)!.push(line);
  }
  const deductionLinesByLc = new Map<string, JsonRecord[]>();
  for (const line of deductionLineRows) {
    const key = String(line.lc_id);
    if (!deductionLinesByLc.has(key)) deductionLinesByLc.set(key, []);
    deductionLinesByLc.get(key)!.push(line);
  }

  return grns.map((grn) =>
    buildDiscrepancyRow(
      grn,
      billToByGrnId.get(String(grn.id))!,
      materialMap, vendorMap, companyMap, poMap, stoMap, landedCostMap, transporterMap,
      costLinesByLc, deductionLinesByLc, deductionTypeNameMap,
    ),
  );
}

export async function listCrcpDiscrepancyHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    const url = new URL(req.url);
    const companyId = toTrimmedString(url.searchParams.get("company_id")) || toTrimmedString(ctx.context.companyId);
    if (!companyId) {
      return crcpErrorResponse(req, ctx, "CRCP_DISCREPANCY_COMPANY_REQUIRED", 400, "company_id is required.");
    }
    try {
      await assertCompanyScope(ctx, companyId);
    } catch {
      return crcpErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }

    const items = await fetchCrcpDiscrepancyRows(companyId);

    // §PO12 Tab 1 "smart" component columns (2026-10-06) -- assembleSmartComponentsList
    // needs a deduction id -> name map for its label text; re-resolve just the
    // ids that actually appear in this result set's own component_breakdown
    // keys (fetchCrcpDiscrepancyRows already resolved these once internally
    // to compute the breakdown itself, but doesn't expose that map back out).
    const deductionIdsInUse = [...new Set(
      items.flatMap((item) =>
        Object.keys((item.component_breakdown ?? {}) as Record<string, number>)
          .filter((key) => key.startsWith("deduction:"))
          .map((key) => key.slice("deduction:".length))),
    )];
    const deductionTypeNameMap = new Map<string, string>();
    if (deductionIdsInUse.length > 0) {
      const deductionTypeRows = await fetchInChunks<JsonRecord>(deductionIdsInUse, (chunk) =>
        serviceRoleClient.schema("erp_procurement").from("deduction_type_master")
          .select("id, name").in("id", chunk));
      for (const row of deductionTypeRows) deductionTypeNameMap.set(String(row.id), toTrimmedString(row.name) || "Deduction");
    }
    const components = assembleSmartComponentsList(items, deductionTypeNameMap);

    return okResponse({ items, total: items.length, components }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "CRCP_DISCREPANCY_LIST_FAILED";
    return crcpErrorResponse(req, ctx, code, 500, code);
  }
}

// CRCP Cost Component Entry — the Bill-To company's own write-path into a
// GRN's landed_cost it does NOT own, deliberately separate from (and never
// widening) canWriteAC01()/requireAC01WriteAccess() in ac01.handlers.ts,
// which stays strictly GRN-company-scoped. Gated purely by: caller's own
// company_id equals this GRN's Bill-To (po.company_id / sto.receiving_
// company_id) — the CRCP allow-list itself is irrelevant here (it only
// governs who may raise a Gate Entry, not this Leg-1 cost-entry action).
export async function createCrcpCostComponentHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    const body = await parseBody(req);
    const grnId = toTrimmedString(body.grn_id);
    const costType = toTrimmedString(body.cost_type);
    const amount = Number(body.amount);
    if (!grnId || !costType || !Number.isFinite(amount) || amount <= 0) {
      return crcpErrorResponse(req, ctx, "CRCP_COST_COMPONENT_INVALID", 400, "grn_id, cost_type and a positive amount are required.");
    }

    const { data: grn, error: grnError } = await serviceRoleClient
      .schema("erp_procurement").from("goods_receipt")
      .select("id, company_id, po_id, sto_id").eq("id", grnId).single();
    if (grnError || !grn) {
      return crcpErrorResponse(req, ctx, "CRCP_COST_COMPONENT_GRN_NOT_FOUND", 404, "GRN not found.");
    }

    const [poResp, stoResp] = await Promise.all([
      grn.po_id
        ? serviceRoleClient.schema("erp_procurement").from("purchase_order")
          .select("company_id, crcp_enabled").eq("id", String(grn.po_id)).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      grn.sto_id
        ? serviceRoleClient.schema("erp_procurement").from("stock_transfer_order")
          .select("receiving_company_id, crcp_enabled").eq("id", String(grn.sto_id)).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    const po = poResp.data as JsonRecord | null;
    const sto = stoResp.data as JsonRecord | null;
    const billToCompanyId = toTrimmedString(po?.company_id ?? sto?.receiving_company_id);
    const crcpEnabled = Boolean(po?.crcp_enabled ?? sto?.crcp_enabled ?? false);

    // The CRCP condition, exactly as locked: crcp_enabled=true AND the
    // caller has real PROC_PLANT_TRANSFER_LIST:WRITE access AT the GRN's
    // own Bill-To company specifically -- never the GRN's own (Actual
    // Receiver) company, which already has ordinary AC01 write access of
    // its own and does not need this path at all. canWriteCrcp() (not a
    // bare company-membership/equality check) covers both the caller's own
    // session company and a genuine multi-company WRITE grant elsewhere --
    // same shape as ac01.handlers.ts's canWriteAC01().
    if (!billToCompanyId || !crcpEnabled) {
      return crcpErrorResponse(
        req, ctx, "CRCP_COST_COMPONENT_FORBIDDEN", 403,
        "CRCP Cost Component Entry is only available on a CRCP-enabled PO/STO.",
      );
    }
    try {
      await assertCompanyScope(ctx, billToCompanyId);
    } catch {
      return crcpErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }
    const forbidden = await requireCrcpWriteAccess(req, ctx, billToCompanyId, "WRITE");
    if (forbidden) return forbidden;

    // Reuse the GRN's existing landed_cost header if one already exists
    // (created by the Actual Receiver's own AC01, or by an earlier CRCP
    // entry) -- never a second header per GRN. itc_owner_company_id is set
    // to this caller's (Bill-To's) own company on first creation of the
    // header for a CRCP GRN; an already-existing header's itc_owner is left
    // untouched (it was already correctly set, either by this same path
    // earlier, or defaults to the GRN company for an ordinary purchase --
    // which this path can only ever reach for a CRCP-enabled document, so
    // that default case does not apply here in practice).
    const { data: existingLc } = await serviceRoleClient
      .schema("erp_procurement").from("landed_cost")
      .select("id").eq("grn_id", grnId).order("created_at", { ascending: false }).limit(1).maybeSingle();

    let lcId = existingLc?.id as string | undefined;
    if (!lcId) {
      const { data: newLc, error: lcInsertError } = await serviceRoleClient
        .schema("erp_procurement").from("landed_cost")
        .insert({
          lc_number: `LC-CRCP-${grnId.slice(0, 8)}-${Date.now()}`,
          lc_date: new Date().toISOString().slice(0, 10),
          company_id: grn.company_id,
          grn_id: grnId,
          po_id: grn.po_id ?? null,
          status: "DRAFT",
          itc_owner_company_id: billToCompanyId,
          created_by: ctx.auth_user_id,
        })
        .select("id").single();
      if (lcInsertError || !newLc) {
        return crcpErrorResponse(req, ctx, "CRCP_COST_COMPONENT_HEADER_CREATE_FAILED", 500, "Unable to create landed cost header.");
      }
      lcId = newLc.id as string;
    }

    const { data: lastLine } = await serviceRoleClient
      .schema("erp_procurement").from("landed_cost_line")
      .select("line_number").eq("lc_id", lcId).order("line_number", { ascending: false }).limit(1).maybeSingle();
    const nextLineNumber = (Number(lastLine?.line_number) || 0) + 1;

    const { data: line, error: lineError } = await serviceRoleClient
      .schema("erp_procurement").from("landed_cost_line")
      .insert({
        lc_id: lcId,
        line_number: nextLineNumber,
        cost_type: costType,
        bill_reference: toTrimmedString(body.bill_reference) || null,
        bill_date: toTrimmedString(body.bill_date) || null,
        description: toTrimmedString(body.description) || null,
        amount,
      })
      .select("*")
      .single();
    if (lineError || !line) {
      return crcpErrorResponse(req, ctx, "CRCP_COST_COMPONENT_LINE_CREATE_FAILED", 500, "Unable to add cost component.");
    }

    const { data: allLines } = await serviceRoleClient
      .schema("erp_procurement").from("landed_cost_line").select("amount").eq("lc_id", lcId);
    const totalCost = ((allLines ?? []) as JsonRecord[]).reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
    await serviceRoleClient
      .schema("erp_procurement").from("landed_cost")
      .update({ total_cost: totalCost, last_updated_at: new Date().toISOString() })
      .eq("id", lcId);

    return okResponse({ ...line, lc_id: lcId }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "CRCP_COST_COMPONENT_CREATE_FAILED";
    return crcpErrorResponse(req, ctx, code, code === "COMPANY_SCOPE_VIOLATION" ? 403 : 500, code);
  }
}
