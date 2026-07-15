/*
 * File-Path: supabase/functions/api/_core/production/partial_reversal.handlers.ts
 * Gate: 27.19
 * Domain: PRODUCTION
 * Purpose: PR19 Partial Batch Reversal + PR20 Partial Reversal Report (§83.7,
 * LOCKED 2026-07-12, MTO/HPS scope only). Reuses existing movement types
 * (P101/P102/P261/P262) — no new movement type codes. Operates only on
 * already-VERIFIED batches sitting in UNRESTRICTED stock; has nothing to do
 * with Customer Return/QA-Blocked-release (a separate, still-undesigned,
 * Dispatch-blocked feature).
 * Authority: Backend
 */

import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { okResponse, errorResponse } from "../response.ts";
import type { ProdHandlerContext } from "./production.shared.ts";
import {
  assertManagerOrSARole,
  assertProdReadRole,
  parseBody,
  toTrimmedString,
  toUpperTrimmedString,
  parsePositiveNumber,
  getIdFromPath,
} from "./production.shared.ts";
import { generateGlobalDocNumber } from "./production.utils.ts";
import { resolveUserDisplayNames } from "../../_shared/resolveUserDisplayNames.ts";

type JsonRecord = Record<string, unknown>;

const VALID_PO_TYPES = new Set(["MTO", "HPS"]);

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function prErr(req: Request, ctx: ProdHandlerContext, code: string, status: number, msg: string): Response {
  return errorResponse(code, msg, ctx.request_id, "NONE", status, {}, req);
}

async function getMaterialMapByIds(ids: string[], selectColumns: string): Promise<Map<string, JsonRecord>> {
  const matIds = [...new Set(ids.filter(Boolean))];
  const map = new Map<string, JsonRecord>();
  if (matIds.length === 0) return map;
  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("material_master")
    .select(selectColumns)
    .in("id", matIds);
  if (error) {
    console.error("[partial_reversal.getMaterialMapByIds] query failed:", JSON.stringify(error));
    throw new Error("PR19_MATERIAL_LOOKUP_FAILED");
  }
  for (const row of (data ?? []) as JsonRecord[]) map.set(String(row.id), row);
  return map;
}

async function getStorageLocationMapByIds(ids: string[]): Promise<Map<string, JsonRecord>> {
  const slocIds = [...new Set(ids.filter(Boolean))];
  const map = new Map<string, JsonRecord>();
  if (slocIds.length === 0) return map;
  const { data, error } = await serviceRoleClient
    .schema("erp_inventory")
    .from("storage_location_master")
    .select("id, code, name")
    .in("id", slocIds);
  if (error) {
    console.error("[partial_reversal.getStorageLocationMapByIds] query failed:", JSON.stringify(error));
    throw new Error("PR19_SLOC_LOOKUP_FAILED");
  }
  for (const row of (data ?? []) as JsonRecord[]) map.set(String(row.id), row);
  return map;
}

async function getCompanyMapByIds(ids: string[]): Promise<Map<string, JsonRecord>> {
  const companyIds = [...new Set(ids.filter(Boolean))];
  const map = new Map<string, JsonRecord>();
  if (companyIds.length === 0) return map;
  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("companies")
    .select("id, company_code, company_name")
    .in("id", companyIds);
  if (error) throw new Error("PR19_COMPANY_LOOKUP_FAILED");
  for (const row of (data ?? []) as JsonRecord[]) map.set(String(row.id), row);
  return map;
}

async function getMachineMapByIds(ids: string[]): Promise<Map<string, JsonRecord>> {
  const machineIds = [...new Set(ids.filter(Boolean))];
  const map = new Map<string, JsonRecord>();
  if (machineIds.length === 0) return map;
  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("machine_master")
    .select("id, machine_code, machine_name")
    .in("id", machineIds);
  if (error) throw new Error("PR19_MACHINE_LOOKUP_FAILED");
  for (const row of (data ?? []) as JsonRecord[]) map.set(String(row.id), row);
  return map;
}

function isAdminBypass(ctx: ProdHandlerContext): boolean {
  return ctx.context.isAdmin === true || ctx.roleCode === "SA" || ctx.roleCode === "GA";
}

async function assertPartialReversalCompanyScope(ctx: ProdHandlerContext, companyId: string): Promise<void> {
  if (isAdminBypass(ctx)) return;
  const normalizedCompanyId = toTrimmedString(companyId);
  if (!normalizedCompanyId) throw new Error("PR19_SCOPE_VIOLATION");
  const { data, error } = await serviceRoleClient
    .schema("erp_map")
    .from("user_companies")
    .select("company_id")
    .eq("auth_user_id", ctx.auth_user_id)
    .eq("company_id", normalizedCompanyId)
    .maybeSingle();
  if (error || !data) throw new Error("PR19_SCOPE_VIOLATION");
}

async function postStockMovement(params: {
  documentNumber: string; documentDate: string; postingDate: string;
  movementTypeCode: string; companyId: unknown; storageLocationId: unknown;
  materialId: unknown; quantity: number; baseUomCode: string; unitValue: number;
  stockTypeCode: string; direction: "IN" | "OUT"; postedBy: string; reversalOfId?: string | null;
  batchNumber?: string | null;
}): Promise<{ stock_document_id: string; stock_ledger_id: string }> {
  const { data, error } = await serviceRoleClient.schema("erp_inventory").rpc("post_stock_movement", {
    p_document_number: params.documentNumber, p_document_date: params.documentDate,
    p_posting_date: params.postingDate, p_movement_type_code: params.movementTypeCode,
    p_company_id: params.companyId, p_storage_location_id: params.storageLocationId,
    p_material_id: params.materialId, p_quantity: params.quantity,
    p_base_uom_code: params.baseUomCode, p_unit_value: params.unitValue,
    p_stock_type_code: params.stockTypeCode, p_direction: params.direction,
    p_posted_by: params.postedBy, p_reversal_of_id: params.reversalOfId ?? null,
    p_batch_number: params.batchNumber ?? null,
  });
  if (error || !Array.isArray(data) || data.length === 0) {
    console.error("[partial_reversal.postStockMovement] rpc failed:", JSON.stringify(error));
    throw new Error(`PR19_STOCK_POST_FAILED: ${params.movementTypeCode}`);
  }
  return data[0] as { stock_document_id: string; stock_ledger_id: string };
}

// post_stock_movement()'s p_reversal_of_id references stock_document.id, not
// stock_ledger.id — see the same fix applied in process_order.handlers.ts /
// packing_order.handlers.ts.
async function resolveStockDocumentIdsByLedgerIds(ledgerIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(ledgerIds.filter(Boolean))];
  const map = new Map<string, string>();
  if (ids.length === 0) return map;
  const { data, error } = await serviceRoleClient
    .schema("erp_inventory")
    .from("stock_ledger")
    .select("id, stock_document_id")
    .in("id", ids);
  if (error) {
    console.error("[partial_reversal.resolveStockDocumentIdsByLedgerIds] query failed:", JSON.stringify(error));
    throw new Error("PR19_LEDGER_LOOKUP_FAILED");
  }
  for (const row of (data ?? []) as JsonRecord[]) {
    const ledgerId = String(row.id ?? "");
    const docId = toTrimmedString(row.stock_document_id);
    if (ledgerId && docId) map.set(ledgerId, docId);
  }
  return map;
}

