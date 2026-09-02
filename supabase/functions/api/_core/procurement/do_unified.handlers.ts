/*
 * File-Path: supabase/functions/api/_core/procurement/do_unified.handlers.ts
 * Domain: PROCUREMENT / Sales
 * Purpose: DO (Delivery Order, TX SO03) §133.12 unified redesign — a DO is
 *          now per-VEHICLE and can carry lines from multiple SO/STO
 *          documents at once (previously exactly one source document per
 *          DO, §113.13's delivery_order.handlers.ts — left untouched for
 *          historical single-source DOs, this file is purely additive).
 *          Page 1 "Add SO"/"Add STO" drawer content lives here; the line
 *          source branches by dispatch_type per §133.12-addendum:
 *          DEPENDENT_* reads through sales_order_map_allocation (an FO or
 *          manual-customer-address mapping, §133.9), INDEPENDENT_* reads
 *          straight from sales_order_line (Ship-To already fixed at SO
 *          create, no mapping step exists for these).
 * Authority: Backend
 */

import type { ContextResolution } from "../../_pipeline/context.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { errorResponse, okResponse } from "../response.ts";
import { assertCompanyScope } from "../../_shared/companyScope.ts";
import { fetchInChunks } from "../../_shared/chunkedIn.ts";
import { todayIsoInKolkata } from "../../_shared/dateUtils.ts";
import { isManualDocumentDateWithinWindow, MANUAL_DOCUMENT_DATE_WINDOW_MESSAGE } from "../../_shared/manualDocumentDateWindow.ts";
import { readAclSnapshotDecisionAny } from "../../_shared/acl_snapshot.ts";
import { getAvailableQty } from "./delivery_order.handlers.ts";
import { deriveSalesInvoiceGstType, getSnapshotForIssue, hasPhysicalInventoryBlock } from "./sales_order.handlers.ts";
import {
  assertPhase3PostingDateMatch,
  isHistoricalBackfillInvoiceDate,
  resolveBackfillPhase,
  resolvePhase1PostingDate,
  type BackfillClassification,
} from "../../_shared/dispatchBackfillPosting.ts";

type JsonRecord = Record<string, unknown>;
type ProcurementHandlerContext = {
  context: Extract<ContextResolution, { status: "RESOLVED" }>;
  request_id: string;
  auth_user_id: string;
  roleCode: string;
};

const DEPENDENT_DISPATCH_TYPES = new Set(["DEPENDENT_DIRECT", "DEPENDENT_DEPOT", "DEPENDENT_NO_INBOUND"]);
const QTY_TOL = 0.0001;
// §133.13 -- same set delivery_order.handlers.ts's createPgiInvoiceHandler
// uses (not exported there, small enough to duplicate rather than widen
// that file's export surface for one Set).
const EXCLUSIVE_FREIGHT_TERMS = new Set(["FREIGHT_SEPARATE", "FREIGHT_AT_ACTUALS", "EX_TRANSPORTER_GODOWN"]);
const GST_TREATMENTS = new Set(["INCLUSIVE", "EXCLUSIVE"]);

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
function parseNullableNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function parseBody(req: Request): Promise<JsonRecord> {
  return req.json().catch(() => ({} as JsonRecord));
}
function getIdFromPath(req: Request): string {
  return new URL(req.url).pathname.split("/").filter(Boolean)[3] ?? "";
}
function todayIsoDate(): string {
  return todayIsoInKolkata();
}
function doErrorResponse(req: Request, ctx: ProcurementHandlerContext, code: string, status: number, message: string): Response {
  return errorResponse(code, message, ctx.request_id, "NONE", status, {}, req);
}
async function generateProcurementDocNumber(docType: string): Promise<string> {
  const { data, error } = await serviceRoleClient.schema("erp_procurement").rpc("generate_doc_number", { p_doc_type: docType });
  if (error || !data) throw new Error("PROCUREMENT_DOC_NUMBER_FAILED");
  return String(data);
}

// §133.12 — a line/allocation's remaining balance = its own total qty minus
// every non-cancelled DO's already-drawn quantity against it. Generalizes
// delivery_order.handlers.ts's old fetchLockedLineIds (a boolean lock) into
// a running sum, since one vehicle no longer has to take a line's entire
// remaining balance at once (§133.12 Page 1 point 3).
async function computeDrawnQtyByColumn(column: "so_line_id" | "sto_line_id" | "so_map_allocation_id" | "packing_order_id", ids: string[], excludeDcId?: string): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (ids.length === 0) return map;
  const rows = await fetchInChunks<JsonRecord>(ids, (chunk) => {
    let query = serviceRoleClient
      .schema("erp_procurement")
      .from("delivery_challan_line")
      .select(`${column}, quantity, delivery_challan!inner(status)`)
      .in(column, chunk)
      .neq("delivery_challan.status", "CANCELLED");
    if (excludeDcId) query = query.neq("dc_id", excludeDcId);
    return query;
  });
  for (const row of rows) {
    const key = toTrimmedString(row[column]);
    if (!key) continue;
    map.set(key, (map.get(key) ?? 0) + Number(row.quantity ?? 0));
  }
  return map;
}

// A Packing PO can be allocated to more than one FO. Keep the FO-specific
// dispatched total separate from its overall production-output balance.
async function computeDrawnQtyByFoPackingOrder(packingOrderIds: string[], excludeDcId?: string): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (packingOrderIds.length === 0) return map;
  const lines = await fetchInChunks<JsonRecord>(packingOrderIds, (chunk) => {
    let query = serviceRoleClient.schema("erp_procurement").from("delivery_challan_line")
      .select("packing_order_id, so_map_allocation_id, quantity, delivery_challan!inner(status)")
      .in("packing_order_id", chunk).neq("delivery_challan.status", "CANCELLED");
    if (excludeDcId) query = query.neq("dc_id", excludeDcId);
    return query;
  });
  const allocationIds = [...new Set(lines.map((row) => toTrimmedString(row.so_map_allocation_id)).filter(Boolean))];
  const allocations = allocationIds.length
    ? await fetchInChunks<JsonRecord>(allocationIds, (chunk) => serviceRoleClient.schema("erp_procurement")
      .from("sales_order_map_allocation").select("id, fo_id").in("id", chunk))
    : [];
  const foByAllocationId = new Map(allocations.map((row) => [toTrimmedString(row.id), toTrimmedString(row.fo_id)]));
  for (const line of lines) {
    const foId = foByAllocationId.get(toTrimmedString(line.so_map_allocation_id));
    const packingOrderId = toTrimmedString(line.packing_order_id);
    if (!foId || !packingOrderId) continue;
    const key = `${foId}:${packingOrderId}`;
    map.set(key, (map.get(key) ?? 0) + Number(line.quantity ?? 0));
  }
  return map;
}

async function attachMaterialDisplay(rows: JsonRecord[]): Promise<JsonRecord[]> {
  const materialIds = [...new Set(rows.map((row) => toTrimmedString(row.material_id)).filter(Boolean))];
  const { data } = materialIds.length
    ? await serviceRoleClient.schema("erp_master").from("material_master").select("id, material_name, document_name, material_type, hsn_code").in("id", materialIds)
    : { data: [] as JsonRecord[] };
  const map = new Map(((data ?? []) as JsonRecord[]).map((row) => [String(row.id), row]));
  return rows.map((row) => {
    const material = map.get(toTrimmedString(row.material_id));
    return {
      ...row,
      material_display: material ? toTrimmedString(material.material_name) || null : null,
      document_name: material ? toTrimmedString(material.document_name) || null : null,
      line_material_type: material?.material_type ?? null,
    };
  });
}

// Page 1 "Add SO" — returns either (a) a flat SO-line list with remaining
// qty (INDEPENDENT_* dispatch types, no mapping step), or (b) the SO's
// active SO-Map allocations grouped by FO/address with remaining qty
// (DEPENDENT_* types). FG lines carry their already-known batch_number/
// packing_order_id straight off sales_order_line when SO Map (or SO
// create) already set them.
export async function listDoAddSoOptionsHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const url = new URL(req.url);
    const soId = toTrimmedString(url.searchParams.get("so_id"));
    if (!soId) return doErrorResponse(req, ctx, "DO_ADD_SO_ID_MISSING", 400, "so_id is required.");

    const { data: so, error: soError } = await serviceRoleClient
      .schema("erp_procurement").from("sales_order").select("*").eq("id", soId).maybeSingle();
    if (soError || !so) return doErrorResponse(req, ctx, "DO_SOURCE_NOT_FOUND", 404, "Sales order not found.");
    try {
      await assertCompanyScope(ctx, toTrimmedString((so as JsonRecord).company_id));
    } catch {
      return doErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }
    if (!["CREATED", "ISSUED"].includes(toTrimmedString((so as JsonRecord).status).toUpperCase())) {
      return doErrorResponse(req, ctx, "DO_SOURCE_NOT_DISPATCHABLE", 400, "This sales order is not in a dispatchable status.");
    }

    const { data: lines, error: linesError } = await serviceRoleClient
      .schema("erp_procurement").from("sales_order_line").select("*").eq("so_id", soId).order("line_number", { ascending: true });
    if (linesError) return doErrorResponse(req, ctx, "DO_SOURCE_LINES_FAILED", 500, "Unable to load SO lines.");
    const lineRows = (lines ?? []) as JsonRecord[];
    const lineMap = new Map(lineRows.map((row) => [String(row.id), row]));

    const dispatchType = toTrimmedString((so as JsonRecord).dispatch_type).toUpperCase();
    const billToDisplay = [
      toTrimmedString((so as JsonRecord).bill_to_name),
      toTrimmedString((so as JsonRecord).bill_to_address),
    ].filter(Boolean).join(", ") || null;
    const shipToDisplay = [
      toTrimmedString((so as JsonRecord).ship_to_name),
      toTrimmedString((so as JsonRecord).ship_to_address),
    ].filter(Boolean).join(", ") || billToDisplay;

    if (!DEPENDENT_DISPATCH_TYPES.has(dispatchType)) {
      // INDEPENDENT_PARTY / INDEPENDENT_PARTY_ASIAN_BILLED — Ship-To already
      // fixed at SO create, draw straight from sales_order_line.
      const drawnByLine = await computeDrawnQtyByColumn("so_line_id", lineRows.map((row) => String(row.id)));
      const withRemaining = lineRows.map((row) => {
        const total = Number(row.base_qty ?? row.quantity ?? 0);
        const drawn = drawnByLine.get(String(row.id)) ?? 0;
        return { ...row, source_kind: "SO_LINE_DIRECT", remaining_qty: Number((total - drawn).toFixed(6)) };
      }).filter((row) => row.remaining_qty > QTY_TOL);
      return okResponse({
        dispatch_type: dispatchType,
        mapping_required: false,
        groups: [{
          key: "direct",
          label: "Ship-To already fixed on this SO",
          bill_to_display: billToDisplay,
          ship_to_display: shipToDisplay,
          lines: await attachMaterialDisplay(withRemaining),
        }],
      }, ctx.request_id, req);
    }

    // DEPENDENT_* — read through SO Map's active allocations, grouped by
    // fo_id or customer_address_id.
    const { data: allocations, error: allocError } = await serviceRoleClient
      .schema("erp_procurement").from("sales_order_map_allocation")
      .select("*").eq("so_id", soId).eq("status", "ACTIVE");
    if (allocError) return doErrorResponse(req, ctx, "DO_SO_MAP_ALLOCATION_FETCH_FAILED", 500, "Unable to load SO Map allocations.");
    const allocationRows = (allocations ?? []) as JsonRecord[];
    // §133.9 Depot / No-Inbound-Depot: without an FO there is one already
    // resolved destination, so no customer-address mapping is required.
    if (toUpperTrimmedString((so as JsonRecord).bill_to_type) === "DEPOT" && allocationRows.length === 0) {
      const drawnByLine = await computeDrawnQtyByColumn("so_line_id", lineRows.map((row) => String(row.id)));
      const withRemaining = lineRows.map((row) => {
        const total = Number(row.base_qty ?? row.quantity ?? 0);
        const drawn = drawnByLine.get(String(row.id)) ?? 0;
        return { ...row, source_kind: "SO_LINE_DEPOT", remaining_qty: Number((total - drawn).toFixed(6)) };
      }).filter((row) => row.remaining_qty > QTY_TOL);
      return okResponse({
        dispatch_type: dispatchType,
        mapping_required: false,
        groups: [{
          key: "depot",
          label: "Depot Ship-To fixed on this SO",
          bill_to_display: billToDisplay,
          ship_to_display: shipToDisplay,
          lines: await attachMaterialDisplay(withRemaining),
        }],
      }, ctx.request_id, req);
    }
    const drawnByAllocation = await computeDrawnQtyByColumn("so_map_allocation_id", allocationRows.map((row) => String(row.id)));

    const foIds = [...new Set(allocationRows.map((row) => toTrimmedString(row.fo_id)).filter(Boolean))];
    const addressIds = [...new Set(allocationRows.map((row) => toTrimmedString(row.customer_address_id)).filter(Boolean))];
    const [{ data: foRows, error: foError }, { data: addressRows, error: addressError }] = await Promise.all([
      foIds.length
        ? serviceRoleClient.schema("erp_production").from("plan_feed").select("id, fo_number, party_id, party_name, customer_address_id").in("id", foIds)
        : Promise.resolve({ data: [] as JsonRecord[], error: null }),
      addressIds.length
        ? serviceRoleClient.schema("erp_master").from("customer_address").select("id, customer_id, site_name, address_line, town, state").in("id", addressIds)
        : Promise.resolve({ data: [] as JsonRecord[], error: null }),
    ]);
    if (foError) return doErrorResponse(req, ctx, "DO_FO_LOOKUP_FAILED", 500, "Unable to load FO details.");
    if (addressError) return doErrorResponse(req, ctx, "DO_ADDRESS_LOOKUP_FAILED", 500, "Unable to load customer address details.");
    const foMap = new Map(((foRows ?? []) as JsonRecord[]).map((row) => [String(row.id), row]));
    const foAddressIds = [...new Set(((foRows ?? []) as JsonRecord[]).map((row) => toTrimmedString(row.customer_address_id)).filter(Boolean))];
    const { data: foAddressRows, error: foAddressError } = foAddressIds.length
      ? await serviceRoleClient.schema("erp_master").from("customer_address").select("id, customer_id, site_name, address_line, town, state").in("id", foAddressIds)
      : { data: [] as JsonRecord[], error: null };
    if (foAddressError) return doErrorResponse(req, ctx, "DO_ADDRESS_LOOKUP_FAILED", 500, "Unable to load FO Ship-To address details.");
    const addressRowsTyped = [...((addressRows ?? []) as JsonRecord[]), ...((foAddressRows ?? []) as JsonRecord[])];
    const addressMap = new Map(addressRowsTyped.map((row) => [String(row.id), row]));
    const addressCustomerIds = [...new Set(addressRowsTyped.map((row) => toTrimmedString(row.customer_id)).filter(Boolean))];
    const { data: addressCustomers, error: addressCustomerError } = addressCustomerIds.length
      ? await serviceRoleClient.schema("erp_master").from("customer_master").select("id, customer_code, customer_name").in("id", addressCustomerIds)
      : { data: [] as JsonRecord[], error: null };
    if (addressCustomerError) return doErrorResponse(req, ctx, "DO_ADDRESS_CUSTOMER_LOOKUP_FAILED", 500, "Unable to load customer details for addresses.");
    const addressCustomerMap = new Map(((addressCustomers ?? []) as JsonRecord[]).map((row) => [String(row.id), row]));

    type GroupAcc = { key: string; label: string; bill_to_display: string | null; ship_to_display: string | null; lines: JsonRecord[] };
    const groups = new Map<string, GroupAcc>();
    for (const alloc of allocationRows) {
      const remaining = Number(alloc.allocated_qty ?? 0) - (drawnByAllocation.get(String(alloc.id)) ?? 0);
      if (remaining <= QTY_TOL) continue;
      const foId = toTrimmedString(alloc.fo_id);
      const addressId = toTrimmedString(alloc.customer_address_id);
      const depotId = toTrimmedString(alloc.depot_code_id);
      const groupKey = foId ? `fo:${foId}` : depotId ? `depot:${depotId}` : `addr:${addressId}`;
      if (!groups.has(groupKey)) {
        if (foId) {
          const fo = foMap.get(foId);
          const shipTo = fo ? addressMap.get(toTrimmedString(fo.customer_address_id)) : null;
          groups.set(groupKey, {
            key: groupKey,
            label: fo ? `FO ${fo.fo_number}` : "FO",
            bill_to_display: billToDisplay,
            ship_to_display: shipTo ? [shipTo.site_name, shipTo.address_line, shipTo.town, shipTo.state].filter(Boolean).join(", ") : null,
            lines: [],
          });
        } else if (depotId) {
          groups.set(groupKey, {
            key: groupKey,
            label: "Fixed Depot",
            bill_to_display: billToDisplay,
            ship_to_display: shipToDisplay,
            lines: [],
          });
        } else {
          const address = addressMap.get(addressId);
          const customer = address ? addressCustomerMap.get(toTrimmedString(address.customer_id)) : null;
          groups.set(groupKey, {
            key: groupKey,
            label: address ? `${address.site_name || address.town || "Address"}` : "Customer Address",
            bill_to_display: billToDisplay || (customer ? `${customer.customer_code ?? ""} — ${customer.customer_name ?? ""}`.trim() : null),
            ship_to_display: address ? [address.site_name, address.address_line, address.town, address.state].filter(Boolean).join(", ") : null,
            lines: [],
          });
        }
      }
      const sourceLine = lineMap.get(toTrimmedString(alloc.so_line_id));
      if (!sourceLine) continue;
      groups.get(groupKey)!.lines.push({
        ...sourceLine,
        source_kind: "SO_MAP_ALLOCATION",
        so_map_allocation_id: alloc.id,
        remaining_qty: Number(remaining.toFixed(6)),
      });
    }

    // §133.18 -- an FO-linked FG/SFG line can have MORE THAN ONE Packing PO
    // allocated to it (plan_feed_packing_order_allocation, qty-level). Which
    // one(s) a given DO draws from, and how much, is the user's own choice
    // at this exact step (business owner locked 2026-08-28: manual pick, not
    // FIFO -- all of an FO's Packing POs can legitimately be used, even
    // across separate DOs). Resolve every FO's allocated Packing POs here so
    // the picker can offer them, each with its own remaining balance
    // (actual_qty_kg minus whatever earlier non-cancelled DO lines already
    // drew from that specific Packing PO).
    const packingPoOptionsByFoAndMaterial = new Map<string, JsonRecord[]>();
    if (foIds.length > 0) {
      const foAllocRows = await fetchInChunks<JsonRecord>(foIds, (chunk) =>
        serviceRoleClient.schema("erp_production").from("plan_feed_packing_order_allocation")
          .select("plan_feed_id, packing_order_id, allocated_qty_kg").in("plan_feed_id", chunk));
      const pkoIds = [...new Set(foAllocRows.map((row) => toTrimmedString(row.packing_order_id)).filter(Boolean))];
      const [pkoRows, drawnByPko, drawnByFoPko] = await Promise.all([
        pkoIds.length
          ? fetchInChunks<JsonRecord>(pkoIds, (chunk) => serviceRoleClient.schema("erp_production").from("packing_order")
              .select("id, po_number, process_order_id, pack_code_id, batch_number, material_id, actual_qty_kg, fill_qty_per_pack, status").in("id", chunk))
          : Promise.resolve([] as JsonRecord[]),
        computeDrawnQtyByColumn("packing_order_id", pkoIds),
        computeDrawnQtyByFoPackingOrder(pkoIds),
      ]);
      const pkoMap = new Map(pkoRows.map((row) => [String(row.id), row]));
      const pkoMaterialIds = [...new Set(pkoRows.map((row) => toTrimmedString(row.material_id)).filter(Boolean))];
      const { data: pkoMaterials } = pkoMaterialIds.length
        ? await serviceRoleClient.schema("erp_master").from("material_master").select("id, document_name").in("id", pkoMaterialIds)
        : { data: [] as JsonRecord[] };
      const pkoMaterialMap = new Map(((pkoMaterials ?? []) as JsonRecord[]).map((row) => [String(row.id), row]));
      const packCodeIds = [...new Set(pkoRows.map((row) => toTrimmedString(row.pack_code_id)).filter(Boolean))];
      const { data: packCodeRows } = packCodeIds.length
        ? await serviceRoleClient.schema("erp_production").from("pack_code_master").select("id, pack_code").in("id", packCodeIds)
        : { data: [] as JsonRecord[] };
      const packCodeMap = new Map(((packCodeRows ?? []) as JsonRecord[]).map((row) => [String(row.id), toTrimmedString(row.pack_code)]));
      const processOrderIds = [...new Set(pkoRows.map((row) => toTrimmedString(row.process_order_id)).filter(Boolean))];
      const processOrderRows = processOrderIds.length
        ? await fetchInChunks<JsonRecord>(processOrderIds, (chunk) => serviceRoleClient.schema("erp_production").from("process_order")
          .select("id, po_number, stroke_master_id").in("id", chunk))
        : [];
      const processOrderMap = new Map(processOrderRows.map((row) => [String(row.id), row]));
      const strokeMasterIds = [...new Set(processOrderRows.map((row) => toTrimmedString(row.stroke_master_id)).filter(Boolean))];
      const strokeMasterRows = strokeMasterIds.length
        ? await fetchInChunks<JsonRecord>(strokeMasterIds, (chunk) => serviceRoleClient.schema("erp_production").from("stroke_master")
          .select("id, stroke_number, prodshade_material_id").in("id", chunk))
        : [];
      const strokeMasterMap = new Map(strokeMasterRows.map((row) => [String(row.id), row]));
      const prodshadeMaterialIds = [...new Set(strokeMasterRows.map((row) => toTrimmedString(row.prodshade_material_id)).filter(Boolean))];
      const { data: prodshadeMaterials } = prodshadeMaterialIds.length
        ? await serviceRoleClient.schema("erp_master").from("material_master").select("id, material_name").in("id", prodshadeMaterialIds)
        : { data: [] as JsonRecord[] };
      const prodshadeMaterialMap = new Map(((prodshadeMaterials ?? []) as JsonRecord[]).map((row) => [String(row.id), row]));
      for (const alloc of foAllocRows) {
        const pko = pkoMap.get(toTrimmedString(alloc.packing_order_id));
        if (!pko || toUpperTrimmedString(pko.status) !== "FINAL") continue;
        const drawn = drawnByPko.get(String(pko.id)) ?? 0;
        const foAllocated = Number(alloc.allocated_qty_kg ?? 0);
        const foDrawn = drawnByFoPko.get(`${toTrimmedString(alloc.plan_feed_id)}:${String(pko.id)}`) ?? 0;
        const remaining = Number(Math.min(Number(pko.actual_qty_kg ?? 0) - drawn, foAllocated - foDrawn).toFixed(6));
        if (remaining <= QTY_TOL) continue;
        const key = `${toTrimmedString(alloc.plan_feed_id)}:${toTrimmedString(pko.material_id)}`;
        if (!packingPoOptionsByFoAndMaterial.has(key)) packingPoOptionsByFoAndMaterial.set(key, []);
        const processOrder = processOrderMap.get(toTrimmedString(pko.process_order_id));
        const strokeMaster = processOrder ? strokeMasterMap.get(toTrimmedString(processOrder.stroke_master_id)) : null;
        const prodshade = strokeMaster ? prodshadeMaterialMap.get(toTrimmedString(strokeMaster.prodshade_material_id)) : null;
        packingPoOptionsByFoAndMaterial.get(key)!.push({
          packing_order_id: pko.id,
          po_number: pko.po_number,
          batch_number: pko.batch_number,
          fill_qty_per_pack: pko.fill_qty_per_pack,
          remaining_qty: remaining,
          document_name: toTrimmedString(pkoMaterialMap.get(toTrimmedString(pko.material_id))?.document_name) || null,
          prodshade_display: prodshade ? toTrimmedString(prodshade.material_name) || null : null,
          actual_stroke: strokeMaster ? toTrimmedString(strokeMaster.stroke_number) || null : null,
          process_order_number: processOrder ? toTrimmedString(processOrder.po_number) || null : null,
          packing_code: packCodeMap.get(toTrimmedString(pko.pack_code_id)) || null,
        });
      }
    }

    const groupList = await Promise.all(
      [...groups.values()].map(async (group) => ({ ...group, lines: await attachMaterialDisplay(group.lines) })),
    );

    // Attach packing_po_options per line, keyed by (this line's own group's
    // FO id, this line's material_id) -- done as a second pass since
    // attachMaterialDisplay (above) is what resolves material_id -> type,
    // and the FO id lives on the allocation, not the line itself.
    for (const groupKey of groups.keys()) {
      const foId = groupKey.startsWith("fo:") ? groupKey.slice(3) : null;
      if (!foId) continue;
      const resolvedGroup = groupList.find((g) => g.key === groupKey);
      if (!resolvedGroup) continue;
      resolvedGroup.lines = resolvedGroup.lines.map((line) => {
        const materialId = toTrimmedString(line.material_id);
        const options = packingPoOptionsByFoAndMaterial.get(`${foId}:${materialId}`) ?? [];
        return options.length > 0 ? { ...line, packing_po_options: options } : line;
      });
    }

    return okResponse({ dispatch_type: dispatchType, mapping_required: true, groups: groupList }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "DO_ADD_SO_OPTIONS_FAILED";
    return doErrorResponse(req, ctx, code, code === "COMPANY_SCOPE_VIOLATION" ? 403 : 500, code);
  }
}