// Physical UNRESTRICTED ledger sum for one (material, storage_location) pair,
// optionally filtered to one batch_number. Deliberately NOT reservation-netted
// (matches the already-locked "Current Stock shows actual physical, not
// reservation-adjusted" philosophy) and NOT filtered by document_number here —
// callers that need a per-Packing-PO figure subtract prior reversals separately.
async function sumUnrestrictedLedgerQty(
  companyId: string,
  materialId: string,
  storageLocationId: string,
  batchNumber?: string | null,
): Promise<number> {
  let query = serviceRoleClient
    .schema("erp_inventory")
    .from("stock_ledger")
    .select("direction, quantity")
    .eq("company_id", companyId)
    .eq("material_id", materialId)
    .eq("storage_location_id", storageLocationId)
    .eq("stock_type_code", "UNRESTRICTED");
  if (batchNumber) query = query.eq("batch_number", batchNumber);
  const { data, error } = await query;
  if (error) {
    console.error("[partial_reversal.sumUnrestrictedLedgerQty] query failed:", JSON.stringify(error));
    throw new Error("PR19_STOCK_LOOKUP_FAILED");
  }
  return ((data ?? []) as JsonRecord[]).reduce((sum, row) => {
    const qty = Number(row.quantity ?? 0);
    return sum + (String(row.direction) === "IN" ? qty : -qty);
  }, 0);
}

// Sum of reverse_qty already posted against a given selected row via prior
// PR19 transactions — subtracted from the raw ledger balance so Page 2 never
// offers to reverse the same qty twice.
async function sumPriorReversedQty(
  selectedRowType: string,
  selectedMaterialId: string,
  selectedStorageLocationId: string,
  sourceProcessOrderId: string,
  selectedPackingOrderId: string | null,
): Promise<number> {
  let query = serviceRoleClient
    .schema("erp_production")
    .from("partial_batch_reversal")
    .select("reverse_qty")
    .eq("selected_row_type", selectedRowType)
    .eq("selected_material_id", selectedMaterialId)
    .eq("selected_storage_location_id", selectedStorageLocationId)
    .eq("source_process_order_id", sourceProcessOrderId)
    .eq("status", "POSTED");
  query = selectedPackingOrderId
    ? query.eq("selected_packing_order_id", selectedPackingOrderId)
    : query.is("selected_packing_order_id", null);
  const { data, error } = await query;
  if (error) {
    console.error("[partial_reversal.sumPriorReversedQty] query failed:", JSON.stringify(error));
    throw new Error("PR19_STOCK_LOOKUP_FAILED");
  }
  return ((data ?? []) as JsonRecord[]).reduce((sum, row) => sum + Number(row.reverse_qty ?? 0), 0);
}

// GET /api/production/partial-reversals/prodshades?company_id=&po_type=
// Page 1 dropdown — prodshades that have at least one VERIFIED batch of this
// PO type for this company (nothing to reverse otherwise).
export async function listPartialReversalProdshadesHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const url = new URL(req.url);
    const companyId = toTrimmedString(url.searchParams.get("company_id") ?? "");
    const poType = toUpperTrimmedString(url.searchParams.get("po_type") ?? "");
    if (!companyId || !VALID_PO_TYPES.has(poType)) {
      return prErr(req, ctx, "PR19_INVALID", 400, "company_id and valid po_type (MTO/HPS) required");
    }
    await assertPartialReversalCompanyScope(ctx, companyId);

    const { data, error } = await serviceRoleClient
      .schema("erp_production")
      .from("process_order")
      .select("material_id")
      .eq("company_id", companyId)
      .eq("po_type", poType)
      .eq("status", "VERIFIED");
    if (error) throw new Error("PR19_PRODSHADE_LIST_FAILED");

    const materialIds = [...new Set(((data ?? []) as JsonRecord[]).map((row) => String(row.material_id ?? "")).filter(Boolean))];
    const materialMap = await getMaterialMapByIds(materialIds, "id, pace_code, material_name, external_code, shade_code");
    return okResponse({
      data: materialIds.map((id) => materialMap.get(id)).filter(Boolean),
    }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PR19_PRODSHADE_LIST_FAILED";
    return prErr(req, ctx, code, code === "PR19_INVALID" ? 400 : (code === "PR19_SCOPE_VIOLATION" ? 403 : 500), "Prodshade list failed");
  }
}

// GET /api/production/partial-reversals/resolve-batch?company_id=&po_type=&prodshade_material_id=&batch_number=
// Page 1 "Enter" — resolves the exact VERIFIED Process PO owning this batch.
export async function resolvePartialReversalBatchHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const url = new URL(req.url);
    const companyId = toTrimmedString(url.searchParams.get("company_id") ?? "");
    const poType = toUpperTrimmedString(url.searchParams.get("po_type") ?? "");
    const prodshadeMaterialId = toTrimmedString(url.searchParams.get("prodshade_material_id") ?? "");
    const batchNumber = toTrimmedString(url.searchParams.get("batch_number") ?? "");
    if (!companyId || !VALID_PO_TYPES.has(poType) || !prodshadeMaterialId || !batchNumber) {
      return prErr(req, ctx, "PR19_INVALID", 400, "company_id, po_type, prodshade_material_id and batch_number required");
    }
    await assertPartialReversalCompanyScope(ctx, companyId);

    const { data: po, error } = await serviceRoleClient
      .schema("erp_production")
      .from("process_order")
      .select("id, po_number, company_id, po_type, material_id, machine_id, stroke_master_id, batch_number, actual_qty, status")
      .eq("company_id", companyId)
      .eq("po_type", poType)
      .eq("material_id", prodshadeMaterialId)
      .eq("batch_number", batchNumber)
      .eq("status", "VERIFIED")
      .maybeSingle();
    if (error) throw new Error("PR19_BATCH_LOOKUP_FAILED");
    if (!po) return prErr(req, ctx, "PR19_BATCH_NOT_FOUND", 404, "No VERIFIED batch found matching company/type/prodshade/batch number");

    const poData = po as JsonRecord;
    const [materialMap, machineMap] = await Promise.all([
      getMaterialMapByIds([String(poData.material_id ?? "")], "id, pace_code, material_name, external_code, shade_code"),
      getMachineMapByIds([String(poData.machine_id ?? "")]),
    ]);

    return okResponse({
      data: {
        ...poData,
        material: materialMap.get(String(poData.material_id ?? "")) ?? null,
        machine: machineMap.get(String(poData.machine_id ?? "")) ?? null,
      },
    }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PR19_BATCH_LOOKUP_FAILED";
    return prErr(req, ctx, code, code === "PR19_INVALID" ? 400 : (code === "PR19_BATCH_NOT_FOUND" ? 404 : (code === "PR19_SCOPE_VIOLATION" ? 403 : 500)), "Batch lookup failed");
  }
}

// GET /api/production/partial-reversals/stock-lines?process_order_id=
// Page 2 — one SFG row (batch-level, Process PO layer) + one row per Packing
// PO that drew SKU/FG stock from this batch (a batch can feed several Packing
// POs — §83.7 movement step 2 needs to reverse one specific Packing-PO-Final
// posting, so SKU rows are broken out per PO, not aggregated).
export async function listPartialReversalStockLinesHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const url = new URL(req.url);
    const processOrderId = toTrimmedString(url.searchParams.get("process_order_id") ?? "");
    if (!processOrderId) return prErr(req, ctx, "PR19_INVALID", 400, "process_order_id required");

    const { data: po, error: poErr } = await serviceRoleClient
      .schema("erp_production")
      .from("process_order")
      .select("id, company_id, material_id, stroke_master_id, batch_number, status")
      .eq("id", processOrderId)
      .maybeSingle();
    if (poErr) throw new Error("PR19_STOCK_LINES_FAILED");
    if (!po || (po as JsonRecord).status !== "VERIFIED") {
      return prErr(req, ctx, "PR19_BATCH_NOT_FOUND", 404, "Process PO not found or not VERIFIED");
    }
    const poData = po as JsonRecord;
    const companyId = String(poData.company_id ?? "");
    const batchNumber = String(poData.batch_number ?? "");

    const { data: stroke, error: strokeErr } = await serviceRoleClient
      .schema("erp_production")
      .from("stroke_master")
      .select("id, default_storage_location_id")
      .eq("id", String(poData.stroke_master_id ?? ""))
      .maybeSingle();
    if (strokeErr) throw new Error("PR19_STOCK_LINES_FAILED");
    const sfgSlocId = toTrimmedString((stroke as JsonRecord | null)?.default_storage_location_id);

    const rows: JsonRecord[] = [];

    // SFG row (Process PO layer, batch-level)
    if (sfgSlocId) {
      const [ledgerQty, priorReversed] = await Promise.all([
        sumUnrestrictedLedgerQty(companyId, String(poData.material_id ?? ""), sfgSlocId, batchNumber),
        sumPriorReversedQty("SFG", String(poData.material_id ?? ""), sfgSlocId, processOrderId, null),
      ]);
      const availableQty = Math.max(0, ledgerQty - priorReversed);
      if (availableQty > 0) {
        rows.push({
          row_type: "SFG",
          material_id: poData.material_id,
          storage_location_id: sfgSlocId,
          packing_order_id: null,
          po_number: null,
          batch_number: batchNumber,
          available_qty: availableQty,
        });
      }
    }

    // SKU rows (Packing PO layer) — every FINAL Packing PO whose own
    // batch_number matches this Process PO's batch.
    const { data: packingOrders, error: poeErr } = await serviceRoleClient
      .schema("erp_production")
      .from("packing_order")
      .select("id, po_number, material_id, status, batch_number")
      .eq("batch_number", batchNumber)
      .eq("status", "FINAL");
    if (poeErr) throw new Error("PR19_STOCK_LINES_FAILED");

    for (const pkRow of (packingOrders ?? []) as JsonRecord[]) {
      const { data: fgLine, error: fgLineErr } = await serviceRoleClient
        .schema("erp_production")
        .from("packing_order_line")
        .select("issue_sloc_id")
        .eq("packing_order_id", String(pkRow.id))
        .eq("line_type", "FG")
        .maybeSingle();
      if (fgLineErr) throw new Error("PR19_STOCK_LINES_FAILED");
      const fgSlocId = toTrimmedString((fgLine as JsonRecord | null)?.issue_sloc_id);
      if (!fgSlocId) continue;

      const priorReversed = await sumPriorReversedQty("SKU", String(pkRow.material_id ?? ""), fgSlocId, processOrderId, String(pkRow.id));
      const ledgerQty = await sumUnrestrictedLedgerQty(companyId, String(pkRow.material_id ?? ""), fgSlocId, batchNumber);
      const availableQty = Math.max(0, ledgerQty - priorReversed);
      if (availableQty > 0) {
        rows.push({
          row_type: "SKU",
          material_id: pkRow.material_id,
          storage_location_id: fgSlocId,
          packing_order_id: pkRow.id,
          po_number: pkRow.po_number,
          batch_number: batchNumber,
          available_qty: availableQty,
        });
      }
    }

    const [materialMap, slocMap] = await Promise.all([
      getMaterialMapByIds(rows.map((r) => String(r.material_id ?? "")), "id, pace_code, material_name, external_code, shade_code, base_uom_code"),
      getStorageLocationMapByIds(rows.map((r) => String(r.storage_location_id ?? ""))),
    ]);

    return okResponse({
      data: rows.map((row) => ({
        ...row,
        material: materialMap.get(String(row.material_id ?? "")) ?? null,
        storage_location: slocMap.get(String(row.storage_location_id ?? "")) ?? null,
      })),
    }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PR19_STOCK_LINES_FAILED";
    return prErr(req, ctx, code, code === "PR19_INVALID" ? 400 : (code === "PR19_BATCH_NOT_FOUND" ? 404 : 500), "Stock line list failed");
  }
}

// GET /api/production/partial-reversals/salvage-batches?company_id=&po_type=&prodshade_material_id=&exclude_process_order_id=
// Page 3 — other batches of the same PO Type/Prodshade currently BATCH_STARTED
// (QA_APPROVED + Start Batch clicked) but not yet FINAL. Traceability tag only.
export async function listSalvageBatchOptionsHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const url = new URL(req.url);
    const companyId = toTrimmedString(url.searchParams.get("company_id") ?? "");
    const poType = toUpperTrimmedString(url.searchParams.get("po_type") ?? "");
    const prodshadeMaterialId = toTrimmedString(url.searchParams.get("prodshade_material_id") ?? "");
    const excludeProcessOrderId = toTrimmedString(url.searchParams.get("exclude_process_order_id") ?? "");
    if (!companyId || !VALID_PO_TYPES.has(poType) || !prodshadeMaterialId) {
      return prErr(req, ctx, "PR19_INVALID", 400, "company_id, po_type and prodshade_material_id required");
    }

    let query = serviceRoleClient
      .schema("erp_production")
      .from("process_order")
      .select("id, po_number, batch_number, status")
      .eq("company_id", companyId)
      .eq("po_type", poType)
      .eq("material_id", prodshadeMaterialId)
      .eq("status", "BATCH_STARTED");
    if (excludeProcessOrderId) query = query.neq("id", excludeProcessOrderId);
    const { data, error } = await query;
    if (error) throw new Error("PR19_SALVAGE_LOOKUP_FAILED");

    return okResponse({ data: data ?? [] }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PR19_SALVAGE_LOOKUP_FAILED";
    return prErr(req, ctx, code, code === "PR19_INVALID" ? 400 : 500, "Salvage batch lookup failed");
  }
}

type RmIntPreviewLine = {
  process_order_line_id: string;
  material_id: string;
  line_material_type: string;
  actual_qty: number;
  ap_approved_qty: number;
  variance_qty: number;
  proportional_actual_qty: number;
  proportional_ap_approved_qty: number;
  proportional_variance_qty: number;
};

// Shared by the Page 3 preview and the Create handler — always recomputed
// server-side from process_order_line_reco (the immutable Verify-time record),
// never trusted from the client. RM/INT belong to the whole batch (Process PO
// layer), so the ratio denominator is always the Process PO's own actual_qty.
async function buildRmIntPreview(processOrderId: string, ratio: number): Promise<RmIntPreviewLine[]> {
  const { data: recoRows, error: recoErr } = await serviceRoleClient
    .schema("erp_production")
    .from("process_order_line_reco")
    .select("process_order_line_id, material_id, line_material_type, actual_qty, ap_approved_qty, variance_qty")
    .eq("process_order_id", processOrderId)
    .eq("is_voided", false)
    .in("line_material_type", ["RM", "INT"]);
  if (recoErr) {
    console.error("[partial_reversal.buildRmIntPreview] query failed:", JSON.stringify(recoErr));
    throw new Error("PR19_RECO_LOOKUP_FAILED");
  }
  return ((recoRows ?? []) as JsonRecord[]).map((row) => {
    const actualQty = Number(row.actual_qty ?? 0);
    const apApprovedQty = Number(row.ap_approved_qty ?? 0);
    const varianceQty = Number(row.variance_qty ?? 0);
    return {
      process_order_line_id: String(row.process_order_line_id ?? ""),
      material_id: String(row.material_id ?? ""),
      line_material_type: String(row.line_material_type ?? ""),
      actual_qty: actualQty,
      ap_approved_qty: apApprovedQty,
      variance_qty: varianceQty,
      proportional_actual_qty: actualQty * ratio,
      proportional_ap_approved_qty: apApprovedQty * ratio,
      proportional_variance_qty: varianceQty * ratio,
    };
  });
}