// Page 1 "Add STO" — unchanged shape from the legacy single-source flow
// (STO has no SO-Map-style mapping concept, §133.9's mapping rules are
// SO-only), just qty-based remaining balance instead of a boolean lock.
export async function listDoAddStoOptionsHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const url = new URL(req.url);
    const stoId = toTrimmedString(url.searchParams.get("sto_id"));
    if (!stoId) return doErrorResponse(req, ctx, "DO_ADD_STO_ID_MISSING", 400, "sto_id is required.");

    const { data: sto, error: stoError } = await serviceRoleClient
      .schema("erp_procurement").from("stock_transfer_order").select("*").eq("id", stoId).maybeSingle();
    if (stoError || !sto) return doErrorResponse(req, ctx, "DO_SOURCE_NOT_FOUND", 404, "STO not found.");
    try {
      await assertCompanyScope(ctx, toTrimmedString((sto as JsonRecord).sending_company_id));
    } catch {
      return doErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }
    if (!["CREATED", "DISPATCHED"].includes(toTrimmedString((sto as JsonRecord).status).toUpperCase())) {
      return doErrorResponse(req, ctx, "DO_SOURCE_NOT_DISPATCHABLE", 400, "This STO is not in a dispatchable status.");
    }

    const { data: lines, error: linesError } = await serviceRoleClient
      .schema("erp_procurement").from("stock_transfer_order_line").select("*").eq("sto_id", stoId).order("line_number", { ascending: true });
    if (linesError) return doErrorResponse(req, ctx, "DO_SOURCE_LINES_FAILED", 500, "Unable to load STO lines.");
    const lineRows = (lines ?? []) as JsonRecord[];
    const drawnByLine = await computeDrawnQtyByColumn("sto_line_id", lineRows.map((row) => String(row.id)));
    const withRemaining = lineRows.map((row) => {
      const total = Number(row.quantity ?? 0);
      const drawn = drawnByLine.get(String(row.id)) ?? 0;
      return { ...row, source_kind: "STO_LINE_DIRECT", remaining_qty: Number((total - drawn).toFixed(6)) };
    }).filter((row) => row.remaining_qty > QTY_TOL);

    const receivingCompanyId = toTrimmedString((sto as JsonRecord).receiving_company_id);
    const { data: receivingCompany, error: receivingCompanyError } = receivingCompanyId
      ? await serviceRoleClient.schema("erp_master").from("companies").select("id, company_code, company_name").eq("id", receivingCompanyId).maybeSingle()
      : { data: null as JsonRecord | null, error: null };
    if (receivingCompanyError) return doErrorResponse(req, ctx, "DO_RECEIVING_COMPANY_LOOKUP_FAILED", 500, "Unable to load receiving company.");

    return okResponse({
      groups: [{
        key: "sto",
        label: `STO ${toTrimmedString((sto as JsonRecord).sto_number)}`,
        bill_to_display: receivingCompany ? `${receivingCompany.company_code ?? ""} — ${receivingCompany.company_name ?? ""}`.trim() : null,
        ship_to_display: receivingCompany ? `${receivingCompany.company_code ?? ""} — ${receivingCompany.company_name ?? ""}`.trim() : null,
        lines: await attachMaterialDisplay(withRemaining),
      }],
    }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "DO_ADD_STO_OPTIONS_FAILED";
    return doErrorResponse(req, ctx, code, code === "COMPANY_SCOPE_VIOLATION" ? 403 : 500, code);
  }
}

// §133.12 Page 2 — storage location dropdown + Available Qty for one
// material. Default resolution: material_plant_ext.default_storage_
// location_id (same default GRN landing already uses) is marked first/
// default when it also carries stock; every other UNRESTRICTED-stocked
// location for this material+company is offered too (multi-location split,
// §133.12 Page 2's "100 KG দরকার, R003-এ 75, S003-এ 40" example).
export async function listDoStorageOptionsHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const url = new URL(req.url);
    const companyId = toTrimmedString(url.searchParams.get("company_id"));
    const materialId = toTrimmedString(url.searchParams.get("material_id"));
    if (!companyId || !materialId) {
      return doErrorResponse(req, ctx, "DO_LOCATION_FILTERS_REQUIRED", 400, "company_id and material_id are required.");
    }
    try {
      await assertCompanyScope(ctx, companyId);
    } catch {
      return doErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }

    const [{ data: snapshotRows, error: snapshotError }, { data: defaultRow, error: defaultError }] = await Promise.all([
      serviceRoleClient
        .schema("erp_inventory").from("stock_snapshot")
        .select("storage_location_id, quantity")
        .eq("company_id", companyId).eq("material_id", materialId).eq("stock_type_code", "UNRESTRICTED")
        .is("batch_id", null).gt("quantity", 0),
      serviceRoleClient
        .schema("erp_master").from("material_plant_ext")
        .select("default_storage_location_id")
        .eq("company_id", companyId).eq("material_id", materialId).maybeSingle(),
    ]);
    if (snapshotError) return doErrorResponse(req, ctx, "DO_LOCATION_LOOKUP_FAILED", 500, "Unable to look up storage locations.");
    if (defaultError) return doErrorResponse(req, ctx, "DO_DEFAULT_LOCATION_LOOKUP_FAILED", 500, "Unable to look up the default storage location.");
    const defaultLocationId = toTrimmedString((defaultRow as JsonRecord | null)?.default_storage_location_id);

    const locationIds = [...new Set(((snapshotRows ?? []) as JsonRecord[]).map((row) => toTrimmedString(row.storage_location_id)).filter(Boolean))];
    if (defaultLocationId && !locationIds.includes(defaultLocationId)) locationIds.push(defaultLocationId);

    const [{ data: locations, error: locationError }, availabilityEntries] = await Promise.all([
      locationIds.length
        ? serviceRoleClient.schema("erp_inventory").from("storage_location_master").select("id, code, name").in("id", locationIds)
        : Promise.resolve({ data: [] as JsonRecord[], error: null }),
      Promise.all(locationIds.map(async (locationId) => [locationId, await getAvailableQty(companyId, locationId, materialId)] as const)),
    ]);
    if (locationError) return doErrorResponse(req, ctx, "DO_LOCATION_LOOKUP_FAILED", 500, "Unable to resolve storage location names.");
    const locationMap = new Map(((locations ?? []) as JsonRecord[]).map((row) => [String(row.id), row]));
    const availabilityMap = new Map(availabilityEntries);

    const items = locationIds
      .map((locationId) => {
        const location = locationMap.get(locationId);
        return {
          storage_location_id: locationId,
          location_display: location ? `${location.code ?? ""} — ${location.name ?? ""}`.trim() : null,
          available_qty: availabilityMap.get(locationId) ?? 0,
          is_default: locationId === defaultLocationId,
        };
      })
      .filter((row) => row.available_qty > QTY_TOL)
      .sort((a, b) => (a.is_default === b.is_default ? 0 : a.is_default ? -1 : 1));

    return okResponse({ items }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "DO_LOCATION_LOOKUP_FAILED";
    return doErrorResponse(req, ctx, code, code === "COMPANY_SCOPE_VIOLATION" ? 403 : 500, code);
  }
}

// company-scope-write-acl-guard.mjs pattern (same template as sales_order.
// handlers.ts's canMaintainSo01Create / so_map.handlers.ts's
// canMaintainSoMap) — assertCompanyScope only proves company MEMBERSHIP,
// not that the caller's ACL grant at this SPECIFIC target company is WRITE
// for PROC_DO_CREATE. A multi-company Stores/Logistics user with WRITE at
// their session's company but only membership elsewhere must not be able
// to create a DO for a company they don't have that grant at.
async function canMaintainDoCreate(
  ctx: ProcurementHandlerContext,
  companyId: string,
  actionCode: "WRITE" | "EDIT" = "WRITE",
): Promise<boolean> {
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
    db: serviceRoleClient,
    aclVersionId: versionRow.acl_version_id as string,
    authUserId: ctx.auth_user_id,
    companyId,
    workContextIds,
    resourceCode: "PROC_DO_CREATE",
    actionCode,
  });
  if (error || !data) return false;
  return data.decision === "ALLOW";
}

type PreparedDoLine = {
  materialId: string;
  quantity: number;
  storageLocationId: string;
  soLineId: string | null;
  stoLineId: string | null;
  soMapAllocationId: string | null;
  batchNumber: string | null;
  expiryDate: string | null;
  packingOrderId: string | null;
  uomCode: string;
  unitValue: number;
  gstRate: number;
  gstAmount: number;
  // §133.21 -- original SO-time rate choice, frozen here purely for
  // Invoice/PGI preview display. unitValue/uomCode above stay per-base-UOM
  // (what every downstream stock/value calculation actually uses); these
  // three exist only so the invoice can show "Rate 500 / Per BBL" instead of
  // always converting to a per-KG figure, even when the SO was entered as
  // Pack UoM or Fixed. Null for STO lines (no rate_basis concept there).
  displayRateBasis: string | null;
  displayRate: number | null;
  displayUomCode: string | null;
  // §133.21 follow-up (2026-09-02) -- this line's own pack count (this
  // Packing PO's drawn quantity ÷ per_pack_qty), for the same
  // display-only reason: delivery_challan_line never carried Pack Qty at
  // all before this, so Invoice/PGI's preview only ever showed base KG.
  packQty: number | null;
  packUomCode: string | null;
  shipToCustomerId: string | null;
  shipToName: string | null;
  shipToAddress: string | null;
  shipToState: string | null;
  shipToGstNumber: string | null;
  sourceType: "SALES_ORDER" | "STO";
  sourceId: string;
};

type PreparedDoLineSet = {
  prepared: PreparedDoLine[];
  soIdsForSources: Set<string>;
  stoIdsForSources: Set<string>;
  netWeight: number;
  dcType: "SALES" | "STO" | "MIXED";
};

// Shared by Create and Edit — re-validates every line server-side (never
// trusts the Page 1/2 client-side preview for anything that matters):
// remaining balance against its source (SO line, SO Map allocation, or STO
// line) and Available stock at the chosen location, exactly like Page 1/2's
// own endpoints computed it, just re-checked fresh at the moment of commit.
// Throws Error(code) on any validation failure — callers catch and map the
// same way createDeliveryOrderUnifiedHandler's own catch block already does.
// Edit calls this only AFTER tearing down its own old lines/reservations
// (§133.12), so "remaining balance" here is never polluted by the very
// lines this same DO is about to replace.
async function prepareAndValidateDoLines(companyId: string, rawLines: JsonRecord[], excludeDcId?: string): Promise<PreparedDoLineSet> {
  const soLineIds = [...new Set(rawLines.map((l) => toTrimmedString(l.so_line_id)).filter(Boolean))];
    const stoLineIds = [...new Set(rawLines.map((l) => toTrimmedString(l.sto_line_id)).filter(Boolean))];
    const allocationIds = [...new Set(rawLines.map((l) => toTrimmedString(l.so_map_allocation_id)).filter(Boolean))];

    const [soLineRows, stoLineRows, allocationRows, drawnBySoLine, drawnByStoLine, drawnByAllocation] = await Promise.all([
      soLineIds.length
        ? fetchInChunks<JsonRecord>(soLineIds, (chunk) => serviceRoleClient.schema("erp_procurement").from("sales_order_line").select("*").in("id", chunk))
        : Promise.resolve([] as JsonRecord[]),
      stoLineIds.length
        ? fetchInChunks<JsonRecord>(stoLineIds, (chunk) => serviceRoleClient.schema("erp_procurement").from("stock_transfer_order_line").select("*").in("id", chunk))
        : Promise.resolve([] as JsonRecord[]),
      allocationIds.length
        ? fetchInChunks<JsonRecord>(allocationIds, (chunk) => serviceRoleClient.schema("erp_procurement").from("sales_order_map_allocation").select("*").in("id", chunk))
        : Promise.resolve([] as JsonRecord[]),
      computeDrawnQtyByColumn("so_line_id", soLineIds, excludeDcId),
      computeDrawnQtyByColumn("sto_line_id", stoLineIds, excludeDcId),
      computeDrawnQtyByColumn("so_map_allocation_id", allocationIds, excludeDcId),
    ]);
    // SO Map submissions identify the allocation, not necessarily its underlying
    // SO line. Load those source lines too before validating the allocation.
    const directlyLoadedSoLineIds = new Set(soLineRows.map((row) => String(row.id)));
    const allocationSoLineIds = [...new Set(
      allocationRows.map((row) => toTrimmedString(row.so_line_id)).filter(Boolean),
    )];
    const missingAllocationSoLineIds = allocationSoLineIds.filter((id) => !directlyLoadedSoLineIds.has(id));
    const allocationSourceLineRows = missingAllocationSoLineIds.length
      ? await fetchInChunks<JsonRecord>(
        missingAllocationSoLineIds,
        (chunk) => serviceRoleClient.schema("erp_procurement").from("sales_order_line").select("*").in("id", chunk),
      )
      : [];
    const soLineMap = new Map(
      [...soLineRows, ...allocationSourceLineRows].map((row) => [String(row.id), row]),
    );
    const stoLineMap = new Map(stoLineRows.map((row) => [String(row.id), row]));
    const allocationMap = new Map(allocationRows.map((row) => [String(row.id), row]));

    // §133.18 -- never trust a client-submitted packing_order_id for an
    // FO-linked line without checking it's actually one of that FO's own
    // allocated Packing POs, with real remaining balance (external draws +
    // whatever this same submission already uses against it, since one
    // submission can legitimately split across several lines/materials
    // drawing from the same Packing PO's own multiple SKUs -- rare but not
    // disallowed).
    const submittedPkoIds = [...new Set(rawLines.map((l) => toTrimmedString(l.packing_order_id)).filter(Boolean))];
    const [validFoPkoPairs, pkoRowsForValidation, drawnByPko, drawnByFoPko] = await Promise.all([
      submittedPkoIds.length
        ? fetchInChunks<JsonRecord>(submittedPkoIds, (chunk) => serviceRoleClient.schema("erp_production").from("plan_feed_packing_order_allocation")
            .select("plan_feed_id, packing_order_id, allocated_qty_kg").in("packing_order_id", chunk))
        : Promise.resolve([] as JsonRecord[]),
      submittedPkoIds.length
        ? fetchInChunks<JsonRecord>(submittedPkoIds, (chunk) => serviceRoleClient.schema("erp_production").from("packing_order")
            .select("id, actual_qty_kg, status").in("id", chunk))
        : Promise.resolve([] as JsonRecord[]),
      computeDrawnQtyByColumn("packing_order_id", submittedPkoIds, excludeDcId),
      computeDrawnQtyByFoPackingOrder(submittedPkoIds, excludeDcId),
    ]);
    const validFoPkoPairSet = new Set(validFoPkoPairs.map((row) => `${toTrimmedString(row.plan_feed_id)}:${toTrimmedString(row.packing_order_id)}`));
    const allocatedByFoPko = new Map(validFoPkoPairs.map((row) => [
      `${toTrimmedString(row.plan_feed_id)}:${toTrimmedString(row.packing_order_id)}`,
      Number(row.allocated_qty_kg ?? 0),
    ]));
    const pkoRemainingMap = new Map(pkoRowsForValidation.map((row) => [
      String(row.id),
      toUpperTrimmedString(row.status) === "FINAL" ? Number(row.actual_qty_kg ?? 0) - (drawnByPko.get(String(row.id)) ?? 0) : 0,
    ]));
    const pkoUsedInThisSubmission = new Map<string, number>();
    const foPkoUsedInThisSubmission = new Map<string, number>();
    // Found live 2026-09-02 (business owner, FO 5157405986 -- an FO's Mapped
    // Qty split exactly across two Packing POs): the PPO-pair maps above
    // already prevent over-drawing a single (FO, Packing PO) pair across
    // sibling lines in one submission, but this line's own SO Map allocation
    // remaining-balance check (below) only ever compared against PRIOR DOs
    // (drawnByAllocation, fetched once before this loop) -- never against a
    // sibling line drawing from the SAME allocation via a DIFFERENT Packing
    // PO in this same submission. Harmless while every FO's Packing-PO
    // allocations happen to sum exactly to its own Mapped Qty (true today),
    // but that's a Plan Feed-side invariant this handler shouldn't silently
    // depend on -- this makes the <= check exact regardless.
    const allocationUsedInThisSubmission = new Map<string, number>();

    // SO ids referenced (directly or via an allocation) + STO ids, for the
    // new delivery_challan_source rows (§133.12) and company-scope re-check
    // per source (a multi-company user could otherwise mix a line from a
    // company they can't touch into a DO scoped to one they can).
    const soIdsForSources = new Set<string>();
    const stoIdsForSources = new Set<string>();

    const prepared: PreparedDoLine[] = [];
    for (let index = 0; index < rawLines.length; index += 1) {
      const raw = rawLines[index];
      const quantity = parsePositiveNumber(raw.quantity);
      const storageLocationId = toTrimmedString(raw.storage_location_id);
      if (!quantity || !storageLocationId) {
        throw new Error("DO_LINE_INVALID");
      }

      const soMapAllocationId = toTrimmedString(raw.so_map_allocation_id);
      const soLineId = toTrimmedString(raw.so_line_id);
      const stoLineId = toTrimmedString(raw.sto_line_id);

      let materialId: string;
      let uomCode: string;
      let remaining: number;
      let sourceType: "SALES_ORDER" | "STO";
      let sourceId: string;
      let batchNumber: string | null = toTrimmedString(raw.batch_number) || null;
      let expiryDate: string | null = toTrimmedString(raw.expiry_date) || null;
      let packingOrderId: string | null = toTrimmedString(raw.packing_order_id) || null;
      let salesSourceLine: JsonRecord | null = null;

      if (soMapAllocationId) {
        const allocation = allocationMap.get(soMapAllocationId);
        if (!allocation) throw new Error("DO_SO_MAP_ALLOCATION_NOT_FOUND");
        const sourceLine = soLineMap.get(toTrimmedString(allocation.so_line_id));
        if (!sourceLine) throw new Error("DO_SOURCE_LINE_NOT_FOUND");
        materialId = toTrimmedString(sourceLine.material_id);
        salesSourceLine = sourceLine;
        uomCode = toTrimmedString(sourceLine.uom_code);
        remaining = Number(allocation.allocated_qty ?? 0) - (drawnByAllocation.get(soMapAllocationId) ?? 0)
          - (allocationUsedInThisSubmission.get(soMapAllocationId) ?? 0);
        sourceType = "SALES_ORDER";
        sourceId = toTrimmedString(allocation.so_id);
        if (!batchNumber) batchNumber = toTrimmedString(sourceLine.batch_number) || null;
        if (!packingOrderId) packingOrderId = toTrimmedString(sourceLine.packing_order_id) || null;
        // §133.18 -- manual Packing PO choice for an FO-linked line: verify
        // it's actually one of THIS FO's own allocated Packing POs (not some
        // other FO's), and that it has enough remaining balance left after
        // accounting for both earlier DOs and any other line in this same
        // submission already drawing from it.
        if (packingOrderId) {
          const foId = toTrimmedString(allocation.fo_id);
          if (!foId || !validFoPkoPairSet.has(`${foId}:${packingOrderId}`)) {
            throw new Error("DO_PACKING_ORDER_NOT_ALLOCATED_TO_FO");
          }
          const alreadyUsed = pkoUsedInThisSubmission.get(packingOrderId) ?? 0;
          const pkoRemaining = (pkoRemainingMap.get(packingOrderId) ?? 0) - alreadyUsed;
          if (pkoRemaining < quantity - QTY_TOL) {
            throw new Error("DO_PACKING_ORDER_INSUFFICIENT_BALANCE");
          }
          const foPkoKey = `${foId}:${packingOrderId}`;
          const foAlreadyUsed = foPkoUsedInThisSubmission.get(foPkoKey) ?? 0;
          const foAllocationRemaining = (allocatedByFoPko.get(foPkoKey) ?? 0)
            - (drawnByFoPko.get(foPkoKey) ?? 0) - foAlreadyUsed;
          if (foAllocationRemaining < quantity - QTY_TOL) {
            throw new Error("DO_PACKING_ORDER_ALLOCATION_EXCEEDED");
          }
          pkoUsedInThisSubmission.set(packingOrderId, alreadyUsed + quantity);
          foPkoUsedInThisSubmission.set(foPkoKey, foAlreadyUsed + quantity);
        }
      } else if (soLineId) {
        const sourceLine = soLineMap.get(soLineId);
        if (!sourceLine) throw new Error("DO_SOURCE_LINE_NOT_FOUND");
        materialId = toTrimmedString(sourceLine.material_id);
        salesSourceLine = sourceLine;
        uomCode = toTrimmedString(sourceLine.uom_code);
        remaining = Number(sourceLine.base_qty ?? sourceLine.quantity ?? 0) - (drawnBySoLine.get(soLineId) ?? 0);
        sourceType = "SALES_ORDER";
        sourceId = toTrimmedString(sourceLine.so_id);
        if (!batchNumber) batchNumber = toTrimmedString(sourceLine.batch_number) || null;
        if (!packingOrderId) packingOrderId = toTrimmedString(sourceLine.packing_order_id) || null;
      } else if (stoLineId) {
        const sourceLine = stoLineMap.get(stoLineId);
        if (!sourceLine) throw new Error("DO_SOURCE_LINE_NOT_FOUND");
        materialId = toTrimmedString(sourceLine.material_id);
        uomCode = toTrimmedString(sourceLine.uom_code);
        remaining = Number(sourceLine.balance_qty ?? 0) - (drawnByStoLine.get(stoLineId) ?? 0);
        sourceType = "STO";
        sourceId = toTrimmedString(sourceLine.sto_id);
      } else {
        throw new Error("DO_LINE_SOURCE_MISSING");
      }

      if (quantity > remaining + QTY_TOL) {
        throw new Error("DO_QTY_EXCEEDS_BALANCE");
      }
      if (soMapAllocationId) {
        allocationUsedInThisSubmission.set(soMapAllocationId, (allocationUsedInThisSubmission.get(soMapAllocationId) ?? 0) + quantity);
      }
      const available = await getAvailableQty(companyId, storageLocationId, materialId);
      if (quantity > available + QTY_TOL) {
        throw new Error("INSUFFICIENT_STOCK");
      }

      if (sourceType === "SALES_ORDER") soIdsForSources.add(sourceId); else stoIdsForSources.add(sourceId);
      const rawRate = Number(salesSourceLine?.rate ?? 0);
      const rateBasis = toUpperTrimmedString(salesSourceLine?.rate_basis);
      const sourceBaseQty = Number(salesSourceLine?.base_qty ?? salesSourceLine?.quantity ?? 0);
      const perPackQty = Number(salesSourceLine?.per_pack_qty ?? 0);
      // All DO/Invoice figures are base-quantity based. Convert a Pack or
      // fixed SO price to its proportional value before freezing this slice.
      const unitValue = rateBasis === "PACK_UOM" && perPackQty > 0
        ? rawRate / perPackQty
        : rateBasis === "FIXED" && sourceBaseQty > 0
          ? rawRate / sourceBaseQty
          : rawRate;
      const gstRate = Number(salesSourceLine?.gst_rate ?? 0);
      const gstAmount = Number((unitValue * quantity * gstRate / 100).toFixed(4));
      // §133.21 -- freeze exactly what the SO line was entered as, for
      // display only (see PreparedDoLine comment above).
      const displayRateBasis = salesSourceLine ? (rateBasis || null) : null;
      const displayRate = salesSourceLine ? rawRate : null;
      const displayUomCode = rateBasis === "PACK_UOM"
        ? (toTrimmedString(salesSourceLine?.pack_uom_code) || null)
        : rateBasis === "BASE_UOM"
          ? (toTrimmedString(salesSourceLine?.uom_code) || null)
          : null;
      // This specific line's own drawn pack count -- e.g. when an FO's
      // Mapped Qty is split across two Packing POs, this is that ONE
      // Packing PO's pack count, not the FO's overall total.
      const packQty = perPackQty > 0 ? Number((quantity / perPackQty).toFixed(6)) : null;
      const packUomCode = toTrimmedString(salesSourceLine?.pack_uom_code) || null;
      prepared.push({
        materialId, quantity, storageLocationId,
        soLineId: soLineId || (soMapAllocationId ? toTrimmedString(allocationMap.get(soMapAllocationId)?.so_line_id) : null) || null,
        stoLineId: stoLineId || null,
        soMapAllocationId: soMapAllocationId || null,
        batchNumber, expiryDate, packingOrderId, uomCode, unitValue, gstRate, gstAmount,
        displayRateBasis, displayRate, displayUomCode, packQty, packUomCode,
        shipToCustomerId: null, shipToName: null, shipToAddress: null, shipToState: null, shipToGstNumber: null,
        sourceType, sourceId,
      });
    }

    // Cross-company guard — every referenced SO/STO must belong to companyId.
    const { data: referencedSos, error: referencedSosError } = soIdsForSources.size
      ? await serviceRoleClient.schema("erp_procurement").from("sales_order").select("id, company_id").in("id", [...soIdsForSources])
      : { data: [] as JsonRecord[], error: null };
    if (referencedSosError) throw new Error("DO_SOURCE_COMPANY_CHECK_FAILED");
    if (((referencedSos ?? []) as JsonRecord[]).some((row) => toTrimmedString(row.company_id) !== companyId)) {
      throw new Error("DO_SOURCE_COMPANY_MISMATCH");
    }
    const { data: referencedStos, error: referencedStosError } = stoIdsForSources.size
      ? await serviceRoleClient.schema("erp_procurement").from("stock_transfer_order").select("id, sending_company_id").in("id", [...stoIdsForSources])
      : { data: [] as JsonRecord[], error: null };
    if (referencedStosError) throw new Error("DO_SOURCE_COMPANY_CHECK_FAILED");
    if (((referencedStos ?? []) as JsonRecord[]).some((row) => toTrimmedString(row.sending_company_id) !== companyId)) {
      throw new Error("DO_SOURCE_COMPANY_MISMATCH");
    }

    const netWeight = Number(prepared.reduce((sum, line) => sum + line.quantity, 0).toFixed(4));
    const dcType: "SALES" | "STO" | "MIXED" = soIdsForSources.size > 0 && stoIdsForSources.size > 0 ? "MIXED" : soIdsForSources.size > 0 ? "SALES" : "STO";

    return { prepared, soIdsForSources, stoIdsForSources, netWeight, dcType };
}

async function freezeDoSalesShipTo(prepared: PreparedDoLine[]): Promise<void> {
  for (const line of prepared) {
    if (line.sourceType !== "SALES_ORDER") continue;
    const { data: so, error: soError } = await serviceRoleClient.schema("erp_procurement").from("sales_order")
      .select("customer_id, ship_to_name, ship_to_address, ship_to_state, ship_to_gst_number").eq("id", line.sourceId).single();
    if (soError || !so) throw new Error("DO_SOURCE_SO_FETCH_FAILED");
    line.shipToCustomerId = toTrimmedString((so as JsonRecord).customer_id) || null;
    line.shipToName = toTrimmedString((so as JsonRecord).ship_to_name) || null;
    line.shipToAddress = toTrimmedString((so as JsonRecord).ship_to_address) || null;
    line.shipToState = toTrimmedString((so as JsonRecord).ship_to_state) || null;
    line.shipToGstNumber = toTrimmedString((so as JsonRecord).ship_to_gst_number) || null;
    if (!line.soMapAllocationId) continue;
    const { data: allocation, error: allocationError } = await serviceRoleClient.schema("erp_procurement").from("sales_order_map_allocation")
      .select("fo_id, customer_address_id").eq("id", line.soMapAllocationId).single();
    if (allocationError || !allocation) throw new Error("DO_SO_MAP_ALLOCATION_NOT_FOUND");
    let addressId = toTrimmedString((allocation as JsonRecord).customer_address_id);
    const foId = toTrimmedString((allocation as JsonRecord).fo_id);
    if (!addressId && foId) {
      const { data: fo, error: foError } = await serviceRoleClient.schema("erp_production").from("plan_feed")
        .select("customer_address_id").eq("id", foId).single();
      if (foError || !fo) throw new Error("DO_FO_SHIP_TO_LOOKUP_FAILED");
      addressId = toTrimmedString((fo as JsonRecord).customer_address_id);
    }
    if (!addressId) continue;
    const { data: address, error: addressError } = await serviceRoleClient.schema("erp_master").from("customer_address")
      .select("customer_id, site_name, address_line, town, state, pin_code").eq("id", addressId).single();
    if (addressError || !address) throw new Error("DO_SHIP_TO_ADDRESS_LOOKUP_FAILED");
    const customerId = toTrimmedString((address as JsonRecord).customer_id);
    const { data: customer, error: customerError } = await serviceRoleClient.schema("erp_master").from("customer_master")
      .select("customer_name, gst_number").eq("id", customerId).single();
    if (customerError || !customer) throw new Error("DO_SHIP_TO_CUSTOMER_LOOKUP_FAILED");
    line.shipToCustomerId = customerId;
    line.shipToName = toTrimmedString((customer as JsonRecord).customer_name) || toTrimmedString((address as JsonRecord).site_name) || null;
    line.shipToAddress = ["address_line", "town", "pin_code"].map((key) => toTrimmedString((address as JsonRecord)[key])).filter(Boolean).join(", ") || null;
    line.shipToState = toTrimmedString((address as JsonRecord).state) || null;
    line.shipToGstNumber = toTrimmedString((customer as JsonRecord).gst_number) || null;
  }
}