// GET /api/production/partial-reversals/detail?process_order_id=&row_type=&packing_order_id=&reverse_qty=
// Page 3 read-only preview — RM/INT breakdown for an SFG row, or RM+INT+PM
// for a SKU row (PM lines get a per-line checkbox client-side, default on).
export async function getPartialReversalDetailHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const url = new URL(req.url);
    const processOrderId = toTrimmedString(url.searchParams.get("process_order_id") ?? "");
    const rowType = toUpperTrimmedString(url.searchParams.get("row_type") ?? "");
    const packingOrderId = toTrimmedString(url.searchParams.get("packing_order_id") ?? "");
    const reverseQty = parsePositiveNumber(url.searchParams.get("reverse_qty"));
    if (!processOrderId || !["SFG", "SKU"].includes(rowType) || !reverseQty) {
      return prErr(req, ctx, "PR19_INVALID", 400, "process_order_id, row_type (SFG/SKU) and reverse_qty required");
    }
    if (rowType === "SKU" && !packingOrderId) {
      return prErr(req, ctx, "PR19_INVALID", 400, "packing_order_id required for SKU row");
    }

    const { data: po, error: poErr } = await serviceRoleClient
      .schema("erp_production")
      .from("process_order")
      .select("id, material_id, actual_qty, batch_number, status")
      .eq("id", processOrderId)
      .maybeSingle();
    if (poErr) throw new Error("PR19_DETAIL_FAILED");
    if (!po || (po as JsonRecord).status !== "VERIFIED") {
      return prErr(req, ctx, "PR19_BATCH_NOT_FOUND", 404, "Process PO not found or not VERIFIED");
    }
    const poData = po as JsonRecord;
    const processOrderActualQty = Number(poData.actual_qty ?? 0);
    if (!processOrderActualQty) return prErr(req, ctx, "PR19_DETAIL_FAILED", 422, "Process PO has no actual output to derive a ratio from");

    if (rowType === "SFG") {
      const ratio = reverseQty / processOrderActualQty;
      const rmIntLines = await buildRmIntPreview(processOrderId, ratio);
      const materialMap = await getMaterialMapByIds(
        rmIntLines.map((l) => l.material_id),
        "id, pace_code, material_name, external_code, base_uom_code",
      );
      return okResponse({
        data: {
          row_type: "SFG",
          reverse_qty: reverseQty,
          actual_total_output: processOrderActualQty,
          reversal_ratio: ratio,
          rm_int_lines: rmIntLines.map((l) => ({ ...l, material: materialMap.get(l.material_id) ?? null })),
          pm_lines: [],
        },
      }, ctx.request_id, req);
    }

    // SKU row
    const { data: pkOrder, error: pkErr } = await serviceRoleClient
      .schema("erp_production")
      .from("packing_order")
      .select("id, material_id, actual_qty_kg, status, process_order_id")
      .eq("id", packingOrderId)
      .maybeSingle();
    if (pkErr) throw new Error("PR19_DETAIL_FAILED");
    if (!pkOrder || (pkOrder as JsonRecord).status !== "FINAL" || String((pkOrder as JsonRecord).process_order_id ?? "") !== processOrderId) {
      return prErr(req, ctx, "PR19_PACKING_ORDER_NOT_FOUND", 404, "Packing PO not found, not FINAL, or does not belong to this batch");
    }
    const pkData = pkOrder as JsonRecord;
    const packingActualQty = Number(pkData.actual_qty_kg ?? 0);
    if (!packingActualQty) return prErr(req, ctx, "PR19_DETAIL_FAILED", 422, "Packing PO has no actual output to derive a ratio from");

    // SFG-equivalent qty dissolved by this reversal is 1:1 with reverse_qty
    // (both in KG, no wastage assumed between SFG issue and FG receipt —
    // matches the already-locked "direct 1:1 KG-for-KG fill" design).
    const sfgEquivalentQty = reverseQty;
    const ratioRm = sfgEquivalentQty / processOrderActualQty;
    const ratioPm = reverseQty / packingActualQty;

    const rmIntLines = await buildRmIntPreview(processOrderId, ratioRm);

    const { data: pmLines, error: pmErr } = await serviceRoleClient
      .schema("erp_production")
      .from("packing_order_line")
      .select("id, material_id, actual_material_id, total_qty, actual_qty, issue_sloc_id, uom_code, stock_ledger_id")
      .eq("packing_order_id", packingOrderId)
      .eq("line_type", "PM");
    if (pmErr) throw new Error("PR19_DETAIL_FAILED");

    const pmPreview = ((pmLines ?? []) as JsonRecord[]).map((line) => {
      const baseQty = Number(line.actual_qty ?? line.total_qty ?? 0);
      return {
        packing_order_line_id: String(line.id),
        material_id: toTrimmedString(line.actual_material_id) || String(line.material_id ?? ""),
        formulation_material_id: String(line.material_id ?? ""),
        qty: baseQty,
        proportional_qty: baseQty * ratioPm,
        included: true,
      };
    });

    const materialIds = [...rmIntLines.map((l) => l.material_id), ...pmPreview.map((l) => l.material_id), String(pkData.material_id ?? "")];
    const materialMap = await getMaterialMapByIds(materialIds, "id, pace_code, material_name, external_code, base_uom_code");

    return okResponse({
      data: {
        row_type: "SKU",
        reverse_qty: reverseQty,
        sfg_equivalent_qty: sfgEquivalentQty,
        actual_total_output: packingActualQty,
        reversal_ratio: ratioPm,
        reversal_ratio_rm: ratioRm,
        rm_int_lines: rmIntLines.map((l) => ({ ...l, material: materialMap.get(l.material_id) ?? null })),
        pm_lines: pmPreview.map((l) => ({ ...l, material: materialMap.get(l.material_id) ?? null })),
      },
    }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PR19_DETAIL_FAILED";
    return prErr(req, ctx, code, code === "PR19_INVALID" ? 400 : (code.endsWith("_NOT_FOUND") ? 404 : 500), "Reversal detail failed");
  }
}

// POST /api/production/partial-reversals
// Executes the full §83.7 movement sequence in one transaction (sequential —
// DEPENDENT, brand-new document_number, same item_number race reasoning as
// finalizePackingOrderHandler). RM/INT amounts are always recomputed
// server-side from process_order_line_reco; only the PM per-line
// include/exclude choice is caller-supplied.
export async function createPartialBatchReversalHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const body = await parseBody(req);

    const processOrderId = toTrimmedString(body.process_order_id);
    const rowType = toUpperTrimmedString(body.row_type);
    const packingOrderId = toTrimmedString(body.packing_order_id) || null;
    const reverseQty = parsePositiveNumber(body.reverse_qty);
    const salvageBatchNumber = toTrimmedString(body.salvage_batch_number) || null;
    const pmLineExclusions = new Set(
      Array.isArray(body.pm_line_exclusions) ? (body.pm_line_exclusions as unknown[]).map((v) => toTrimmedString(v)).filter(Boolean) : [],
    );

    if (!processOrderId || !["SFG", "SKU"].includes(rowType) || !reverseQty) {
      return prErr(req, ctx, "PR19_INVALID", 400, "process_order_id, row_type (SFG/SKU) and reverse_qty required");
    }
    if (rowType === "SKU" && !packingOrderId) {
      return prErr(req, ctx, "PR19_INVALID", 400, "packing_order_id required for SKU row");
    }

    const { data: po, error: poErr } = await serviceRoleClient
      .schema("erp_production")
      .from("process_order")
      .select("id, company_id, po_type, material_id, machine_id, stroke_master_id, batch_number, actual_qty, status, fg_stock_ledger_id")
      .eq("id", processOrderId)
      .maybeSingle();
    if (poErr) throw new Error("PR19_CREATE_FAILED");
    if (!po || (po as JsonRecord).status !== "VERIFIED") {
      return prErr(req, ctx, "PR19_BATCH_NOT_FOUND", 404, "Process PO not found or not VERIFIED");
    }
    const poData = po as JsonRecord;
    const companyId = String(poData.company_id ?? "");
    await assertPartialReversalCompanyScope(ctx, companyId);
    if (!VALID_PO_TYPES.has(String(poData.po_type ?? ""))) {
      return prErr(req, ctx, "PR19_INVALID", 422, "PO type not eligible for Partial Batch Reversal (MTO/HPS only)");
    }
    const processOrderActualQty = Number(poData.actual_qty ?? 0);
    if (!processOrderActualQty) return prErr(req, ctx, "PR19_CREATE_FAILED", 422, "Process PO has no actual output to derive a ratio from");

    const { data: stroke, error: strokeErr } = await serviceRoleClient
      .schema("erp_production")
      .from("stroke_master")
      .select("id, default_storage_location_id")
      .eq("id", String(poData.stroke_master_id ?? ""))
      .maybeSingle();
    if (strokeErr) throw new Error("PR19_CREATE_FAILED");
    const sfgSlocId = toTrimmedString((stroke as JsonRecord | null)?.default_storage_location_id);
    if (!sfgSlocId) return prErr(req, ctx, "PR19_CREATE_FAILED", 422, "Stroke has no default storage location");

    // Salvage batch (optional) — traceability tag only, must be BATCH_STARTED
    // (not yet FINAL), same PO type/prodshade family.
    let salvageProcessOrderId: string | null = null;
    if (salvageBatchNumber) {
      const { data: salvagePo, error: salvageErr } = await serviceRoleClient
        .schema("erp_production")
        .from("process_order")
        .select("id, status")
        .eq("company_id", companyId)
        .eq("po_type", String(poData.po_type ?? ""))
        .eq("material_id", String(poData.material_id ?? ""))
        .eq("batch_number", salvageBatchNumber)
        .maybeSingle();
      if (salvageErr) throw new Error("PR19_CREATE_FAILED");
      if (!salvagePo || (salvagePo as JsonRecord).status !== "BATCH_STARTED") {
        return prErr(req, ctx, "PR19_SALVAGE_BATCH_INVALID", 422, "Salvage batch must be BATCH_STARTED and not yet FINAL");
      }
      salvageProcessOrderId = String((salvagePo as JsonRecord).id);
    }

    const today = todayIso();
    const postedBy = ctx.auth_user_id;
    const lineInserts: JsonRecord[] = [];
    let selectedMaterialId = "";
    let selectedStorageLocationId = "";
    let actualTotalOutput = 0;
    let reversalRatio = 0;
    const docNumber = await generateGlobalDocNumber("PARTIAL_REV");

    if (rowType === "SFG") {
      // Re-verify availability server-side — never trust Page 2's number alone.
      const [ledgerQty, priorReversed] = await Promise.all([
        sumUnrestrictedLedgerQty(companyId, String(poData.material_id ?? ""), sfgSlocId, String(poData.batch_number ?? "")),
        sumPriorReversedQty("SFG", String(poData.material_id ?? ""), sfgSlocId, processOrderId, null),
      ]);
      const availableQty = Math.max(0, ledgerQty - priorReversed);
      if (reverseQty > availableQty + 1e-6) {
        return prErr(req, ctx, "PR19_REVERSE_QTY_EXCEEDS_AVAILABLE", 422, `Reverse qty exceeds available (${availableQty})`);
      }

      selectedMaterialId = String(poData.material_id ?? "");
      selectedStorageLocationId = sfgSlocId;
      actualTotalOutput = processOrderActualQty;
      reversalRatio = reverseQty / processOrderActualQty;

      const materialMap = await getMaterialMapByIds([selectedMaterialId], "id, base_uom_code");
      const sfgBaseUom = String(materialMap.get(selectedMaterialId)?.base_uom_code ?? "KG");
      const fgDocId = (await resolveStockDocumentIdsByLedgerIds([toTrimmedString(poData.fg_stock_ledger_id)])).get(toTrimmedString(poData.fg_stock_ledger_id)) ?? null;

      // DEPENDENT: all postings share this brand-new document_number — see
      // finalizePackingOrderHandler's own comment for why this must be
      // sequential (post_stock_movement()'s item_number lock has nothing to
      // lock on the first-ever posting for a document_number).
      // Step 1: SFG P102 — dissolve reverse_qty out of S003.
      const step1 = await postStockMovement({
        documentNumber: docNumber, documentDate: today, postingDate: today,
        movementTypeCode: "P102", companyId, storageLocationId: sfgSlocId,
        materialId: selectedMaterialId, quantity: reverseQty, baseUomCode: sfgBaseUom, unitValue: 0,
        stockTypeCode: "UNRESTRICTED", direction: "OUT", postedBy, reversalOfId: fgDocId,
        batchNumber: String(poData.batch_number ?? ""),
      });
      lineInserts.push({
        line_type: "SFG", material_id: selectedMaterialId, formulation_material_id: null, included: true,
        qty: reverseQty, uom_code: sfgBaseUom, movement_type_code: "P102", direction: "OUT",
        storage_location_id: sfgSlocId, stock_ledger_id: step1.stock_ledger_id, display_order: 1,
      });

      // Step 2: RM/INT P262 — return proportionally to each material's own
      // original 261 issue location.
      const rmIntLines = await buildRmIntPreview(processOrderId, reversalRatio);
      const { data: polRows, error: polErr } = await serviceRoleClient
        .schema("erp_production")
        .from("process_order_line")
        .select("id, material_id, actual_material_id, issue_sloc_id, stock_ledger_id")
        .in("id", rmIntLines.map((l) => l.process_order_line_id));
      if (polErr) throw new Error("PR19_CREATE_FAILED");
      const polMap = new Map(((polRows ?? []) as JsonRecord[]).map((row) => [String(row.id), row]));
      const rmMaterialMap = await getMaterialMapByIds(rmIntLines.map((l) => l.material_id), "id, base_uom_code");
      const rmDocIdMap = await resolveStockDocumentIdsByLedgerIds(
        [...polMap.values()].map((row) => toTrimmedString(row.stock_ledger_id)),
      );

      let displayOrder = 2;
      for (const rmLine of rmIntLines) {
        if (rmLine.proportional_actual_qty <= 0) continue;
        const pol = polMap.get(rmLine.process_order_line_id);
        const slocId = toTrimmedString(pol?.issue_sloc_id);
        if (!slocId) throw new Error("PR19_LINE_SLOC_REQUIRED");
        const effectiveMaterialId = toTrimmedString(pol?.actual_material_id) || rmLine.material_id;
        const baseUom = String(rmMaterialMap.get(effectiveMaterialId)?.base_uom_code ?? "KG");
        const reversalOfId = rmDocIdMap.get(toTrimmedString(pol?.stock_ledger_id)) ?? null;
        if (!reversalOfId) throw new Error("PR19_REVERSAL_SOURCE_NOT_FOUND");

        const posting = await postStockMovement({
          documentNumber: docNumber, documentDate: today, postingDate: today,
          movementTypeCode: "P262", companyId, storageLocationId: slocId,
          materialId: effectiveMaterialId, quantity: rmLine.proportional_actual_qty, baseUomCode: baseUom, unitValue: 0,
          stockTypeCode: "UNRESTRICTED", direction: "IN", postedBy, reversalOfId,
          batchNumber: null,
        });
        lineInserts.push({
          line_type: rmLine.line_material_type, material_id: effectiveMaterialId, formulation_material_id: rmLine.material_id,
          included: true, qty: rmLine.proportional_actual_qty, uom_code: baseUom, movement_type_code: "P262", direction: "IN",
          storage_location_id: slocId, stock_ledger_id: posting.stock_ledger_id, display_order: displayOrder,
        });
        displayOrder += 1;
      }
    } else {
      // SKU row
      const { data: pkOrder, error: pkErr } = await serviceRoleClient
        .schema("erp_production")
        .from("packing_order")
        .select("id, material_id, actual_qty_kg, status, process_order_id")
        .eq("id", packingOrderId as string)
        .maybeSingle();
      if (pkErr) throw new Error("PR19_CREATE_FAILED");
      if (!pkOrder || (pkOrder as JsonRecord).status !== "FINAL" || String((pkOrder as JsonRecord).process_order_id ?? "") !== processOrderId) {
        return prErr(req, ctx, "PR19_PACKING_ORDER_NOT_FOUND", 404, "Packing PO not found, not FINAL, or does not belong to this batch");
      }
      const pkData = pkOrder as JsonRecord;
      const packingActualQty = Number(pkData.actual_qty_kg ?? 0);
      if (!packingActualQty) return prErr(req, ctx, "PR19_CREATE_FAILED", 422, "Packing PO has no actual output to derive a ratio from");

      const { data: fgLine, error: fgLineErr } = await serviceRoleClient
        .schema("erp_production")
        .from("packing_order_line")
        .select("id, material_id, issue_sloc_id, stock_ledger_id, uom_code")
        .eq("packing_order_id", packingOrderId as string)
        .eq("line_type", "FG")
        .maybeSingle();
      if (fgLineErr) throw new Error("PR19_CREATE_FAILED");
      const fgLineData = fgLine as JsonRecord | null;
      const fgSlocId = toTrimmedString(fgLineData?.issue_sloc_id);
      if (!fgLineData || !fgSlocId) return prErr(req, ctx, "PR19_CREATE_FAILED", 422, "Packing PO FG line missing storage location");

      const [ledgerQty, priorReversed] = await Promise.all([
        sumUnrestrictedLedgerQty(companyId, String(pkData.material_id ?? ""), fgSlocId, String(poData.batch_number ?? "")),
        sumPriorReversedQty("SKU", String(pkData.material_id ?? ""), fgSlocId, processOrderId, packingOrderId),
      ]);
      const availableQty = Math.max(0, ledgerQty - priorReversed);
      if (reverseQty > availableQty + 1e-6) {
        return prErr(req, ctx, "PR19_REVERSE_QTY_EXCEEDS_AVAILABLE", 422, `Reverse qty exceeds available (${availableQty})`);
      }

      selectedMaterialId = String(pkData.material_id ?? "");
      selectedStorageLocationId = fgSlocId;
      actualTotalOutput = packingActualQty;
      const sfgEquivalentQty = reverseQty;
      const ratioRm = sfgEquivalentQty / processOrderActualQty;
      const ratioPm = reverseQty / packingActualQty;
      reversalRatio = ratioPm;

      const { data: sfgLine, error: sfgLineErr } = await serviceRoleClient
        .schema("erp_production")
        .from("packing_order_line")
        .select("id, material_id, issue_sloc_id, stock_ledger_id, uom_code")
        .eq("packing_order_id", packingOrderId as string)
        .eq("line_type", "SFG")
        .maybeSingle();
      if (sfgLineErr) throw new Error("PR19_CREATE_FAILED");
      const sfgLineData = sfgLine as JsonRecord | null;
      const sfgLineSlocId = toTrimmedString(sfgLineData?.issue_sloc_id) || sfgSlocId;

      const materialMap = await getMaterialMapByIds(
        [selectedMaterialId, toTrimmedString(sfgLineData?.material_id) || String(poData.material_id ?? "")],
        "id, base_uom_code",
      );
      const fgBaseUom = String(materialMap.get(selectedMaterialId)?.base_uom_code ?? "KG");
      const sfgMaterialId = toTrimmedString(sfgLineData?.material_id) || String(poData.material_id ?? "");
      const sfgBaseUom = String(materialMap.get(sfgMaterialId)?.base_uom_code ?? "KG");

      const [fgDocIdMap, sfgDocIdMap] = await Promise.all([
        resolveStockDocumentIdsByLedgerIds([toTrimmedString(fgLineData?.stock_ledger_id)]),
        resolveStockDocumentIdsByLedgerIds([toTrimmedString(sfgLineData?.stock_ledger_id)]),
      ]);
      const fgDocId = fgDocIdMap.get(toTrimmedString(fgLineData?.stock_ledger_id)) ?? null;
      const sfgDocId = sfgDocIdMap.get(toTrimmedString(sfgLineData?.stock_ledger_id)) ?? null;
      if (!fgDocId || !sfgDocId) throw new Error("PR19_REVERSAL_SOURCE_NOT_FOUND");

      // DEPENDENT: see the SFG-row branch above for why this must stay
      // sequential — same brand-new-document_number item_number race.
      // Step 1: SKU/FG P102 — dissolve reverse_qty out of F003.
      const step1 = await postStockMovement({
        documentNumber: docNumber, documentDate: today, postingDate: today,
        movementTypeCode: "P102", companyId, storageLocationId: fgSlocId,
        materialId: selectedMaterialId, quantity: reverseQty, baseUomCode: fgBaseUom, unitValue: 0,
        stockTypeCode: "UNRESTRICTED", direction: "OUT", postedBy, reversalOfId: fgDocId,
        batchNumber: String(poData.batch_number ?? ""),
      });
      lineInserts.push({
        line_type: "SKU", material_id: selectedMaterialId, formulation_material_id: null, included: true,
        qty: reverseQty, uom_code: fgBaseUom, movement_type_code: "P102", direction: "OUT",
        storage_location_id: fgSlocId, stock_ledger_id: step1.stock_ledger_id, display_order: 1,
      });

      // Step 2: SFG P262 — reverses the original Packing-PO-Final P261,
      // brings the SFG back into existence at S003.
      const step2 = await postStockMovement({
        documentNumber: docNumber, documentDate: today, postingDate: today,
        movementTypeCode: "P262", companyId, storageLocationId: sfgLineSlocId,
        materialId: sfgMaterialId, quantity: sfgEquivalentQty, baseUomCode: sfgBaseUom, unitValue: 0,
        stockTypeCode: "UNRESTRICTED", direction: "IN", postedBy, reversalOfId: sfgDocId,
        batchNumber: String(poData.batch_number ?? ""),
      });
      lineInserts.push({
        line_type: "SFG", material_id: sfgMaterialId, formulation_material_id: null, included: true,
        qty: sfgEquivalentQty, uom_code: sfgBaseUom, movement_type_code: "P262", direction: "IN",
        storage_location_id: sfgLineSlocId, stock_ledger_id: step2.stock_ledger_id, display_order: 2,
      });

      // Step 3: SFG P261 again, immediately — this is the reversal's own
      // trace-down step into RM/INT, NOT the original packing consumption.
      // No reversalOfId: it's a fresh issue, net SFG balance across steps
      // 2+3 is unchanged but the ledger keeps two distinguishable entries.
      const step3 = await postStockMovement({
        documentNumber: docNumber, documentDate: today, postingDate: today,
        movementTypeCode: "P261", companyId, storageLocationId: sfgLineSlocId,
        materialId: sfgMaterialId, quantity: sfgEquivalentQty, baseUomCode: sfgBaseUom, unitValue: 0,
        stockTypeCode: "UNRESTRICTED", direction: "OUT", postedBy, reversalOfId: null,
        batchNumber: String(poData.batch_number ?? ""),
      });
      lineInserts.push({
        line_type: "SFG", material_id: sfgMaterialId, formulation_material_id: null, included: true,
        qty: sfgEquivalentQty, uom_code: sfgBaseUom, movement_type_code: "P261", direction: "OUT",
        storage_location_id: sfgLineSlocId, stock_ledger_id: step3.stock_ledger_id, display_order: 3,
      });

      // Step 4: RM/INT P262, proportional (from the original Process PO
      // batch's own Actual RM Ratio, ratioRm — batch-wide, not this one PO).
      const rmIntLines = await buildRmIntPreview(processOrderId, ratioRm);
      const { data: polRows, error: polErr } = await serviceRoleClient
        .schema("erp_production")
        .from("process_order_line")
        .select("id, material_id, actual_material_id, issue_sloc_id, stock_ledger_id")
        .in("id", rmIntLines.map((l) => l.process_order_line_id));
      if (polErr) throw new Error("PR19_CREATE_FAILED");
      const polMap = new Map(((polRows ?? []) as JsonRecord[]).map((row) => [String(row.id), row]));
      const rmMaterialMap = await getMaterialMapByIds(rmIntLines.map((l) => l.material_id), "id, base_uom_code");
      const rmDocIdMap = await resolveStockDocumentIdsByLedgerIds(
        [...polMap.values()].map((row) => toTrimmedString(row.stock_ledger_id)),
      );

      let displayOrder = 4;
      for (const rmLine of rmIntLines) {
        if (rmLine.proportional_actual_qty <= 0) continue;
        const pol = polMap.get(rmLine.process_order_line_id);
        const slocId = toTrimmedString(pol?.issue_sloc_id);
        if (!slocId) throw new Error("PR19_LINE_SLOC_REQUIRED");
        const effectiveMaterialId = toTrimmedString(pol?.actual_material_id) || rmLine.material_id;
        const baseUom = String(rmMaterialMap.get(effectiveMaterialId)?.base_uom_code ?? "KG");
        const reversalOfId = rmDocIdMap.get(toTrimmedString(pol?.stock_ledger_id)) ?? null;
        if (!reversalOfId) throw new Error("PR19_REVERSAL_SOURCE_NOT_FOUND");

        const posting = await postStockMovement({
          documentNumber: docNumber, documentDate: today, postingDate: today,
          movementTypeCode: "P262", companyId, storageLocationId: slocId,
          materialId: effectiveMaterialId, quantity: rmLine.proportional_actual_qty, baseUomCode: baseUom, unitValue: 0,
          stockTypeCode: "UNRESTRICTED", direction: "IN", postedBy, reversalOfId,
          batchNumber: null,
        });
        lineInserts.push({
          line_type: rmLine.line_material_type, material_id: effectiveMaterialId, formulation_material_id: rmLine.material_id,
          included: true, qty: rmLine.proportional_actual_qty, uom_code: baseUom, movement_type_code: "P262", direction: "IN",
          storage_location_id: slocId, stock_ledger_id: posting.stock_ledger_id, display_order: displayOrder,
        });
        displayOrder += 1;
      }

      // Step 5: PM P262, checkbox-checked lines only, proportional to ratioPm
      // (this specific Packing PO's own actual output). Excluded lines get
      // no movement — logged for audit with included=false.
      const { data: pmLines, error: pmErr } = await serviceRoleClient
        .schema("erp_production")
        .from("packing_order_line")
        .select("id, material_id, actual_material_id, total_qty, actual_qty, issue_sloc_id, stock_ledger_id")
        .eq("packing_order_id", packingOrderId as string)
        .eq("line_type", "PM");
      if (pmErr) throw new Error("PR19_CREATE_FAILED");
      const pmDocIdMap = await resolveStockDocumentIdsByLedgerIds(
        ((pmLines ?? []) as JsonRecord[]).map((row) => toTrimmedString(row.stock_ledger_id)),
      );
      const pmMaterialIds = ((pmLines ?? []) as JsonRecord[]).flatMap((row) => [
        toTrimmedString(row.actual_material_id) || String(row.material_id ?? ""),
      ]);
      const pmMaterialMap = await getMaterialMapByIds(pmMaterialIds, "id, base_uom_code");

      for (const pmLine of (pmLines ?? []) as JsonRecord[]) {
        const pmLineId = String(pmLine.id);
        const baseQty = Number(pmLine.actual_qty ?? pmLine.total_qty ?? 0);
        const proportionalQty = baseQty * ratioPm;
        const effectiveMaterialId = toTrimmedString(pmLine.actual_material_id) || String(pmLine.material_id ?? "");
        const included = !pmLineExclusions.has(pmLineId);

        if (!included || proportionalQty <= 0) {
          lineInserts.push({
            line_type: "PM", material_id: effectiveMaterialId, formulation_material_id: String(pmLine.material_id ?? ""),
            included: false, qty: proportionalQty, uom_code: String(pmMaterialMap.get(effectiveMaterialId)?.base_uom_code ?? "KG"),
            movement_type_code: null, direction: null, storage_location_id: toTrimmedString(pmLine.issue_sloc_id) || null,
            stock_ledger_id: null, display_order: displayOrder,
          });
          displayOrder += 1;
          continue;
        }

        const slocId = toTrimmedString(pmLine.issue_sloc_id);
        if (!slocId) throw new Error("PR19_LINE_SLOC_REQUIRED");
        const baseUom = String(pmMaterialMap.get(effectiveMaterialId)?.base_uom_code ?? "KG");
        const reversalOfId = pmDocIdMap.get(toTrimmedString(pmLine.stock_ledger_id)) ?? null;
        if (!reversalOfId) throw new Error("PR19_REVERSAL_SOURCE_NOT_FOUND");

        const posting = await postStockMovement({
          documentNumber: docNumber, documentDate: today, postingDate: today,
          movementTypeCode: "P262", companyId, storageLocationId: slocId,
          materialId: effectiveMaterialId, quantity: proportionalQty, baseUomCode: baseUom, unitValue: 0,
          stockTypeCode: "UNRESTRICTED", direction: "IN", postedBy, reversalOfId,
          batchNumber: null,
        });
        lineInserts.push({
          line_type: "PM", material_id: effectiveMaterialId, formulation_material_id: String(pmLine.material_id ?? ""),
          included: true, qty: proportionalQty, uom_code: baseUom, movement_type_code: "P262", direction: "IN",
          storage_location_id: slocId, stock_ledger_id: posting.stock_ledger_id, display_order: displayOrder,
        });
        displayOrder += 1;
      }
    }

    const { data: headerRow, error: headerErr } = await serviceRoleClient
      .schema("erp_production")
      .from("partial_batch_reversal")
      .insert({
        company_id: companyId,
        document_number: docNumber,
        po_type: String(poData.po_type ?? ""),
        prodshade_material_id: String(poData.material_id ?? ""),
        source_batch_number: String(poData.batch_number ?? ""),
        source_process_order_id: processOrderId,
        selected_row_type: rowType,
        selected_material_id: selectedMaterialId,
        selected_storage_location_id: selectedStorageLocationId,
        selected_packing_order_id: rowType === "SKU" ? packingOrderId : null,
        reverse_qty: reverseQty,
        actual_total_output: actualTotalOutput,
        reversal_ratio: reversalRatio,
        salvage_batch_number: salvageBatchNumber,
        salvage_process_order_id: salvageProcessOrderId,
        status: "POSTED",
        created_by: postedBy,
      })
      .select("id, document_number")
      .single();
    if (headerErr || !headerRow) {
      console.error("[partial_reversal.createPartialBatchReversalHandler] header insert failed:", JSON.stringify(headerErr));
      throw new Error("PR19_AUDIT_WRITE_FAILED");
    }
    const reversalId = String((headerRow as JsonRecord).id);

    if (lineInserts.length > 0) {
      const { error: linesErr } = await serviceRoleClient
        .schema("erp_production")
        .from("partial_batch_reversal_line")
        .insert(lineInserts.map((line) => ({ ...line, reversal_id: reversalId })));
      if (linesErr) {
        console.error("[partial_reversal.createPartialBatchReversalHandler] line insert failed:", JSON.stringify(linesErr));
        throw new Error("PR19_AUDIT_WRITE_FAILED");
      }
    }

    return okResponse({
      data: {
        id: reversalId,
        document_number: docNumber,
        row_type: rowType,
        reverse_qty: reverseQty,
        reversal_ratio: reversalRatio,
        line_count: lineInserts.length,
      },
    }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PR19_CREATE_FAILED";
    return prErr(req, ctx, code,
      code === "PR19_INVALID" ? 400
        : (code === "PR19_REVERSE_QTY_EXCEEDS_AVAILABLE" || code === "PR19_SALVAGE_BATCH_INVALID") ? 422
        : code.endsWith("_NOT_FOUND") ? 404
        : 500,
      "Partial batch reversal failed");
  }
}