function buildDoAtomicPayload(
  companyId: string,
  dcNumber: string | null,
  body: JsonRecord,
  prepared: PreparedDoLine[],
  soIdsForSources: Set<string>,
  stoIdsForSources: Set<string>,
  netWeight: number,
  dcType: "SALES" | "STO" | "MIXED",
): JsonRecord {
  return {
    header: {
      dc_number: dcNumber,
      dc_date: todayIsoDate(),
      dc_type: dcType,
      selling_company_id: companyId,
      vehicle_number: toTrimmedString(body.vehicle_number) || null,
      transporter_id: toTrimmedString(body.transporter_id) || null,
      transporter_name_freetext: toTrimmedString(body.transporter_name_freetext) || null,
      lr_number: toTrimmedString(body.lr_number) || null,
      lr_date: toTrimmedString(body.lr_date) || null,
      gross_weight: parsePositiveNumber(body.gross_weight),
      net_weight: netWeight,
      driver_number: toTrimmedString(body.driver_number) || null,
      driver_contact_number: toTrimmedString(body.driver_contact_number) || null,
      remarks: toTrimmedString(body.remarks) || null,
    },
    sources: [
      ...[...soIdsForSources].map((source_id) => ({ source_type: "SALES_ORDER", source_id })),
      ...[...stoIdsForSources].map((source_id) => ({ source_type: "STO", source_id })),
    ],
    lines: prepared.map((line, index) => ({
      line_number: index + 1,
      material_id: line.materialId,
      so_line_id: line.soLineId,
      sto_line_id: line.stoLineId,
      so_map_allocation_id: line.soMapAllocationId,
      quantity: line.quantity,
      uom_code: line.uomCode,
      storage_location_id: line.storageLocationId,
      batch_number: line.batchNumber,
      expiry_date: line.expiryDate,
      packing_order_id: line.packingOrderId,
      unit_value: line.unitValue,
      gst_rate: line.gstRate,
      gst_amount: line.gstAmount,
      line_total: Number((line.quantity * line.unitValue + line.gstAmount).toFixed(4)),
      display_rate_basis: line.displayRateBasis,
      display_rate: line.displayRate,
      display_uom_code: line.displayUomCode,
      pack_qty: line.packQty,
      pack_uom_code: line.packUomCode,
      ship_to_customer_id: line.shipToCustomerId,
      ship_to_name: line.shipToName,
      ship_to_address: line.shipToAddress,
      ship_to_state: line.shipToState,
      ship_to_gst_number: line.shipToGstNumber,
      source_type: line.sourceType,
      source_id: line.sourceId,
    })),
  };
}

// §133.12 Page 3 — Save. Header is created here; line validation is shared
// with Edit via prepareAndValidateDoLines above.
export async function createDeliveryOrderUnifiedHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const body = await parseBody(req);
    const companyId = toTrimmedString(body.company_id);
    const rawLines = Array.isArray(body.lines) ? (body.lines as JsonRecord[]) : [];
    if (!companyId || rawLines.length === 0) {
      return doErrorResponse(req, ctx, "DO_CREATE_INVALID", 400, "company_id and at least one line are required.");
    }
    const lrDate = toTrimmedString(body.lr_date);
    if (lrDate && !isManualDocumentDateWithinWindow(lrDate)) {
      return doErrorResponse(req, ctx, "DO_MANUAL_DATE_OUTSIDE_ALLOWED_WINDOW", 400, MANUAL_DOCUMENT_DATE_WINDOW_MESSAGE);
    }
    try {
      await assertCompanyScope(ctx, companyId);
    } catch {
      return doErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }
    if (!(await canMaintainDoCreate(ctx, companyId, "WRITE"))) {
      return doErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have Create-DO access at this company.");
    }

    const { prepared, soIdsForSources, stoIdsForSources, netWeight, dcType } = await prepareAndValidateDoLines(companyId, rawLines);
    await freezeDoSalesShipTo(prepared);

    const payload = buildDoAtomicPayload(companyId, await generateProcurementDocNumber("DC"), body, prepared, soIdsForSources, stoIdsForSources, netWeight, dcType);
    const { data: dcId, error } = await serviceRoleClient.schema("erp_procurement").rpc("save_delivery_order_unified_atomic", {
      p_action: "CREATE", p_dc_id: null, p_header: payload.header, p_sources: payload.sources, p_lines: payload.lines, p_actor: ctx.auth_user_id,
    });
    if (error || !dcId) return doErrorResponse(req, ctx, "DO_CREATE_FAILED", 500, "Unable to create delivery order.");
    return okResponse(await hydrateDeliveryOrderUnified(String(dcId)), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "DO_CREATE_FAILED";
    const status = code === "COMPANY_SCOPE_VIOLATION" ? 403
      : ["DO_QTY_EXCEEDS_BALANCE", "INSUFFICIENT_STOCK", "DO_CREATE_INVALID", "DO_LINE_INVALID", "DO_LINE_SOURCE_MISSING", "DO_SOURCE_COMPANY_MISMATCH", "DO_PACKING_ORDER_NOT_ALLOCATED_TO_FO", "DO_PACKING_ORDER_INSUFFICIENT_BALANCE", "DO_PACKING_ORDER_ALLOCATION_EXCEEDED"].includes(code) ? 400
      : code.includes("NOT_FOUND") ? 404
      : 500;
    return doErrorResponse(req, ctx, code, status, code);
  }
}

// §133.12 — "Invoicing হওয়ার আগে পর্যন্ত DO freely Edit/Cancel করা যায়".
// Edit fully replaces the line set (simplest correct approach given a line
// can move material/qty/location arbitrarily): tear down this DO's own old
// lines/reservations first (never touching any OTHER DO's reservations,
// thanks to the dc_line_id link), undo their CSN sync, THEN re-run the exact
// same prepareAndValidateDoLines validation Create uses against a clean
// slate — so "remaining balance" is never polluted by the very lines this
// same DO is about to replace. Same non-transactional multi-step shape the
// rest of this codebase's pre-§8D-step-4 handlers already have — not a new
// class of risk, just consistent with the existing baseline.
export async function updateDeliveryOrderUnifiedHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const dcId = getIdFromPath(req);
    if (!dcId) return doErrorResponse(req, ctx, "DO_ID_REQUIRED", 400, "Delivery order id is required.");
    const body = await parseBody(req);
    const rawLines = Array.isArray(body.lines) ? (body.lines as JsonRecord[]) : [];
    if (rawLines.length === 0) return doErrorResponse(req, ctx, "DO_EDIT_INVALID", 400, "At least one line is required.");
    const lrDate = toTrimmedString(body.lr_date);
    if (lrDate && !isManualDocumentDateWithinWindow(lrDate)) {
      return doErrorResponse(req, ctx, "DO_MANUAL_DATE_OUTSIDE_ALLOWED_WINDOW", 400, MANUAL_DOCUMENT_DATE_WINDOW_MESSAGE);
    }

    const { data: dc, error: dcError } = await serviceRoleClient
      .schema("erp_procurement").from("delivery_challan").select("*").eq("id", dcId).maybeSingle();
    if (dcError || !dc) return doErrorResponse(req, ctx, "DO_NOT_FOUND", 404, "Delivery order not found.");
    const companyId = toTrimmedString((dc as JsonRecord).selling_company_id);
    try {
      await assertCompanyScope(ctx, companyId);
    } catch {
      return doErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }
    if (!(await canMaintainDoCreate(ctx, companyId, "EDIT"))) {
      return doErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have Edit-DO access at this company.");
    }
    if (toUpperTrimmedString((dc as JsonRecord).status) !== "CREATED") {
      return doErrorResponse(req, ctx, "DO_EDIT_BLOCKED", 400, "Only a DO that has not yet been PGI'd/invoiced or cancelled can be edited.");
    }

    // Validate against every other DO while excluding this editable DO's own
    // lines; the transaction below then replaces its full line set safely.
    const { prepared, soIdsForSources, stoIdsForSources, netWeight, dcType } = await prepareAndValidateDoLines(companyId, rawLines, dcId);
    await freezeDoSalesShipTo(prepared);
    const payload = buildDoAtomicPayload(companyId, null, body, prepared, soIdsForSources, stoIdsForSources, netWeight, dcType);
    const { error } = await serviceRoleClient.schema("erp_procurement").rpc("save_delivery_order_unified_atomic", {
      p_action: "UPDATE", p_dc_id: dcId, p_header: payload.header, p_sources: payload.sources, p_lines: payload.lines, p_actor: ctx.auth_user_id,
    });
    if (error) return doErrorResponse(req, ctx, "DO_EDIT_FAILED", 500, "Unable to update delivery order.");
    return okResponse(await hydrateDeliveryOrderUnified(dcId), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "DO_EDIT_FAILED";
    const status = code === "DO_NOT_FOUND" ? 404
      : code === "COMPANY_SCOPE_VIOLATION" ? 403
      : ["DO_QTY_EXCEEDS_BALANCE", "INSUFFICIENT_STOCK", "DO_EDIT_INVALID", "DO_LINE_INVALID", "DO_LINE_SOURCE_MISSING", "DO_SOURCE_COMPANY_MISMATCH", "DO_EDIT_BLOCKED", "DO_PACKING_ORDER_NOT_ALLOCATED_TO_FO", "DO_PACKING_ORDER_INSUFFICIENT_BALANCE", "DO_PACKING_ORDER_ALLOCATION_EXCEEDED"].includes(code) ? 400
      : code.includes("NOT_FOUND") ? 404
      : 500;
    return doErrorResponse(req, ctx, code, status, code);
  }
}

// Multi-source hydration — no single customer/ship-to at header level
// (§133.12-addendum: those resolve fresh per invoice-group at PGI time, not
// snapshotted here). Groups lines by their originating SO/STO for display.
export async function hydrateDeliveryOrderUnified(dcId: string): Promise<JsonRecord> {
  const { data: dc, error: dcError } = await serviceRoleClient.schema("erp_procurement").from("delivery_challan").select("*").eq("id", dcId).single();
  if (dcError || !dc) throw new Error("DO_NOT_FOUND");
  const [{ data: lines, error: linesError }, { data: sources, error: sourcesError }] = await Promise.all([
    serviceRoleClient.schema("erp_procurement").from("delivery_challan_line").select("*").eq("dc_id", dcId).order("line_number", { ascending: true }),
    serviceRoleClient.schema("erp_procurement").from("delivery_challan_source").select("*").eq("dc_id", dcId),
  ]);
  if (linesError) throw new Error("DO_LINE_FETCH_FAILED");
  if (sourcesError) throw new Error("DO_SOURCE_FETCH_FAILED");
  const lineRows = (lines ?? []) as JsonRecord[];
  let sourceRows = (sources ?? []) as JsonRecord[];

  // A pre-§133.12 single-source DO has no delivery_challan_source rows
  // (the table didn't exist when it was created) — synthesize the one row
  // it would have had, from its own header sales_order_id/sto_id, so this
  // unified hydrator works for old and new DOs alike (migration comment's
  // documented promise).
  if (sourceRows.length === 0) {
    if (dc.sales_order_id) sourceRows = [{ source_type: "SALES_ORDER", source_id: dc.sales_order_id }];
    else if (dc.sto_id) sourceRows = [{ source_type: "STO", source_id: dc.sto_id }];
  }

  const soIds = sourceRows.filter((s) => s.source_type === "SALES_ORDER").map((s) => toTrimmedString(s.source_id));
  const stoIds = sourceRows.filter((s) => s.source_type === "STO").map((s) => toTrimmedString(s.source_id));
  const locationIds = [...new Set(lineRows.map((row) => toTrimmedString(row.storage_location_id)).filter(Boolean))];
  const [{ data: sos, error: sosError }, { data: stos, error: stosError }, { data: transporter, error: transporterError }, hydratedLines, { data: locations, error: locationsError }] = await Promise.all([
    soIds.length ? serviceRoleClient.schema("erp_procurement").from("sales_order").select("id, so_number, so_date, customer_id, bill_to_name, ship_to_name").in("id", soIds) : Promise.resolve({ data: [] as JsonRecord[], error: null }),
    stoIds.length ? serviceRoleClient.schema("erp_procurement").from("stock_transfer_order").select("id, sto_number, sto_date, receiving_company_id").in("id", stoIds) : Promise.resolve({ data: [] as JsonRecord[], error: null }),
    dc.transporter_id
      ? serviceRoleClient.schema("erp_master").from("transporter_master").select("id, transporter_code, transporter_name").eq("id", dc.transporter_id as string).maybeSingle()
      : Promise.resolve({ data: null as JsonRecord | null, error: null }),
    attachMaterialDisplay(lineRows),
    locationIds.length ? serviceRoleClient.schema("erp_inventory").from("storage_location_master").select("id, code, name").in("id", locationIds) : Promise.resolve({ data: [] as JsonRecord[], error: null }),
  ]);
  if (sosError) throw new Error("DO_SO_LOOKUP_FAILED");
  if (stosError) throw new Error("DO_STO_LOOKUP_FAILED");
  if (transporterError) throw new Error("DO_TRANSPORTER_LOOKUP_FAILED");
  if (locationsError) throw new Error("DO_LOCATION_LOOKUP_FAILED");
  const locationMap = new Map(((locations ?? []) as JsonRecord[]).map((row) => [String(row.id), row]));
  const soRows = (sos ?? []) as JsonRecord[];
  const stoRows = (stos ?? []) as JsonRecord[];

  // §133.12-addendum — Bill-To/Ship-To are never snapshotted on the DO
  // itself; this is a display-only preview per source (a customer for SO,
  // the receiving company for STO), not authoritative for anything Invoice
  // computes fresh at PGI time.
  const customerIds = [...new Set(soRows.map((row) => toTrimmedString(row.customer_id)).filter(Boolean))];
  const receivingCompanyIds = [...new Set(stoRows.map((row) => toTrimmedString(row.receiving_company_id)).filter(Boolean))];
  const [{ data: customers, error: customersError }, { data: receivingCompanies, error: receivingCompaniesError }] = await Promise.all([
    customerIds.length ? serviceRoleClient.schema("erp_master").from("customer_master").select("id, customer_code, customer_name").in("id", customerIds) : Promise.resolve({ data: [] as JsonRecord[], error: null }),
    receivingCompanyIds.length ? serviceRoleClient.schema("erp_master").from("companies").select("id, company_code, company_name").in("id", receivingCompanyIds) : Promise.resolve({ data: [] as JsonRecord[], error: null }),
  ]);
  if (customersError) throw new Error("DO_CUSTOMER_LOOKUP_FAILED");
  if (receivingCompaniesError) throw new Error("DO_RECEIVING_COMPANY_LOOKUP_FAILED");
  const { data: amendments, error: amendmentsError } = await serviceRoleClient.schema("erp_procurement")
    .from("delivery_challan_dispatch_amendment")
    .select("id, amendment_reason, old_transporter_id, new_transporter_id, old_vehicle_number, new_vehicle_number, old_lr_number, new_lr_number, old_lr_date, new_lr_date, amended_by, amended_at")
    .eq("dc_id", dcId).order("amended_at", { ascending: false });
  if (amendmentsError) throw new Error("DO_DISPATCH_AMENDMENT_FETCH_FAILED");
  const customerMap = new Map(((customers ?? []) as JsonRecord[]).map((row) => [String(row.id), row]));
  const receivingCompanyMap = new Map(((receivingCompanies ?? []) as JsonRecord[]).map((row) => [String(row.id), row]));
  function soPartyDisplay(row: JsonRecord): string | null {
    const customer = customerMap.get(toTrimmedString(row.customer_id));
    if (customer) return `${customer.customer_code ?? ""} — ${customer.customer_name ?? ""}`.trim();
    return toTrimmedString(row.bill_to_name) || toTrimmedString(row.ship_to_name) || null;
  }
  function stoPartyDisplay(row: JsonRecord): string | null {
    const company = receivingCompanyMap.get(toTrimmedString(row.receiving_company_id));
    return company ? `${company.company_code ?? ""} — ${company.company_name ?? ""}`.trim() : null;
  }

  return {
    ...dc,
    transporter_display: (transporter as JsonRecord | null)
      ? toTrimmedString((transporter as JsonRecord).transporter_name) || null
      : (toTrimmedString(dc.transporter_name_freetext) || null),
    sources: [
      ...soRows.map((row) => ({ source_type: "SALES_ORDER", source_id: row.id, document_number: row.so_number, document_date: row.so_date, party_display: soPartyDisplay(row) })),
      ...stoRows.map((row) => ({ source_type: "STO", source_id: row.id, document_number: row.sto_number, document_date: row.sto_date, party_display: stoPartyDisplay(row) })),
    ],
    lines: hydratedLines.map((row) => {
      const location = locationMap.get(toTrimmedString(row.storage_location_id));
      return { ...row, storage_location_display: location ? `${location.code ?? ""} — ${location.name ?? ""}`.trim() : null };
    }),
    dispatch_amendments: (amendments ?? []) as JsonRecord[],
  };
}

export async function getDeliveryOrderUnifiedHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const dcId = getIdFromPath(req);
    if (!dcId) return doErrorResponse(req, ctx, "DO_ID_REQUIRED", 400, "Delivery order id is required.");
    const dc = await hydrateDeliveryOrderUnified(dcId);
    try {
      await assertCompanyScope(ctx, toTrimmedString((dc as JsonRecord).selling_company_id));
    } catch {
      return doErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }
    return okResponse(dc, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "DO_FETCH_FAILED";
    return doErrorResponse(req, ctx, code, code === "DO_NOT_FOUND" ? 404 : code === "COMPANY_SCOPE_VIOLATION" ? 403 : 500, code);
  }
}

// ── §133.13 -- Invoice/PGI (SO02) IBN-driven multi-invoice generation ──────
//
// Supersedes delivery_order.handlers.ts's createPgiInvoiceHandler for any DO
// created via the §133.12 multi-source engine (that legacy handler reads
// dc.sales_order_id/sto_id/customer_id header fields, which a multi-source
// DO never populates -- it was already structurally broken for these DOs,
// this closes that gap as part of building IBN grouping anyway). The legacy
// handler stays untouched for historical single-source DOs reachable only
// through the old /sales-invoices/pgi route.
//
// IBN → Invoice grouping rule (feasibility §133.13, LOCKED):
//   - STO lines: one invoice per STO, no IBN ever.
//   - SO lines whose SO has ibn_required = false: one invoice per SO.
//   - SO lines whose SO has ibn_required = true: split further -- one
//     invoice per distinct FO (via sales_order_map_allocation.fo_id), plus
//     one invoice for all of that SO's non-FO lines together (they all
//     share one Ship-To per SO, so "per delivery address" collapses to one
//     bucket here).
//   - SO and STO never merge into the same invoice.

async function canMaintainSalesInvoice(ctx: ProcurementHandlerContext, companyId: string, actionCode: "VIEW" | "WRITE" | "EDIT" = "WRITE"): Promise<boolean> {
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
    db: serviceRoleClient,
    aclVersionId: versionRow.acl_version_id as string,
    authUserId: ctx.auth_user_id,
    companyId,
    workContextIds,
    resourceCode: "PROC_INV_LIST",
    actionCode,
  });
  if (error || !data) return false;
  return data.decision === "ALLOW";
}

type ProcInvoiceGroupLine = {
  dc_line_id: string;
  material_id: string;
  material_display: string | null;
  document_name: string | null;
  hsn_code: string | null;
  line_material_type: string | null;
  quantity: number;
  uom_code: string;
  unit_value: number;
  // §133.21 -- original SO-time rate/basis/UOM, display-only. Fall back to
  // unit_value/uom_code above for older DO lines saved before this existed.
  display_rate_basis: string | null;
  display_rate: number | null;
  display_uom_code: string | null;
  // §133.21 follow-up (2026-09-02) -- this line's own Packing PO's pack
  // count, display-only. Null for older DO lines and for non-pack-driven
  // (RM/PM/INT/STO) lines.
  pack_qty: number | null;
  pack_uom_code: string | null;
  gst_rate: number | null;
  gst_amount: number;
  line_total: number;
  batch_number: string | null;
  storage_location_id: string;
  so_line_id: string | null;
  sto_line_id: string | null;
  // §133.18/§133.14 -- resolved at DO-line time when this line drew from a
  // specific Packing PO batch (MTO/HPS/MTEST FG/SFG dispatch). NULL for
  // plain RM/PM/INT lines and for STO -- those never have a batch behind
  // them, which is exactly the signal Dispatch-Reco uses to pick which of
  // its two write shapes applies to a given line.
  packing_order_id: string | null;
};

type ProcPartyDetail = { name: string | null; address: string | null; state: string | null; gst_number: string | null };

type ProcInvoiceGroup = {
  group_key: string;
  source_type: "SALES_ORDER" | "STO";
  so_id: string | null;
  sto_id: string | null;
  document_number: string | null;
  document_date: string | null;
  source_display_number: string | null;
  customer_po_number: string | null;
  customer_po_date: string | null;
  customer_id: string | null;
  payment_term_id: string | null;
  freight_term: string | null;
  ibn_required: boolean;
  fo_id: string | null;
  fo_number: string | null;
  fo_date: string | null;
  parent_company_display: string | null;
  vdc_dc_display: string | null;
  seller: ProcPartyDetail;
  bill_to: ProcPartyDetail;
  ship_to: ProcPartyDetail;
  lines: ProcInvoiceGroupLine[];
  net_weight: number;
  total_taxable_value: number;
  total_gst_amount: number;
  total_cgst_amount: number;
  total_sgst_amount: number;
  total_igst_amount: number;
  gst_type: "CGST_SGST" | "IGST";
};

// Groups a DO's lines into invoice-groups per the rule above. Used by both
// the read-only preview (Page 3 table) and the actual POST (which re-derives
// this fresh -- never trusts a client-submitted grouping) so the two can
// never drift apart.
async function computeInvoiceGroups(dcId: string): Promise<{ dc: JsonRecord; groups: ProcInvoiceGroup[] }> {
  const { data: dc, error: dcError } = await serviceRoleClient
    .schema("erp_procurement").from("delivery_challan").select("*").eq("id", dcId).single();
  if (dcError || !dc) throw new Error("DO_NOT_FOUND");

  const { data: dcLines, error: dcLinesError } = await serviceRoleClient
    .schema("erp_procurement").from("delivery_challan_line").select("*").eq("dc_id", dcId).order("line_number", { ascending: true });
  if (dcLinesError) throw new Error("DO_LINE_FETCH_FAILED");
  const lines = (dcLines ?? []) as JsonRecord[];
  if (lines.length === 0) throw new Error("DO_EMPTY");

  const stoLineIds = [...new Set(lines.filter((l) => toTrimmedString(l.sto_line_id)).map((l) => toTrimmedString(l.sto_line_id)))];
  const soLineIds = [...new Set(lines.filter((l) => !toTrimmedString(l.sto_line_id) && toTrimmedString(l.so_line_id)).map((l) => toTrimmedString(l.so_line_id)))];
  const soMapAllocationIds = [...new Set(lines.filter((l) => !toTrimmedString(l.sto_line_id) && toTrimmedString(l.so_map_allocation_id)).map((l) => toTrimmedString(l.so_map_allocation_id)))];

  const [stoLineRows, soLineRows, mapAllocRows] = await Promise.all([
    stoLineIds.length ? fetchInChunks<JsonRecord>(stoLineIds, (chunk) => serviceRoleClient.schema("erp_procurement").from("stock_transfer_order_line").select("id, sto_id").in("id", chunk)) : Promise.resolve([] as JsonRecord[]),
    soLineIds.length ? fetchInChunks<JsonRecord>(soLineIds, (chunk) => serviceRoleClient.schema("erp_procurement").from("sales_order_line").select("id, so_id, hsn_code").in("id", chunk)) : Promise.resolve([] as JsonRecord[]),
    soMapAllocationIds.length ? fetchInChunks<JsonRecord>(soMapAllocationIds, (chunk) => serviceRoleClient.schema("erp_procurement").from("sales_order_map_allocation").select("id, so_id, fo_id, customer_address_id").in("id", chunk)) : Promise.resolve([] as JsonRecord[]),
  ]);
  const stoLineToSto = new Map(stoLineRows.map((r) => [String(r.id), toTrimmedString(r.sto_id)]));
  const soLineToSo = new Map(soLineRows.map((r) => [String(r.id), toTrimmedString(r.so_id)]));
  const soLineById = new Map(soLineRows.map((r) => [String(r.id), r]));
  const foIdsForShipTo = [...new Set(mapAllocRows.map((r) => toTrimmedString(r.fo_id)).filter(Boolean))];
  const { data: foShipToRows, error: foShipToError } = foIdsForShipTo.length
    ? await serviceRoleClient.schema("erp_production").from("plan_feed").select("id, customer_address_id").in("id", foIdsForShipTo)
    : { data: [] as JsonRecord[], error: null };
  if (foShipToError) throw new Error("DO_FO_SHIP_TO_LOOKUP_FAILED");
  const addressIdByFo = new Map(((foShipToRows ?? []) as JsonRecord[]).map((r) => [String(r.id), toTrimmedString(r.customer_address_id)]));
  const mapAllocMap = new Map(mapAllocRows.map((r) => {
    const foId = toTrimmedString(r.fo_id) || null;
    return [String(r.id), {
      soId: toTrimmedString(r.so_id), foId,
      customerAddressId: toTrimmedString(r.customer_address_id) || (foId ? addressIdByFo.get(foId) || null : null),
    }];
  }));
  const shipToAddressIds = [...new Set([...mapAllocMap.values()].map((r) => r.customerAddressId).filter(Boolean))];
  const { data: shipToAddressRows, error: shipToAddressError } = shipToAddressIds.length
    ? await serviceRoleClient.schema("erp_master").from("customer_address").select("id, customer_id, site_name, address_line, town, state, pin_code").in("id", shipToAddressIds)
    : { data: [] as JsonRecord[], error: null };
  if (shipToAddressError) throw new Error("DO_SHIP_TO_ADDRESS_LOOKUP_FAILED");
  const shipToAddressMap = new Map(((shipToAddressRows ?? []) as JsonRecord[]).map((r) => [String(r.id), r]));
  const shipToCustomerIds = [...new Set(((shipToAddressRows ?? []) as JsonRecord[]).map((r) => toTrimmedString(r.customer_id)).filter(Boolean))];
  const { data: shipToCustomerRows, error: shipToCustomerError } = shipToCustomerIds.length
    ? await serviceRoleClient.schema("erp_master").from("customer_master").select("id, customer_name, gst_number").in("id", shipToCustomerIds)
    : { data: [] as JsonRecord[], error: null };
  if (shipToCustomerError) throw new Error("DO_SHIP_TO_CUSTOMER_LOOKUP_FAILED");
  const shipToCustomerMap = new Map(((shipToCustomerRows ?? []) as JsonRecord[]).map((r) => [String(r.id), r]));

  const soIds = new Set<string>();
  const stoIds = new Set<string>();
  const foIds = new Set<string>();
  for (const line of lines) {
    const stoLineId = toTrimmedString(line.sto_line_id);
    if (stoLineId) {
      const stoId = stoLineToSto.get(stoLineId);
      if (stoId) stoIds.add(stoId);
      continue;
    }
    const soLineId = toTrimmedString(line.so_line_id);
    const soMapAllocationId = toTrimmedString(line.so_map_allocation_id);
    if (soLineId) {
      const soId = soLineToSo.get(soLineId);
      if (soId) soIds.add(soId);
    }
    if (soMapAllocationId) {
      const alloc = mapAllocMap.get(soMapAllocationId);
      if (alloc) {
        soIds.add(alloc.soId);
        if (alloc.foId) foIds.add(alloc.foId);
      }
    }
  }

  const [soRows, stoRows, foRows] = await Promise.all([
    soIds.size ? fetchInChunks<JsonRecord>([...soIds], (chunk) => serviceRoleClient.schema("erp_procurement").from("sales_order").select("id, so_number, so_date, customer_po_number, customer_po_date, customer_id, bill_to_name, bill_to_address, bill_to_state, bill_to_gst_number, ship_to_name, ship_to_address, ship_to_state, ship_to_gst_number, bill_to_parent_company_id, bill_to_vdc_id, bill_to_depot_code_id, freight_term, payment_term_id, ibn_required").in("id", chunk)) : Promise.resolve([] as JsonRecord[]),
    stoIds.size ? fetchInChunks<JsonRecord>([...stoIds], (chunk) => serviceRoleClient.schema("erp_procurement").from("stock_transfer_order").select("id, sto_number, sto_date, receiving_company_id").in("id", chunk)) : Promise.resolve([] as JsonRecord[]),
    foIds.size ? fetchInChunks<JsonRecord>([...foIds], (chunk) => serviceRoleClient.schema("erp_production").from("plan_feed").select("id, fo_number, order_date").in("id", chunk)) : Promise.resolve([] as JsonRecord[]),
  ]);
  const soMap = new Map(soRows.map((r) => [String(r.id), r]));
  const stoMap = new Map(stoRows.map((r) => [String(r.id), r]));
  const foMap = new Map(foRows.map((r) => [String(r.id), r]));
  const parentIds = [...new Set(soRows.map((r) => toTrimmedString(r.bill_to_parent_company_id)).filter(Boolean))];
  const depotIds = [...new Set(soRows.flatMap((r) => [toTrimmedString(r.bill_to_vdc_id), toTrimmedString(r.bill_to_depot_code_id)]).filter(Boolean))];
  const [{ data: parents }, { data: depots }] = await Promise.all([
    parentIds.length ? serviceRoleClient.schema("erp_master").from("fg_parent_company").select("id, company_name").in("id", parentIds) : Promise.resolve({ data: [] as JsonRecord[] }),
    depotIds.length ? serviceRoleClient.schema("erp_master").from("fg_depot_code").select("id, code, description").in("id", depotIds) : Promise.resolve({ data: [] as JsonRecord[] }),
  ]);
  const parentMap = new Map(((parents ?? []) as JsonRecord[]).map((r) => [String(r.id), r]));
  const depotMap = new Map(((depots ?? []) as JsonRecord[]).map((r) => [String(r.id), r]));

  const receivingCompanyIds = [...new Set(stoRows.map((r) => toTrimmedString(r.receiving_company_id)).filter(Boolean))];
  const { data: receivingCompanies, error: receivingCompaniesError } = receivingCompanyIds.length
    ? await serviceRoleClient.schema("erp_master").from("companies").select("id, company_code, company_name, state_name, full_address, gst_number").in("id", receivingCompanyIds)
    : { data: [] as JsonRecord[], error: null };
  if (receivingCompaniesError) throw new Error("DO_RECEIVING_COMPANY_LOOKUP_FAILED");
  const receivingCompanyMap = new Map(((receivingCompanies ?? []) as JsonRecord[]).map((r) => [String(r.id), r]));

  const companyId = toTrimmedString(dc.selling_company_id);
  const { data: sellingCompany, error: sellingCompanyError } = await serviceRoleClient
    .schema("erp_master").from("companies").select("company_code, company_name, full_address, state_name, gst_number").eq("id", companyId).maybeSingle();
  if (sellingCompanyError) throw new Error("PGI_INVOICE_TAX_CONTEXT_FAILED");
  const companyStateName = toTrimmedString(sellingCompany?.state_name) || null;
  if (!companyStateName) throw new Error("PGI_INVOICE_SELLING_COMPANY_STATE_MISSING");
  const seller: ProcPartyDetail = {
    name: toTrimmedString(sellingCompany?.company_name) || null,
    address: toTrimmedString(sellingCompany?.full_address) || null,
    state: companyStateName,
    gst_number: toTrimmedString(sellingCompany?.gst_number) || null,
  };

  const hydratedLines = await attachMaterialDisplay(lines);
  const hydratedByLineId = new Map(hydratedLines.map((r) => [String(r.id), r]));

  // Bucket every line into its invoice-group key (see rule comment above).
  type BucketMeta = { source_type: "SALES_ORDER" | "STO"; so_id: string; sto_id: string; fo_id: string | null };
  const buckets = new Map<string, { meta: BucketMeta; lines: JsonRecord[] }>();
  for (const line of lines) {
    const stoLineId = toTrimmedString(line.sto_line_id);
    let key: string;
    let meta: BucketMeta;
    if (stoLineId) {
      const stoId = stoLineToSto.get(stoLineId) || "";
      key = `STO:${stoId}`;
      meta = { source_type: "STO", so_id: "", sto_id: stoId, fo_id: null };
    } else {
      const soLineId = toTrimmedString(line.so_line_id);
      const soMapAllocationId = toTrimmedString(line.so_map_allocation_id);
      const soId = soLineId ? (soLineToSo.get(soLineId) || "") : (soMapAllocationId ? (mapAllocMap.get(soMapAllocationId)?.soId || "") : "");
      const rawFoId = soMapAllocationId ? (mapAllocMap.get(soMapAllocationId)?.foId ?? null) : null;
      const ibnRequired = Boolean(soMap.get(soId)?.ibn_required);
      const foId = ibnRequired ? rawFoId : null;
      // FO is the IBN bucket.  Without an FO, §133.13 requires one IBN
      // and one invoice per frozen DO Ship-To location, never one per SO.
      const shipToKey = [line.ship_to_customer_id, line.ship_to_name, line.ship_to_address, line.ship_to_state].map(toTrimmedString).filter(Boolean).join(":");
      key = ibnRequired ? (foId ? `SO:${soId}:FO:${foId}` : `SO:${soId}:SHIP_TO:${shipToKey || String(line.id)}`) : `SO:${soId}`;
      meta = { source_type: "SALES_ORDER", so_id: soId, sto_id: "", fo_id: foId };
    }
    if (!buckets.has(key)) buckets.set(key, { meta, lines: [] });
    buckets.get(key)!.lines.push(line);
  }

  const groups: ProcInvoiceGroup[] = [];
  for (const [groupKey, bucket] of buckets) {
    const { meta } = bucket;
    const groupLines: ProcInvoiceGroupLine[] = bucket.lines.map((line) => {
      const hydrated = hydratedByLineId.get(String(line.id)) ?? line;
      return {
        dc_line_id: String(line.id),
        material_id: toTrimmedString(line.material_id),
        material_display: (hydrated.material_display as string | null) ?? null,
        document_name: (hydrated.document_name as string | null) ?? null,
        // SO01's saved line value is the sales document's HSN snapshot;
        // Material Master is only the fallback for older/non-SO lines.
        hsn_code: toTrimmedString(soLineById.get(toTrimmedString(line.so_line_id))?.hsn_code) || toTrimmedString(hydrated.hsn_code) || null,
        line_material_type: (hydrated.line_material_type as string | null) ?? null,
        quantity: Number(line.quantity ?? 0),
        uom_code: toTrimmedString(line.uom_code),
        unit_value: Number(line.unit_value ?? 0),
        display_rate_basis: toTrimmedString(line.display_rate_basis) || null,
        display_rate: line.display_rate != null ? Number(line.display_rate) : null,
        display_uom_code: toTrimmedString(line.display_uom_code) || null,
        pack_qty: line.pack_qty != null ? Number(line.pack_qty) : null,
        pack_uom_code: toTrimmedString(line.pack_uom_code) || null,
        gst_rate: line.gst_rate != null ? Number(line.gst_rate) : null,
        gst_amount: Number(line.gst_amount ?? 0),
        line_total: Number(line.line_total ?? 0),
        batch_number: toTrimmedString(line.batch_number) || null,
        storage_location_id: toTrimmedString(line.storage_location_id),
        so_line_id: toTrimmedString(line.so_line_id) || null,
        sto_line_id: toTrimmedString(line.sto_line_id) || null,
        packing_order_id: toTrimmedString(line.packing_order_id) || null,
      };
    });

    let documentNumber: string | null = null;
    let documentDate: string | null = null;
    let sourceDisplayNumber: string | null = null;
    let customerPoNumber: string | null = null;
    let customerPoDate: string | null = null;
    let customerId: string | null = null;
    let paymentTermId: string | null = null;
    let freightTerm: string | null = null;
    let ibnRequired = false;
    let foNumber: string | null = null;
    let foDate: string | null = null;
    let parentCompanyDisplay: string | null = null;
    let vdcDcDisplay: string | null = null;
    let billTo: ProcPartyDetail = { name: null, address: null, state: null, gst_number: null };
    let shipTo: ProcPartyDetail = { name: null, address: null, state: null, gst_number: null };

    if (meta.source_type === "STO") {
      const stoRow = meta.sto_id ? stoMap.get(meta.sto_id) : null;
      documentNumber = (stoRow?.sto_number as string) ?? null;
      documentDate = (stoRow?.sto_date as string) ?? null;
      sourceDisplayNumber = documentNumber;
      const company = stoRow ? receivingCompanyMap.get(toTrimmedString(stoRow.receiving_company_id)) : null;
      if (company) {
        const companyDetail: ProcPartyDetail = {
          name: `${company.company_code ?? ""} — ${company.company_name ?? ""}`.trim(),
          address: toTrimmedString(company.full_address) || null,
          state: toTrimmedString(company.state_name) || null,
          gst_number: toTrimmedString(company.gst_number) || null,
        };
        billTo = companyDetail;
        shipTo = companyDetail;
      }
    } else {
      const soRow = meta.so_id ? soMap.get(meta.so_id) : null;
      const parent = soRow ? parentMap.get(toTrimmedString(soRow.bill_to_parent_company_id)) : null;
      const depot = soRow ? (depotMap.get(toTrimmedString(soRow.bill_to_vdc_id)) ?? depotMap.get(toTrimmedString(soRow.bill_to_depot_code_id))) : null;
      parentCompanyDisplay = toTrimmedString(parent?.company_name) || null;
      vdcDcDisplay = depot ? [toTrimmedString(depot.code), toTrimmedString(depot.description)].filter(Boolean).join(" - ") : null;
      documentNumber = (soRow?.so_number as string) ?? null;
      documentDate = (soRow?.so_date as string) ?? null;
      customerPoNumber = soRow ? (toTrimmedString(soRow.customer_po_number) || null) : null;
      customerPoDate = soRow ? (toTrimmedString(soRow.customer_po_date) || null) : null;
      sourceDisplayNumber = customerPoNumber || documentNumber;
      customerId = soRow ? (toTrimmedString(soRow.customer_id) || null) : null;
      paymentTermId = soRow ? (toTrimmedString(soRow.payment_term_id) || null) : null;
      freightTerm = soRow ? (toUpperTrimmedString(soRow.freight_term) || null) : null;
      ibnRequired = Boolean(soRow?.ibn_required);
      if (meta.fo_id) {
        const foRow = foMap.get(meta.fo_id);
        foNumber = (foRow?.fo_number as string) ?? null;
        foDate = (foRow?.order_date as string) ?? null;
      }
      billTo = {
        name: soRow ? (toTrimmedString(soRow.bill_to_name) || null) : null,
        address: soRow ? (toTrimmedString(soRow.bill_to_address) || null) : null,
        state: soRow ? (toTrimmedString(soRow.bill_to_state) || null) : null,
        gst_number: soRow ? (toTrimmedString(soRow.bill_to_gst_number) || null) : null,
      };
      shipTo = {
        name: soRow ? (toTrimmedString(soRow.ship_to_name) || null) : null,
        address: soRow ? (toTrimmedString(soRow.ship_to_address) || null) : null,
        state: soRow ? (toTrimmedString(soRow.ship_to_state) || null) : null,
        gst_number: soRow ? (toTrimmedString(soRow.ship_to_gst_number) || null) : null,
      };
      const allocationId = toTrimmedString(bucket.lines[0]?.so_map_allocation_id);
      const mappedAddressId = allocationId ? mapAllocMap.get(allocationId)?.customerAddressId : null;
      const mappedAddress = mappedAddressId ? shipToAddressMap.get(mappedAddressId) : null;
      if (mappedAddress) {
        const mappedCustomer = shipToCustomerMap.get(toTrimmedString(mappedAddress.customer_id));
        const addressText = [mappedAddress.address_line, mappedAddress.town, mappedAddress.pin_code]
          .map(toTrimmedString).filter(Boolean).join(", ") || null;
        shipTo = {
          name: toTrimmedString(mappedCustomer?.customer_name) || toTrimmedString(mappedAddress.site_name) || null,
          address: addressText,
          state: toTrimmedString(mappedAddress.state) || null,
          gst_number: toTrimmedString(mappedCustomer?.gst_number) || null,
        };
      }
      // The DO is the legal dispatch snapshot. Prefer its frozen consignee
      // over any subsequently edited Plan Feed/MM04 address.
      const dcShipTo = (bucket.lines[0] ?? {}) as JsonRecord;
      if (toTrimmedString(dcShipTo.ship_to_state)) {
        shipTo = {
          name: toTrimmedString(dcShipTo.ship_to_name) || null,
          address: toTrimmedString(dcShipTo.ship_to_address) || null,
          state: toTrimmedString(dcShipTo.ship_to_state) || null,
          gst_number: toTrimmedString(dcShipTo.ship_to_gst_number) || null,
        };
      }
    }

    const counterpartyStateName = shipTo.state;
    if (!counterpartyStateName) {
      throw new Error(meta.source_type === "STO" ? "PGI_INVOICE_RECEIVING_COMPANY_STATE_MISSING" : "DO_SHIP_TO_STATE_MISSING");
    }
    const gstType = deriveSalesInvoiceGstType(companyStateName, counterpartyStateName);

    const netWeight = Number(groupLines.reduce((sum, l) => sum + l.quantity, 0).toFixed(4));
    const totalTaxableValue = Number(groupLines.reduce((sum, l) => sum + l.quantity * l.unit_value, 0).toFixed(4));
    const totalGstAmount = Number(groupLines.reduce((sum, l) => sum + l.gst_amount, 0).toFixed(4));
    const totalCgstAmount = gstType === "CGST_SGST" ? Number((totalGstAmount / 2).toFixed(4)) : 0;
    const totalSgstAmount = gstType === "CGST_SGST" ? Number((totalGstAmount / 2).toFixed(4)) : 0;
    const totalIgstAmount = gstType === "IGST" ? totalGstAmount : 0;

    groups.push({
      group_key: groupKey,
      source_type: meta.source_type,
      so_id: meta.so_id || null,
      sto_id: meta.sto_id || null,
      document_number: documentNumber,
      document_date: documentDate,
      source_display_number: sourceDisplayNumber,
      customer_po_number: customerPoNumber,
      customer_po_date: customerPoDate,
      customer_id: customerId,
      payment_term_id: paymentTermId,
      freight_term: freightTerm,
      ibn_required: ibnRequired,
      fo_id: meta.fo_id,
      fo_number: foNumber,
      fo_date: foDate,
      parent_company_display: parentCompanyDisplay,
      vdc_dc_display: vdcDcDisplay,
      seller,
      bill_to: billTo,
      ship_to: shipTo,
      lines: groupLines,
      net_weight: netWeight,
      total_taxable_value: totalTaxableValue,
      total_gst_amount: totalGstAmount,
      total_cgst_amount: totalCgstAmount,
      total_sgst_amount: totalSgstAmount,
      total_igst_amount: totalIgstAmount,
      gst_type: gstType,
    });
  }

  groups.sort((a, b) => (a.document_number || "").localeCompare(b.document_number || "") || a.group_key.localeCompare(b.group_key));
  return { dc: dc as JsonRecord, groups };
}

// §133.14 Part B -- Dispatch-Reco. Two write shapes (feasibility Section
// C/F, both LOCKED 2026-08-28):
//   1. A line with a resolved packing_order_id (§133.18 -- only ever set
//      for an MTO/HPS/MTEST FG/SFG dispatch drawing from a specific batch)
//      gets the full 2-level ratio chain: packingPoRatio (this Packing PO's
//      own draw ÷ its Process PO batch's total actual output, §104.7) x
//      invoiceRatio (this dispatch's qty ÷ that Packing PO's own total
//      output -- KG-based for RM/INT, pack-count-based for PM, since PM
//      consumption scales per-pack not per-KG). Standard/Actual/AP-Approved
//      are each their own independent multiplication (never a single
//      shared ratio -- a batch's Standard and Actual/AP-Approved totals can
//      differ, verified against real prod data, §133.14 Section E).
//   2. A plain RM/PM/INT line with no packing_order_id, when this group's
//      SO is dispatch_category=RPS AND its dispatch_type identifies the
//      Bill-To as Asian Paints (§133.18-locked: Dependent Direct/Depot/
//      No-Inbound or Independent-Party-Asian-billed) -- straight
//      pass-through, ap_approved_qty = dispatch qty, no ratio, no batch.
// STO groups, and a plain (non-Asian) RPS dispatch, get nothing here.
const ASIAN_BILLED_DISPATCH_TYPES = new Set(["DEPENDENT_DIRECT", "DEPENDENT_DEPOT", "DEPENDENT_NO_INBOUND", "INDEPENDENT_PARTY_ASIAN_BILLED"]);
const DISPATCH_RECO_MATERIAL_TYPES = new Set(["RM", "PM", "INT"]);

type DispatchRecoLine = {
  so_id: string | null;
  so_number: string | null;
  fo_id: string | null;
  fo_number: string | null;
  dispatch_category: string | null;
  process_order_id: string | null;
  process_order_number: string | null;
  batch_number: string | null;
  packing_order_id: string | null;
  packing_order_number: string | null;
  po_type: string | null;
  dispatch_qty_kg: number;
  material_id: string;
  line_material_type: string;
  standard_qty: number | null;
  actual_qty: number | null;
  ap_approved_qty: number | null;
};

async function computeDispatchRecoRows(group: ProcInvoiceGroup): Promise<DispatchRecoLine[]> {
  if (group.source_type !== "SALES_ORDER" || !group.so_id) return [];

  const { data: soRow, error: soError } = await serviceRoleClient
    .schema("erp_procurement").from("sales_order").select("dispatch_type, dispatch_category").eq("id", group.so_id).maybeSingle();
  if (soError) throw new Error("DISPATCH_RECO_SO_LOOKUP_FAILED");
  const dispatchType = toUpperTrimmedString(soRow?.dispatch_type);
  const dispatchCategory = toTrimmedString(soRow?.dispatch_category) || null;
  const isAsianBilled = ASIAN_BILLED_DISPATCH_TYPES.has(dispatchType);

  const rows: DispatchRecoLine[] = [];
  const batchLines = group.lines.filter((l) => l.packing_order_id);
  const plainLines = group.lines.filter((l) => !l.packing_order_id);

  // Shape 2 -- simple RPS-Asian-billed passthrough.
  if (dispatchCategory === "RPS" && isAsianBilled) {
    for (const line of plainLines) {
      if (!line.line_material_type || !DISPATCH_RECO_MATERIAL_TYPES.has(line.line_material_type)) continue;
      rows.push({
        so_id: group.so_id, so_number: group.document_number, fo_id: group.fo_id, fo_number: group.fo_number,
        dispatch_category: dispatchCategory,
        process_order_id: null, process_order_number: null, batch_number: null,
        packing_order_id: null, packing_order_number: null, po_type: null,
        dispatch_qty_kg: line.quantity, material_id: line.material_id, line_material_type: line.line_material_type,
        standard_qty: null, actual_qty: null, ap_approved_qty: line.quantity,
      });
    }
  }

  // Shape 1 -- full ratio chain, per batch-linked line.
  const pkoIds = [...new Set(batchLines.map((l) => l.packing_order_id as string))];
  if (pkoIds.length > 0) {
    const { data: pkoRows, error: pkoError } = await serviceRoleClient
      .schema("erp_production").from("packing_order")
      .select("id, po_number, po_type, batch_number, process_order_id, actual_qty_kg, num_packs, fill_qty_per_pack")
      .in("id", pkoIds);
    if (pkoError) throw new Error("DISPATCH_RECO_PACKING_ORDER_LOOKUP_FAILED");
    const pkoMap = new Map(((pkoRows ?? []) as JsonRecord[]).map((row) => [String(row.id), row]));

    const processOrderIds = [...new Set(((pkoRows ?? []) as JsonRecord[]).map((row) => toTrimmedString(row.process_order_id)).filter(Boolean))];
    const [{ data: procRows, error: procError }, { data: procLineRecoRows, error: procLineRecoError }, { data: packLineRecoRows, error: packLineRecoError }] = await Promise.all([
      processOrderIds.length
        ? serviceRoleClient.schema("erp_production").from("process_order").select("id, po_number, actual_qty").in("id", processOrderIds)
        : Promise.resolve({ data: [] as JsonRecord[], error: null }),
      processOrderIds.length
        ? serviceRoleClient.schema("erp_production").from("process_order_line_reco")
            .select("process_order_id, material_id, line_material_type, standard_qty, actual_qty, ap_approved_qty")
            .in("process_order_id", processOrderIds).eq("is_voided", false)
        : Promise.resolve({ data: [] as JsonRecord[], error: null }),
      serviceRoleClient.schema("erp_production").from("packing_order_line_reco")
        .select("packing_order_id, material_id, standard_qty, actual_qty, ap_approved_qty")
        .in("packing_order_id", pkoIds).eq("is_voided", false),
    ]);
    if (procError) throw new Error("DISPATCH_RECO_PROCESS_ORDER_LOOKUP_FAILED");
    if (procLineRecoError) throw new Error("DISPATCH_RECO_PROCESS_LINE_RECO_LOOKUP_FAILED");
    if (packLineRecoError) throw new Error("DISPATCH_RECO_PACK_LINE_RECO_LOOKUP_FAILED");
    const procMap = new Map(((procRows ?? []) as JsonRecord[]).map((row) => [String(row.id), row]));

    for (const line of batchLines) {
      const pko = pkoMap.get(line.packing_order_id as string);
      if (!pko) continue;
      const proc = procMap.get(toTrimmedString(pko.process_order_id));
      const pkoActualQtyKg = Number(pko.actual_qty_kg ?? 0);
      const procActualQty = proc ? Number(proc.actual_qty ?? 0) : 0;
      const packingPoRatio = procActualQty > 0 ? pkoActualQtyKg / procActualQty : 0;
      const invoiceRatioKg = pkoActualQtyKg > 0 ? line.quantity / pkoActualQtyKg : 0;
      const fillQtyPerPack = Number(pko.fill_qty_per_pack ?? 0);
      const dispatchedPacks = fillQtyPerPack > 0 ? line.quantity / fillQtyPerPack : 0;
      const numPacks = Number(pko.num_packs ?? 0);
      const invoiceRatioPacks = numPacks > 0 ? dispatchedPacks / numPacks : 0;

      for (const reco of ((procLineRecoRows ?? []) as JsonRecord[]).filter((r) => toTrimmedString(r.process_order_id) === toTrimmedString(pko.process_order_id))) {
        rows.push({
          so_id: group.so_id, so_number: group.document_number, fo_id: group.fo_id, fo_number: group.fo_number,
          dispatch_category: dispatchCategory,
          process_order_id: toTrimmedString(pko.process_order_id) || null, process_order_number: (proc?.po_number as string) ?? null, batch_number: toTrimmedString(pko.batch_number) || null,
          packing_order_id: String(pko.id), packing_order_number: toTrimmedString(pko.po_number) || null, po_type: toTrimmedString(pko.po_type) || null,
          dispatch_qty_kg: line.quantity, material_id: toTrimmedString(reco.material_id), line_material_type: toTrimmedString(reco.line_material_type),
          standard_qty: Number((Number(reco.standard_qty ?? 0) * packingPoRatio * invoiceRatioKg).toFixed(6)),
          actual_qty: Number((Number(reco.actual_qty ?? 0) * packingPoRatio * invoiceRatioKg).toFixed(6)),
          ap_approved_qty: Number((Number(reco.ap_approved_qty ?? 0) * packingPoRatio * invoiceRatioKg).toFixed(6)),
        });
      }
      for (const reco of ((packLineRecoRows ?? []) as JsonRecord[]).filter((r) => toTrimmedString(r.packing_order_id) === String(pko.id))) {
        rows.push({
          so_id: group.so_id, so_number: group.document_number, fo_id: group.fo_id, fo_number: group.fo_number,
          dispatch_category: dispatchCategory,
          process_order_id: toTrimmedString(pko.process_order_id) || null, process_order_number: (proc?.po_number as string) ?? null, batch_number: toTrimmedString(pko.batch_number) || null,
          packing_order_id: String(pko.id), packing_order_number: toTrimmedString(pko.po_number) || null, po_type: toTrimmedString(pko.po_type) || null,
          dispatch_qty_kg: line.quantity, material_id: toTrimmedString(reco.material_id), line_material_type: "PM",
          standard_qty: Number((Number(reco.standard_qty ?? 0) * invoiceRatioPacks).toFixed(6)),
          actual_qty: Number((Number(reco.actual_qty ?? 0) * invoiceRatioPacks).toFixed(6)),
          ap_approved_qty: Number((Number(reco.ap_approved_qty ?? 0) * invoiceRatioPacks).toFixed(6)),
        });
      }
    }
  }

  return rows;
}