// GET /api/production/partial-reversals?company_id=&po_type=&prodshade_material_id=&batch_number=
// PR20 — collapsed list (CSN-tracker style). Filters optional; company_id
// required for scoping.
export async function listPartialBatchReversalsHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const url = new URL(req.url);
    const companyId = toTrimmedString(url.searchParams.get("company_id") ?? "");
    const poType = toUpperTrimmedString(url.searchParams.get("po_type") ?? "");
    const prodshadeMaterialId = toTrimmedString(url.searchParams.get("prodshade_material_id") ?? "");
    const batchNumber = toTrimmedString(url.searchParams.get("batch_number") ?? "");
    if (!companyId) return prErr(req, ctx, "PR20_INVALID", 400, "company_id required");
    await assertPartialReversalCompanyScope(ctx, companyId);

    let query = serviceRoleClient
      .schema("erp_production")
      .from("partial_batch_reversal")
      .select(
        "id, document_number, po_type, prodshade_material_id, source_batch_number, source_process_order_id, " +
        "selected_row_type, selected_material_id, selected_storage_location_id, selected_packing_order_id, " +
        "reverse_qty, actual_total_output, reversal_ratio, salvage_batch_number, salvage_process_order_id, " +
        "status, created_by, created_at",
      )
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });
    if (VALID_PO_TYPES.has(poType)) query = query.eq("po_type", poType);
    if (prodshadeMaterialId) query = query.eq("prodshade_material_id", prodshadeMaterialId);
    if (batchNumber) query = query.eq("source_batch_number", batchNumber);

    const { data, error } = await query;
    if (error) {
      console.error("[partial_reversal.listPartialBatchReversalsHandler] query failed:", JSON.stringify(error));
      throw new Error("PR20_LIST_FAILED");
    }
    const rows = (data ?? []) as JsonRecord[];

    const materialIds = rows.flatMap((r) => [String(r.prodshade_material_id ?? ""), String(r.selected_material_id ?? "")]);
    const slocIds = rows.map((r) => String(r.selected_storage_location_id ?? ""));
    const poIds = rows.map((r) => String(r.selected_packing_order_id ?? "")).filter(Boolean);
    const userIds = rows.map((r) => String(r.created_by ?? "")).filter(Boolean);

    const [materialMap, slocMap, packingOrderMap, userDisplayMap] = await Promise.all([
      getMaterialMapByIds(materialIds, "id, pace_code, material_name, external_code, shade_code"),
      getStorageLocationMapByIds(slocIds),
      poIds.length > 0
        ? serviceRoleClient.schema("erp_production").from("packing_order").select("id, po_number").in("id", poIds)
          .then(({ data: d }) => new Map(((d ?? []) as JsonRecord[]).map((r) => [String(r.id), r])))
        : Promise.resolve(new Map<string, JsonRecord>()),
      resolveUserDisplayNames(userIds),
    ]);

    const data_ = rows.map((r) => ({
      ...r,
      prodshade_material: materialMap.get(String(r.prodshade_material_id ?? "")) ?? null,
      selected_material: materialMap.get(String(r.selected_material_id ?? "")) ?? null,
      selected_storage_location: slocMap.get(String(r.selected_storage_location_id ?? "")) ?? null,
      selected_packing_order: packingOrderMap.get(String(r.selected_packing_order_id ?? "")) ?? null,
      created_by_display: userDisplayMap.get(String(r.created_by ?? "")) ?? null,
    }));

    return okResponse({ data: data_ }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PR20_LIST_FAILED";
    return prErr(req, ctx, code, code === "PR20_INVALID" ? 400 : (code === "PR19_SCOPE_VIOLATION" ? 403 : 500), "Partial reversal list failed");
  }
}