// Page 3 -- read-only, computes every invoice-group this DO would split
// into right now, with full preview data (Bill-To/Ship-To, FO, net weight,
// GST split) for the per-row drawer to render before anything is posted.
export async function previewInvoiceGroupsHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const dcId = getIdFromPath(req);
    if (!dcId) return doErrorResponse(req, ctx, "DO_ID_REQUIRED", 400, "Delivery order id is required.");
    const { dc, groups } = await computeInvoiceGroups(dcId);
    const companyId = toTrimmedString(dc.selling_company_id);
    try {
      await assertCompanyScope(ctx, companyId);
    } catch {
      return doErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }
    if (!(await canMaintainSalesInvoice(ctx, companyId, "VIEW"))) {
      return doErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have Invoice/PGI view access at this company.");
    }
    const dcStatus = toUpperTrimmedString(dc.status);
    if (!new Set(["CREATED", "DISPATCHED"]).has(dcStatus)) {
      return doErrorResponse(req, ctx, "DO_NOT_READY_FOR_PGI", 400, "Only a CREATED or DISPATCHED delivery order can be viewed here.");
    }

    // A dispatched DO is a read-only invoice-group view. Match its already
    // posted invoice to the same SO/STO and FO bucket that generated it.
    const { data: invoiceRows, error: invoiceError } = dcStatus === "DISPATCHED"
      ? await serviceRoleClient.schema("erp_procurement").from("sales_invoice")
        .select("id, invoice_number, invoice_date, status, so_id, sto_id, fo_id, tally_invoice_number, tally_invoice_date, inbound_number, e_way_bill_applicable, e_way_bill_number, freight_to_pay, freight_included, freight_amount, freight_mode, freight_rate, freight_gst_included, freight_gst_treatment, freight_gst_rate, additional_cost_total, round_off_amount, total_invoice_value, remarks")
        .eq("dc_id", dcId)
      : { data: [] as JsonRecord[], error: null };
    if (invoiceError) return doErrorResponse(req, ctx, "PGI_INVOICE_GROUPS_FETCH_FAILED", 500, "Unable to load posted invoice groups.");
    const invoiceHistory = (invoiceRows ?? []) as JsonRecord[];
    const viewGroups = groups.map((group) => {
      const matchingInvoices = invoiceHistory.filter((row) =>
        toTrimmedString(row.so_id) === toTrimmedString(group.so_id)
        && toTrimmedString(row.sto_id) === toTrimmedString(group.sto_id)
        && toTrimmedString(row.fo_id) === toTrimmedString(group.fo_id));
      const postedInvoice = matchingInvoices.find((row) => toUpperTrimmedString(row.status) === "POSTED") ?? null;
      const cancelledInvoice = matchingInvoices.find((row) => toUpperTrimmedString(row.status) === "CANCELLED") ?? null;
      return { ...group, posted_invoice: postedInvoice, cancelled_invoice: cancelledInvoice };
    });
    return okResponse({
      dc_id: dcId,
      dc_number: dc.dc_number,
      dc_date: dc.dc_date,
      view_only: dcStatus === "DISPATCHED",
      groups: viewGroups,
    }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "PGI_INVOICE_GROUPS_PREVIEW_FAILED";
    const status = code === "DO_NOT_FOUND" ? 404
      : code === "COMPANY_SCOPE_VIOLATION" ? 403
      : code.includes("REQUIRED") || code.includes("MISSING") || code === "DO_EMPTY" || code === "DO_NOT_READY_FOR_PGI" ? 400
      : 500;
    return doErrorResponse(req, ctx, code, status, code);
  }
}

type InvoiceGroupInput = {
  group_key: string;
  tally_invoice_number: string;
  tally_invoice_date: string;
  inbound_number?: string;
  e_way_bill_applicable?: boolean;
  e_way_bill_number?: string;
  freight?: {
    to_pay?: boolean;
    included?: boolean;
    mode?: "AD_HOC" | "RATE";
    amount?: number;
    rate?: number;
    gst_included?: boolean;
    gst_treatment?: "INCLUSIVE" | "EXCLUSIVE";
    gst_rate?: number;
  };
  additional_costs?: Array<{
    category_id: string;
    amount: number;
    gst_included?: boolean;
    gst_treatment?: "INCLUSIVE" | "EXCLUSIVE";
    gst_rate?: number;
  }>;
  remarks?: string;
};

// Cancelling is append-only: each original P601 receives a matching P602,
// while invoice/reconciliation records retain their audit history.  The RPC
// executes every selected group in one transaction, so a multi-select cancel
// never leaves only some groups reversed.
export async function cancelPgiInvoiceGroupsHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const dcId = getIdFromPath(req);
    if (!dcId) return doErrorResponse(req, ctx, "DO_ID_REQUIRED", 400, "Delivery order id is required.");
    const body = await parseBody(req);
    const reason = toTrimmedString(body.reason);
    const invoiceIds = Array.isArray(body.invoice_ids)
      ? [...new Set(body.invoice_ids.map((id) => toTrimmedString(id)).filter(Boolean))]
      : [];
    if (!reason) return doErrorResponse(req, ctx, "PGI_INVOICE_REVERSE_REASON_REQUIRED", 400, "Cancellation reason is required.");
    if (invoiceIds.length === 0) return doErrorResponse(req, ctx, "PGI_INVOICE_GROUPS_REQUIRED", 400, "Select at least one posted invoice group.");

    const { data: dc, error: dcError } = await serviceRoleClient.schema("erp_procurement").from("delivery_challan")
      .select("id, selling_company_id, status").eq("id", dcId).single();
    if (dcError || !dc) return doErrorResponse(req, ctx, "DO_NOT_FOUND", 404, "Delivery order not found.");
    const companyId = toTrimmedString((dc as JsonRecord).selling_company_id);
    try { await assertCompanyScope(ctx, companyId); } catch { return doErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company."); }
    if (!(await canMaintainSalesInvoice(ctx, companyId, "EDIT"))) return doErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have Invoice/PGI cancellation access at this company.");

    const { data: invoiceRows, error: invoiceError } = await serviceRoleClient.schema("erp_procurement").from("sales_invoice")
      .select("id, invoice_number, invoice_date, company_id, dc_id, status")
      .eq("dc_id", dcId).in("id", invoiceIds);
    if (invoiceError) return doErrorResponse(req, ctx, "PGI_INVOICE_GROUPS_FETCH_FAILED", 500, "Unable to load selected invoices.");
    const invoices = (invoiceRows ?? []) as JsonRecord[];
    if (invoices.length !== invoiceIds.length || invoices.some((invoice) => toUpperTrimmedString(invoice.status) !== "POSTED")) {
      return doErrorResponse(req, ctx, "PGI_INVOICE_REVERSE_BLOCKED", 400, "Only posted invoice groups from this delivery order can be cancelled.");
    }

    const { data: sourceDocs, error: sourceDocError } = await serviceRoleClient.schema("erp_inventory").from("stock_document")
      .select("id, reference_document_id, material_id, source_location_id, quantity, base_uom_code, valuation_rate, reversal_document_id")
      .eq("reference_document_type", "SALES_INVOICE").eq("movement_type_code", "P601").in("reference_document_id", invoiceIds);
    if (sourceDocError) return doErrorResponse(req, ctx, "PGI_INVOICE_LEDGER_LOOKUP_FAILED", 500, "Unable to load original stock postings.");
    const originalDocs = ((sourceDocs ?? []) as JsonRecord[]).filter((row) => !row.reversal_document_id);
    const sourceDocIds = originalDocs.map((row) => String(row.id));
    const { data: ledgerRows, error: ledgerError } = sourceDocIds.length
      ? await serviceRoleClient.schema("erp_inventory").from("stock_ledger").select("stock_document_id, batch_number").in("stock_document_id", sourceDocIds)
      : { data: [] as JsonRecord[], error: null };
    if (ledgerError) return doErrorResponse(req, ctx, "PGI_INVOICE_LEDGER_LOOKUP_FAILED", 500, "Unable to load stock batch details.");
    const batchByDocumentId = new Map(((ledgerRows ?? []) as JsonRecord[]).map((row) => [toTrimmedString(row.stock_document_id), row.batch_number ?? null]));

    const payloadGroups = invoices.map((invoice) => {
      const legs = originalDocs.filter((leg) => toTrimmedString(leg.reference_document_id) === toTrimmedString(invoice.id));
      if (legs.length === 0) throw new Error("PGI_INVOICE_NO_POSTINGS_FOUND");
      return {
        invoice_id: invoice.id,
        invoice_number: invoice.invoice_number,
        invoice_date: invoice.invoice_date,
        company_id: invoice.company_id,
        dc_id: invoice.dc_id,
        reason,
        movements: legs.map((leg) => ({
          storage_location_id: leg.source_location_id,
          material_id: leg.material_id,
          quantity: Number(leg.quantity ?? 0),
          base_uom_code: leg.base_uom_code,
          unit_value: Number(leg.valuation_rate ?? 0),
          batch_number: batchByDocumentId.get(toTrimmedString(leg.id)) ?? null,
          reversal_of_id: leg.id,
          line_ref: leg.id,
        })),
      };
    });

    const { error: reversalError } = await serviceRoleClient.schema("erp_inventory")
      .rpc("reverse_sales_invoice_groups_atomic", { p_groups: payloadGroups, p_posted_by: ctx.auth_user_id });
    if (reversalError) return doErrorResponse(req, ctx, "PGI_REVERSAL_POST_FAILED", 500, reversalError.message || "Unable to reverse selected invoice groups.");
    return okResponse({ dc_id: dcId, cancelled_invoice_ids: invoiceIds }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "PGI_INVOICE_GROUPS_CANCEL_FAILED";
    const status = code === "DO_NOT_FOUND" ? 404 : code === "COMPANY_SCOPE_VIOLATION" ? 403 : code.includes("REQUIRED") || code.includes("BLOCKED") || code.includes("NO_POSTINGS") ? 400 : 500;
    return doErrorResponse(req, ctx, code, status, code);
  }
}

// A posted DO may receive logistics-only corrections.  Freight, quantity,
// stock and invoice values are intentionally absent from this payload.
export async function amendDispatchDetailsHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const dcId = getIdFromPath(req);
    if (!dcId) return doErrorResponse(req, ctx, "DO_ID_REQUIRED", 400, "Delivery order id is required.");
    const body = await parseBody(req);
    const reason = toTrimmedString(body.reason);
    if (!reason) return doErrorResponse(req, ctx, "DISPATCH_AMENDMENT_REASON_REQUIRED", 400, "Amendment reason is required.");
    const { data: dc, error: dcError } = await serviceRoleClient.schema("erp_procurement").from("delivery_challan")
      .select("id, selling_company_id, status, transporter_id, vehicle_number, lr_number, lr_date").eq("id", dcId).single();
    if (dcError || !dc) return doErrorResponse(req, ctx, "DO_NOT_FOUND", 404, "Delivery order not found.");
    const current = dc as JsonRecord;
    const companyId = toTrimmedString(current.selling_company_id);
    try { await assertCompanyScope(ctx, companyId); } catch { return doErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company."); }
    if (!(await canMaintainSalesInvoice(ctx, companyId, "EDIT"))) return doErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have Invoice/PGI amendment access at this company.");
    if (toUpperTrimmedString(current.status) !== "DISPATCHED") return doErrorResponse(req, ctx, "DISPATCH_AMENDMENT_BLOCKED", 400, "Dispatch details can be amended only after PGI.");

    const next = {
      transporter_id: toTrimmedString(body.transporter_id) || null,
      vehicle_number: toTrimmedString(body.vehicle_number) || null,
      lr_number: toTrimmedString(body.lr_number) || null,
      lr_date: toTrimmedString(body.lr_date) || null,
    };
    if (next.lr_date && !isManualDocumentDateWithinWindow(next.lr_date)) {
      return doErrorResponse(req, ctx, "DO_MANUAL_DATE_OUTSIDE_ALLOWED_WINDOW", 400, MANUAL_DOCUMENT_DATE_WINDOW_MESSAGE);
    }
    const changed = toTrimmedString(current.transporter_id) !== toTrimmedString(next.transporter_id)
      || toTrimmedString(current.vehicle_number) !== toTrimmedString(next.vehicle_number)
      || toTrimmedString(current.lr_number) !== toTrimmedString(next.lr_number)
      || toTrimmedString(current.lr_date) !== toTrimmedString(next.lr_date);
    if (!changed) return doErrorResponse(req, ctx, "DISPATCH_AMENDMENT_NO_CHANGE", 400, "Change at least one transport, vehicle, LR number, or LR date.");

    const { error: amendmentError } = await serviceRoleClient.schema("erp_procurement").rpc("amend_delivery_challan_dispatch_details", {
      p_dc_id: dcId,
      p_transporter_id: next.transporter_id,
      p_vehicle_number: next.vehicle_number,
      p_lr_number: next.lr_number,
      p_lr_date: next.lr_date,
      p_reason: reason,
      p_amended_by: ctx.auth_user_id,
    });
    if (amendmentError) return doErrorResponse(req, ctx, "DISPATCH_AMENDMENT_UPDATE_FAILED", 500, amendmentError.message || "Unable to amend dispatch details.");
    return okResponse(await hydrateDeliveryOrderUnified(dcId), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "DISPATCH_AMENDMENT_FAILED";
    const status = code === "DO_NOT_FOUND" ? 404 : code === "COMPANY_SCOPE_VIOLATION" ? 403 : code.includes("REQUIRED") || code.includes("BLOCKED") || code.includes("NO_CHANGE") ? 400 : 500;
    return doErrorResponse(req, ctx, code, status, code);
  }
}