// GET /api/production/partial-reversals/:id
// PR20 — expanded row detail: full granular line-level breakdown.
export async function getPartialBatchReversalHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const id = getIdFromPath(req);
    if (!id) return prErr(req, ctx, "PR20_INVALID", 400, "id required");

    const { data: header, error: headerErr } = await serviceRoleClient
      .schema("erp_production")
      .from("partial_batch_reversal")
      .select(
        "id, company_id, document_number, po_type, prodshade_material_id, source_batch_number, source_process_order_id, " +
        "selected_row_type, selected_material_id, selected_storage_location_id, selected_packing_order_id, " +
        "reverse_qty, actual_total_output, reversal_ratio, salvage_batch_number, salvage_process_order_id, " +
        "status, created_by, created_at",
      )
      .eq("id", id)
      .maybeSingle();
    if (headerErr) throw new Error("PR20_DETAIL_FAILED");
    if (!header) return prErr(req, ctx, "PR20_NOT_FOUND", 404, "Partial batch reversal not found");
    const headerData = header as JsonRecord;
    await assertPartialReversalCompanyScope(ctx, String(headerData.company_id ?? ""));

    const { data: lines, error: linesErr } = await serviceRoleClient
      .schema("erp_production")
      .from("partial_batch_reversal_line")
      .select("id, line_type, material_id, formulation_material_id, included, qty, uom_code, movement_type_code, direction, storage_location_id, stock_ledger_id, display_order")
      .eq("reversal_id", id)
      .order("display_order", { ascending: true });
    if (linesErr) throw new Error("PR20_DETAIL_FAILED");
    const lineRows = (lines ?? []) as JsonRecord[];

    const materialIds = [
      String(headerData.prodshade_material_id ?? ""), String(headerData.selected_material_id ?? ""),
      ...lineRows.flatMap((l) => [String(l.material_id ?? ""), String(l.formulation_material_id ?? "")]),
    ];
    const slocIds = [String(headerData.selected_storage_location_id ?? ""), ...lineRows.map((l) => String(l.storage_location_id ?? ""))];
    const packingOrderId = toTrimmedString(headerData.selected_packing_order_id);
    const salvageProcessOrderId = toTrimmedString(headerData.salvage_process_order_id);
    const creatorId = toTrimmedString(headerData.created_by);

    const [materialMap, slocMap, packingOrderMap, salvageMap, userDisplayMap, sourcePo] = await Promise.all([
      getMaterialMapByIds(materialIds, "id, pace_code, material_name, external_code, shade_code, base_uom_code"),
      getStorageLocationMapByIds(slocIds),
      packingOrderId
        ? serviceRoleClient.schema("erp_production").from("packing_order").select("id, po_number").eq("id", packingOrderId).maybeSingle()
          .then(({ data: d }) => (d as JsonRecord | null))
        : Promise.resolve(null),
      salvageProcessOrderId
        ? serviceRoleClient.schema("erp_production").from("process_order").select("id, po_number, batch_number").eq("id", salvageProcessOrderId).maybeSingle()
          .then(({ data: d }) => (d as JsonRecord | null))
        : Promise.resolve(null),
      resolveUserDisplayNames(creatorId ? [creatorId] : []),
      serviceRoleClient.schema("erp_production").from("process_order").select("id, po_number, batch_number")
        .eq("id", String(headerData.source_process_order_id ?? "")).maybeSingle()
        .then(({ data: d }) => (d as JsonRecord | null)),
    ]);

    return okResponse({
      data: {
        ...headerData,
        prodshade_material: materialMap.get(String(headerData.prodshade_material_id ?? "")) ?? null,
        selected_material: materialMap.get(String(headerData.selected_material_id ?? "")) ?? null,
        selected_storage_location: slocMap.get(String(headerData.selected_storage_location_id ?? "")) ?? null,
        selected_packing_order: packingOrderMap,
        salvage_process_order: salvageMap,
        source_process_order: sourcePo,
        created_by_display: creatorId ? userDisplayMap.get(creatorId) ?? null : null,
        lines: lineRows.map((l) => ({
          ...l,
          material: materialMap.get(String(l.material_id ?? "")) ?? null,
          formulation_material: l.formulation_material_id ? materialMap.get(String(l.formulation_material_id ?? "")) ?? null : null,
          storage_location: l.storage_location_id ? slocMap.get(String(l.storage_location_id ?? "")) ?? null : null,
        })),
      },
    }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PR20_DETAIL_FAILED";
    return prErr(req, ctx, code, code === "PR20_INVALID" ? 400 : (code === "PR20_NOT_FOUND" ? 404 : (code === "PR19_SCOPE_VIOLATION" ? 403 : 500)), "Partial reversal detail failed");
  }
}