// "Post Goods & Create Invoice" -- one click, whole DO. Re-derives groups
// server-side (never trusts the client's own grouping), requires exact
// coverage (every computed group must have matching input, no more no
// less), then posts each group as its own post_document/
// complete_pgi_invoice_action call. §8D note: only WITHIN one group's own
// call is atomicity guaranteed by the transaction -- ACROSS groups, if
// group 3 of 5 fails, groups 1-2 are already real, fully valid, fully
// reversible invoices (not phantom half-writes); the DC only flips to
// DISPATCHED once every group succeeds (is_final_group on the last call).
export async function postPgiInvoiceGroupsHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const dcId = getIdFromPath(req);
    if (!dcId) return doErrorResponse(req, ctx, "DO_ID_REQUIRED", 400, "Delivery order id is required.");
    const body = await parseBody(req);
    const submittedGroups = Array.isArray(body.groups) ? (body.groups as InvoiceGroupInput[]) : [];
    if (submittedGroups.length === 0) return doErrorResponse(req, ctx, "PGI_INVOICE_GROUPS_REQUIRED", 400, "At least one invoice group is required.");

    const { dc, groups } = await computeInvoiceGroups(dcId);
    const companyId = toTrimmedString(dc.selling_company_id);
    try {
      await assertCompanyScope(ctx, companyId);
    } catch {
      return doErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }
    if (!(await canMaintainSalesInvoice(ctx, companyId, "WRITE"))) {
      return doErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have Invoice/PGI create access at this company.");
    }
    const dcStatus = toUpperTrimmedString(dc.status);
    if (!new Set(["CREATED", "DISPATCHED"]).has(dcStatus)) {
      return doErrorResponse(req, ctx, "DO_NOT_READY_FOR_PGI", 400, "Only a CREATED delivery order or a cancelled group on a DISPATCHED delivery order can be invoiced.");
    }

    const inputByKey = new Map(submittedGroups.map((g) => [toTrimmedString(g.group_key), g]));
    if (inputByKey.size !== submittedGroups.length) return doErrorResponse(req, ctx, "PGI_INVOICE_GROUP_DUPLICATE_KEY", 400, "Duplicate group_key in submission.");
    const selectedGroups = groups.filter((group) => inputByKey.has(group.group_key));
    if (selectedGroups.length !== submittedGroups.length) return doErrorResponse(req, ctx, "PGI_INVOICE_GROUP_MISMATCH", 400, "Submitted invoice groups do not match this delivery order's current lines -- reload and retry.");
    if (dcStatus === "CREATED") {
      if (selectedGroups.length !== groups.length) return doErrorResponse(req, ctx, "PGI_INVOICE_GROUP_MISSING", 400, "Enter invoice details for every group before the first PGI posting.");
    } else {
      const { data: historicalInvoiceRows, error: historicalInvoiceError } = await serviceRoleClient.schema("erp_procurement").from("sales_invoice")
        .select("so_id, sto_id, fo_id, status").eq("dc_id", dcId);
      if (historicalInvoiceError) return doErrorResponse(req, ctx, "PGI_INVOICE_GROUPS_FETCH_FAILED", 500, "Unable to verify cancelled invoice groups.");
      const historicalInvoices = (historicalInvoiceRows ?? []) as JsonRecord[];
      for (const group of selectedGroups) {
        const matches = historicalInvoices.filter((invoice) => toTrimmedString(invoice.so_id) === toTrimmedString(group.so_id)
          && toTrimmedString(invoice.sto_id) === toTrimmedString(group.sto_id)
          && toTrimmedString(invoice.fo_id) === toTrimmedString(group.fo_id));
        if (!matches.some((invoice) => toUpperTrimmedString(invoice.status) === "CANCELLED") || matches.some((invoice) => toUpperTrimmedString(invoice.status) === "POSTED")) {
          return doErrorResponse(req, ctx, "PGI_INVOICE_GROUP_RECREATE_BLOCKED", 400, "Only a cancelled invoice group can be recreated.");
        }
      }
    }

    const categoryIds = [...new Set(submittedGroups.flatMap((g) => (g.additional_costs ?? []).map((a) => toTrimmedString(a.category_id)).filter(Boolean)))];
    if (categoryIds.length) {
      const { data: categoryRows, error: categoryError } = await serviceRoleClient
        .schema("erp_procurement").from("additional_cost_category").select("id").in("id", categoryIds);
      if (categoryError) return doErrorResponse(req, ctx, "ADDITIONAL_COST_CATEGORY_LOOKUP_FAILED", 500, "Unable to verify additional cost categories.");
      const validIds = new Set((categoryRows ?? []).map((r: JsonRecord) => String(r.id)));
      for (const id of categoryIds) {
        if (!validIds.has(id)) return doErrorResponse(req, ctx, "ADDITIONAL_COST_CATEGORY_INVALID", 400, `Unknown additional cost category ${id}.`);
      }
    }

    const results: JsonRecord[] = [];
    const postGroups: JsonRecord[] = [];
    for (let index = 0; index < selectedGroups.length; index++) {
      const group = selectedGroups[index];
      const input = inputByKey.get(group.group_key)!;
      const isFinalGroup = index === selectedGroups.length - 1;
      const alreadyPostedNote = results.length > 0 ? ` (${results.length} invoice(s) from this same action already posted -- reverse them individually if you need to undo, do not retry blindly.)` : "";

      const tallyInvoiceNumber = toTrimmedString(input.tally_invoice_number);
      const tallyInvoiceDate = toTrimmedString(input.tally_invoice_date);
      if (!tallyInvoiceNumber || !tallyInvoiceDate) {
        return doErrorResponse(req, ctx, "PGI_INVOICE_TALLY_FIELDS_REQUIRED", 400, `Tally Invoice Number and Date are required for ${group.document_number}.${alreadyPostedNote}`);
      }
      if (!isManualDocumentDateWithinWindow(tallyInvoiceDate)) {
        return doErrorResponse(req, ctx, "PGI_MANUAL_DATE_OUTSIDE_ALLOWED_WINDOW", 400, MANUAL_DOCUMENT_DATE_WINDOW_MESSAGE);
      }
      const inboundNumber = toTrimmedString(input.inbound_number);
      if (group.ibn_required && !inboundNumber) {
        return doErrorResponse(req, ctx, "PGI_INVOICE_IBN_REQUIRED", 400, `Inbound Number (IBN) is required for ${group.document_number}.${alreadyPostedNote}`);
      }
      const eWayBillApplicable = input.e_way_bill_applicable === true;
      const eWayBillNumber = eWayBillApplicable ? (toTrimmedString(input.e_way_bill_number) || null) : null;

      const freightEligible = Boolean(group.freight_term && EXCLUSIVE_FREIGHT_TERMS.has(group.freight_term));
      const freightInput = input.freight ?? {};
      // To-pay freight belongs to the customer/carrier settlement, never to
      // this sales invoice. Ignore any attempted amount from a crafted payload.
      const freightToPay = freightEligible && freightInput.to_pay === true;
      const freightIncluded = freightEligible && !freightToPay && freightInput.included === true;
      let freightMode: "AD_HOC" | "RATE" | null = null;
      let freightRate: number | null = null;
      let freightAmount: number | null = null;
      let freightGstIncluded = false;
      let freightGstTreatment: "INCLUSIVE" | "EXCLUSIVE" | null = null;
      let freightGstRate: number | null = null;
      let freightGstAmount: number | null = null;
      if (freightIncluded) {
        freightMode = freightInput.mode === "RATE" ? "RATE" : "AD_HOC";
        if (freightMode === "RATE") {
          freightRate = parsePositiveNumber(freightInput.rate);
          if (!freightRate) return doErrorResponse(req, ctx, "PGI_INVOICE_FREIGHT_RATE_REQUIRED", 400, `Freight rate is required for ${group.document_number}.${alreadyPostedNote}`);
          freightAmount = Number((freightRate * group.net_weight).toFixed(4));
        } else {
          freightAmount = parsePositiveNumber(freightInput.amount);
          if (!freightAmount) return doErrorResponse(req, ctx, "PGI_INVOICE_FREIGHT_AMOUNT_REQUIRED", 400, `Freight amount is required for ${group.document_number}.${alreadyPostedNote}`);
        }
        freightGstIncluded = freightInput.gst_included === true;
        if (freightGstIncluded) {
          freightGstTreatment = GST_TREATMENTS.has(String(freightInput.gst_treatment)) ? (freightInput.gst_treatment as "INCLUSIVE" | "EXCLUSIVE") : "EXCLUSIVE";
          freightGstRate = parsePositiveNumber(freightInput.gst_rate) ?? 0;
          freightGstAmount = freightGstTreatment === "INCLUSIVE"
            ? Number((freightAmount - freightAmount / (1 + freightGstRate / 100)).toFixed(4))
            : Number((freightAmount * (freightGstRate / 100)).toFixed(4));
        }
      }
      const freightInvoiceContribution = freightIncluded
        ? Number(((freightAmount ?? 0) + (freightGstIncluded && freightGstTreatment === "EXCLUSIVE" ? (freightGstAmount ?? 0) : 0)).toFixed(4))
        : 0;

      const additionalCostInputs = Array.isArray(input.additional_costs) ? input.additional_costs : [];
      const additionalCostLines = additionalCostInputs.map((ac) => {
        const amount = parsePositiveNumber(ac.amount) ?? 0;
        const gstIncluded = ac.gst_included === true;
        const gstTreatment = gstIncluded && GST_TREATMENTS.has(String(ac.gst_treatment)) ? (ac.gst_treatment as "INCLUSIVE" | "EXCLUSIVE") : null;
        const gstRate = gstIncluded ? (parsePositiveNumber(ac.gst_rate) ?? 0) : null;
        const gstAmount = gstIncluded
          ? (gstTreatment === "INCLUSIVE" ? Number((amount - amount / (1 + (gstRate ?? 0) / 100)).toFixed(4)) : Number((amount * ((gstRate ?? 0) / 100)).toFixed(4)))
          : null;
        const lineTotal = gstIncluded && gstTreatment === "EXCLUSIVE" ? Number((amount + (gstAmount ?? 0)).toFixed(4)) : amount;
        return { category_id: toTrimmedString(ac.category_id), amount, gst_included: gstIncluded, gst_treatment: gstTreatment, gst_rate: gstRate, gst_amount: gstAmount, line_total: lineTotal };
      });
      for (const ac of additionalCostLines) {
        if (!ac.category_id || !(ac.amount > 0)) {
          return doErrorResponse(req, ctx, "PGI_INVOICE_ADDITIONAL_COST_INVALID", 400, `Every additional cost line needs a category and a positive amount (${group.document_number}).${alreadyPostedNote}`);
        }
      }
      const additionalCostTotal = Number(additionalCostLines.reduce((sum, ac) => sum + ac.line_total, 0).toFixed(4));

      const preRoundValue = group.total_taxable_value + group.total_gst_amount + freightInvoiceContribution + additionalCostTotal;
      const roundOffAmount = Number((parseNullableNumber(input.round_off_amount) ?? 0).toFixed(4));
      const totalInvoiceValue = Number((preRoundValue + roundOffAmount).toFixed(2));

      // §133.16 Part B -- Go-live Catch-up Backfill (TEMPORARY, time-boxed,
      // isolated entirely in dispatchBackfillPosting.ts -- delete that file
      // + this block once Phase 3 is the business owner's confirmed
      // permanent state). Phase 1 (now through 7 Sept 2026): auto-resolve
      // posting_date per Dispatch Category for August historical invoices
      // only; September-or-later invoices retain their Tally Invoice Date.
      // Phase 2 (8-15 Sept): today's real date, no enforcement yet. Phase 3
      // (after 15 Sept): hard-block unless Tally Invoice Date equals today.
      // MTEST resolves to the SO's own `so_date` (group.document_date for a
      // SALES_ORDER group) -- corrected 2026-08-28, was a random day in
      // 28-31 August unconditionally, which mis-dated a genuine same-day
      // MTEST dispatch entered for real.
      const today = todayIsoDate();
      const backfillPhase = resolveBackfillPhase(today);
      let resolvedPostingDate = today;
      if (backfillPhase === "PHASE_1" && isHistoricalBackfillInvoiceDate(tallyInvoiceDate)) {
        const batchPkoIds = [...new Set(group.lines.map((l) => l.packing_order_id).filter((id): id is string => Boolean(id)))];
        const { data: backfillPkoRows, error: backfillPkoError } = batchPkoIds.length
          ? await serviceRoleClient.schema("erp_production").from("packing_order").select("id, po_type, finalized_at").in("id", batchPkoIds)
          : { data: [] as JsonRecord[], error: null };
        if (backfillPkoError) return doErrorResponse(req, ctx, "PGI_BACKFILL_PACKING_ORDER_LOOKUP_FAILED", 500, "Unable to load Packing PO details for posting-date resolution.");
        const mtoHpsPko = ((backfillPkoRows ?? []) as JsonRecord[]).find((row) => ["PMTO", "PHPS"].includes(toUpperTrimmedString(row.po_type)) && row.finalized_at);
        const classification: BackfillClassification = {
          hasMtoHpsBatch: Boolean(mtoHpsPko),
          hasMtestBatch: ((backfillPkoRows ?? []) as JsonRecord[]).some((row) => toUpperTrimmedString(row.po_type) === "PTEST"),
          mtoHpsPackingPoFinalizedAtIso: mtoHpsPko ? String(mtoHpsPko.finalized_at) : null,
          mtestSoDate: group.document_date,
        };
        resolvedPostingDate = resolvePhase1PostingDate(classification, tallyInvoiceDate);
      } else if (backfillPhase === "PHASE_1") {
        resolvedPostingDate = tallyInvoiceDate;
      } else if (backfillPhase === "PHASE_3") {
        try {
          assertPhase3PostingDateMatch(tallyInvoiceDate, today);
        } catch {
          return doErrorResponse(req, ctx, "PGI_BACKFILL_WINDOW_CLOSED_DATE_MISMATCH", 400, `Tally Invoice Date must equal today's date for ${group.document_number} -- backdated posting is no longer allowed.${alreadyPostedNote}`);
        }
      }

      const movements: JsonRecord[] = [];
      for (const line of group.lines) {
        const postingBlocked = await hasPhysicalInventoryBlock(line.material_id, line.storage_location_id, "UNRESTRICTED");
        if (postingBlocked) return doErrorResponse(req, ctx, "MATERIAL_POSTING_BLOCKED", 409, `Material has an active physical inventory count in progress (${group.document_number}).${alreadyPostedNote}`);
        let snapshot: JsonRecord;
        try {
          snapshot = await getSnapshotForIssue(companyId, line.storage_location_id, line.material_id);
        } catch {
          return doErrorResponse(req, ctx, "INSUFFICIENT_STOCK", 400, `No unrestricted stock found for a line in ${group.document_number}.${alreadyPostedNote}`);
        }
        if (Number(snapshot.quantity ?? 0) < line.quantity) {
          return doErrorResponse(req, ctx, "INSUFFICIENT_STOCK", 400, `Insufficient stock for a line in ${group.document_number}.${alreadyPostedNote}`);
        }
        movements.push({
          document_number: "",
          document_date: "",
          posting_date: resolvedPostingDate,
          movement_type_code: "P601",
          company_id: companyId,
          storage_location_id: line.storage_location_id,
          material_id: line.material_id,
          quantity: line.quantity,
          base_uom_code: line.uom_code,
          unit_value: Number(snapshot.valuation_rate ?? 0),
          stock_type_code: "UNRESTRICTED",
          direction: "OUT",
          // Preserve batch genealogy on the stock movement.  This is null for
          // ordinary non-batch dispatches, which is an intentional distinction.
          batch_number: line.batch_number,
          line_ref: line.dc_line_id,
        });
      }

      const invoiceId = crypto.randomUUID();
      const invoiceDate = todayIsoDate();

      const invoiceLinesPayload = group.lines.map((line, lineIndex) => {
        const taxableValue = Number((line.quantity * line.unit_value).toFixed(4));
        const cgstAmount = group.gst_type === "CGST_SGST" ? Number((line.gst_amount / 2).toFixed(4)) : null;
        const sgstAmount = group.gst_type === "CGST_SGST" ? Number((line.gst_amount / 2).toFixed(4)) : null;
        const igstAmount = group.gst_type === "IGST" ? line.gst_amount : null;
        return {
          line_number: lineIndex + 1,
          so_line_id: line.so_line_id,
          dc_line_id: line.dc_line_id,
          material_id: line.material_id,
          quantity: line.quantity,
          uom_code: line.uom_code,
          rate: line.unit_value,
          // §133.21 -- carried through to the permanent posted invoice line
          // too, so the invoice detail view doesn't regress once posted.
          display_rate_basis: line.display_rate_basis,
          display_rate: line.display_rate,
          display_uom_code: line.display_uom_code,
          pack_qty: line.pack_qty,
          pack_uom_code: line.pack_uom_code,
          taxable_value: taxableValue,
          gst_rate: line.gst_rate,
          cgst_amount: cgstAmount,
          sgst_amount: sgstAmount,
          igst_amount: igstAmount,
          line_total: line.line_total,
        };
      });

      const reservationsPayload = group.lines
        .map((line) => ({ source_line_id: line.so_line_id || line.sto_line_id, issued_qty: line.quantity }))
        .filter((r) => r.source_line_id);

      // §133.14 Part B -- computed fresh per group, written in the same
      // transaction as this group's own P601 posting (§8D) via the
      // completion function below.
      const dispatchRecoRows = await computeDispatchRecoRows(group);
      const dispatchRecoLinesPayload = dispatchRecoRows.map((row) => ({
        ...row,
        dc_number: toTrimmedString((dc as JsonRecord).dc_number) || null,
        tally_invoice_number: tallyInvoiceNumber,
        tally_invoice_date: tallyInvoiceDate,
        inbound_number: inboundNumber || null,
      }));

      const context = {
        action: "CREATE",
        dc_id: dcId,
        is_final_group: isFinalGroup,
        invoice: {
          // The atomic database function allocates this only after every
          // validation has passed, so a failed PGI cannot consume a serial.
          invoice_number: null,
          invoice_date: invoiceDate,
          company_id: companyId,
          customer_id: group.customer_id,
          sto_id: group.sto_id,
          dc_id: dcId,
          so_id: group.so_id,
          payment_term_id: group.payment_term_id,
          gst_type: group.gst_type,
          bill_to_name: group.bill_to.name,
          bill_to_address: group.bill_to.address,
          bill_to_state: group.bill_to.state,
          bill_to_gst_number: group.bill_to.gst_number,
          ship_to_name: group.ship_to.name,
          ship_to_address: group.ship_to.address,
          ship_to_state: group.ship_to.state,
          ship_to_gst_number: group.ship_to.gst_number,
          tally_invoice_number: tallyInvoiceNumber,
          tally_invoice_date: tallyInvoiceDate,
          freight_to_pay: freightToPay,
          freight_included: freightIncluded,
          freight_amount: freightAmount,
          freight_mode: freightMode,
          freight_rate: freightRate,
          freight_net_weight: freightIncluded ? group.net_weight : null,
          freight_gst_included: freightGstIncluded,
          freight_gst_treatment: freightGstTreatment,
          freight_gst_rate: freightGstRate,
          freight_gst_amount: freightGstAmount,
          additional_cost_total: additionalCostTotal,
          round_off_amount: roundOffAmount,
          inbound_number: inboundNumber || null,
          fo_id: group.fo_id,
          fo_number: group.fo_number,
          fo_date: group.fo_date,
          e_way_bill_applicable: eWayBillApplicable,
          e_way_bill_number: eWayBillNumber,
          total_taxable_value: group.total_taxable_value,
          total_cgst_amount: group.total_cgst_amount,
          total_sgst_amount: group.total_sgst_amount,
          total_igst_amount: group.total_igst_amount,
          total_gst_amount: group.total_gst_amount,
          total_invoice_value: totalInvoiceValue,
          posted_by: ctx.auth_user_id,
          remarks: toTrimmedString(input.remarks) || null,
          created_by: ctx.auth_user_id,
        },
        lines: invoiceLinesPayload,
        additional_cost_lines: additionalCostLines,
        dispatch_reco_lines: dispatchRecoLinesPayload,
        reservations: reservationsPayload,
      };

      postGroups.push({ invoice_id: invoiceId, movements, context });
      results.push({ invoice_id: invoiceId, invoice_number: null, group_key: group.group_key, document_number: group.document_number });
    }

    // One database call owns every group. A failure in any group's P601,
    // invoice, reservation, or reconciliation write rolls all groups back.
    const { error: postGroupsError } = await serviceRoleClient.schema("erp_inventory")
      .rpc("post_sales_invoice_groups_atomic", { p_groups: postGroups, p_posted_by: ctx.auth_user_id });
    if (postGroupsError) return doErrorResponse(req, ctx, "PGI_POST_FAILED", 500, postGroupsError.message || "Unable to post PGI and invoice.");

    return okResponse({ dc_id: dcId, invoices: results }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "PGI_INVOICE_GROUPS_POST_FAILED";
    const status = code === "DO_NOT_FOUND" ? 404
      : code === "COMPANY_SCOPE_VIOLATION" ? 403
      : code.includes("REQUIRED") || code.includes("INVALID") || code.includes("NOT_READY") || code === "INSUFFICIENT_STOCK" || code === "DO_EMPTY" || code.includes("MISSING") || code.includes("MISMATCH") ? 400
      : 500;
    return doErrorResponse(req, ctx, code, status, code);
  }
}
