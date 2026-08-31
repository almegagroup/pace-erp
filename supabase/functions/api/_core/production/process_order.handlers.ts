/*
 * File-ID: 27.6
 * File-Path: supabase/functions/api/_core/production/process_order.handlers.ts
 * Gate: 27
 * Phase: 27
 * Domain: PRODUCTION
 * Purpose: Process Order full lifecycle - STANDARD -> QA_APPROVED -> BATCH_STARTED -> FINAL -> VERIFIED.
 *          Stock movements (P261 RM/PM out + P101 FG in + P321 auto-release) fire at VERIFIED.
 * Authority: Backend
 * DB column names: material_id, planned_qty, actual_qty, qa_decided_by/at, issue_sloc_id
 */

import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { todayIsoInKolkata } from "../../_shared/dateUtils.ts";
import { isManualDocumentDateWithinPastWindow, MANUAL_PAST_DATE_WINDOW_MESSAGE } from "../../_shared/manualDocumentDateWindow.ts";
import { generateMaterialDocNumber, generateRecoDocNumber } from "../../_shared/materialDocument.ts";
import type { MaterialDocumentRef } from "../../_shared/materialDocument.ts";
import { resolveUserDisplayNames } from "../../_shared/resolveUserDisplayNames.ts";
import { assertCompanyScope } from "../../_shared/companyScope.ts";
import { canMaintainCompanyResource } from "../../_shared/companyResourceAccess.ts";
import { okResponse, errorResponse } from "../response.ts";
import type { ProdHandlerContext } from "./production.shared.ts";
import {
  assertProdReadRole,
  parseBody,
  toTrimmedString,
  toUpperTrimmedString,
  parsePositiveNumber,
  parseNonNegativeNumber,
  getIdFromPath,
} from "./production.shared.ts";
import {
  activateReleasedBatchNumberInstance,
  findReleasedBatchNumberInstances,
  generateBatchNumber,
  upsertBatchNumberInstanceForProcessOrder,
} from "./batch_series.handlers.ts";
import { generateGlobalDocNumber } from "./production.utils.ts";

type JsonRecord = Record<string, unknown>;
type StockPostingResult = { stock_document_id: string; stock_ledger_id: string };
type AvailabilityNeed = { materialId: string; storageLocationId: string; qty: number };
type AvailabilityRow = {
  material_id: string;
  storage_location_id: string;
  needed_qty: number;
  available_qty: number;
  short: boolean;
};

const VALID_PO_TYPES = new Set(["MTO", "HPS", "MTS", "INT", "MTEST"]);
const VALID_SEGMENTS = new Set(["ADMIX", "HPS", "IWC", "POWDER", "INT"]);
const REQUIRED_MACHINE_TYPES = new Set(["MTO", "HPS", "MTS", "INT"]);
const RESERVATION_OPEN_STATUSES = ["OPEN", "PARTIAL"];
const RESERVATION_ACTIVE_STATUSES = ["OPEN", "PARTIAL", "FULLY_ISSUED"];
const EPSILON = 0.0001;

function todayIso(): string {
  return todayIsoInKolkata();
}

function poErr(req: Request, ctx: ProdHandlerContext, code: string, status: number, msg: string): Response {
  return errorResponse(code, msg, ctx.request_id, "NONE", status, {}, req);
}

function createdOkResponse(data: unknown, requestId: string, req?: Request): Response {
  const response = okResponse(data, requestId, req);
  return new Response(response.body, { status: 201, headers: response.headers });
}

function qtysEffectivelyMatch(a: number | null, b: number | null): boolean {
  const left = Number(a ?? 0);
  const right = Number(b ?? 0);
  return Math.abs(left - right) < EPSILON;
}

async function getMaterialMapByIds(
  materialIds: string[],
  logPrefix: string,
  errorCode: string,
  selectColumns: string,
): Promise<Map<string, JsonRecord>> {
  const matIds = [...new Set(materialIds.filter(Boolean))];
  const matMap = new Map<string, JsonRecord>();
  if (matIds.length === 0) return matMap;

  const { data: mats, error: matErr } = await serviceRoleClient
    .schema("erp_master")
    .from("material_master")
    .select(selectColumns)
    .in("id", matIds);
  if (matErr) {
    console.error(`${logPrefix} material query failed:`, JSON.stringify(matErr));
    throw new Error(errorCode);
  }

  for (const mat of (mats ?? []) as JsonRecord[]) {
    matMap.set(String(mat.id), mat);
  }
  return matMap;
}

async function getStorageLocationMapByIds(
  storageLocationIds: string[],
  logPrefix: string,
  errorCode: string,
): Promise<Map<string, JsonRecord>> {
  const ids = [...new Set(storageLocationIds.filter(Boolean))];
  const slocMap = new Map<string, JsonRecord>();
  if (ids.length === 0) return slocMap;

  const { data, error } = await serviceRoleClient
    .schema("erp_inventory")
    .from("storage_location_master")
    .select("id, code, name")
    .in("id", ids);
  if (error) {
    console.error(`${logPrefix} storage location query failed:`, JSON.stringify(error));
    throw new Error(errorCode);
  }

  for (const row of (data ?? []) as JsonRecord[]) {
    slocMap.set(String(row.id), row);
  }
  return slocMap;
}

async function getMaterialGroupMemberIdsByGroupIds(
  groupIds: string[],
  logPrefix: string,
  errorCode: string,
): Promise<Map<string, string[]>> {
  const ids = [...new Set(groupIds.filter(Boolean))];
  const memberMap = new Map<string, string[]>();
  if (ids.length === 0) return memberMap;

  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("material_category_group_member")
    .select("group_id, material_id")
    .in("group_id", ids);
  if (error) {
    console.error(`${logPrefix} material-group-member query failed:`, JSON.stringify(error));
    throw new Error(errorCode);
  }

  for (const row of (data ?? []) as JsonRecord[]) {
    const groupId = String(row.group_id ?? "");
    const materialId = toTrimmedString(row.material_id);
    if (!groupId || !materialId) continue;
    const existing = memberMap.get(groupId) ?? [];
    existing.push(materialId);
    memberMap.set(groupId, existing);
  }
  return memberMap;
}

async function fetchProcessOrder(id: string): Promise<JsonRecord | null> {
  const { data, error } = await serviceRoleClient
    .schema("erp_production")
    .from("process_order")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("[process_order.fetchProcessOrder] query failed:", JSON.stringify(error));
    throw new Error("PROD_PO_FETCH_FAILED");
  }
  return (data as JsonRecord | null) ?? null;
}

async function fetchMachine(companyId: string, machineId: string): Promise<JsonRecord | null> {
  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("machine_master")
    .select("id, company_id, machine_code, machine_name, active, capacity_per_batch, capacity_uom_code")
    .eq("id", machineId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) {
    console.error("[process_order.fetchMachine] query failed:", JSON.stringify(error));
    throw new Error("PROD_PO_MACHINE_INVALID");
  }
  return (data as JsonRecord | null) ?? null;
}

const KG_UOM_CODES = new Set(["KG", "KGS", "KILOGRAM", "KILOGRAMS"]);
const LITRE_UOM_CODES = new Set(["L", "LT", "LTR", "LITRE", "LITRES"]);
const MACHINE_CAPACITY_TOLERANCE = 1.1;

function resolveMachineCapacityKg(machine: JsonRecord, stroke: JsonRecord): number | null {
  const capacity = Number(machine.capacity_per_batch ?? 0);
  const capacityUom = toUpperTrimmedString(machine.capacity_uom_code);
  if (!Number.isFinite(capacity) || capacity <= 0 || !capacityUom) return null;
  if (KG_UOM_CODES.has(capacityUom)) return capacity;
  if (LITRE_UOM_CODES.has(capacityUom)) {
    const factor = Number(stroke.conversion_factor ?? 0);
    return Number.isFinite(factor) && factor > 0 ? capacity * factor : null;
  }
  return null;
}

async function validateRequiredMachine(
  req: Request,
  ctx: ProdHandlerContext,
  companyId: string,
  poType: string,
  machineId: string | null,
): Promise<Response | null> {
  if (!REQUIRED_MACHINE_TYPES.has(poType)) return null;
  if (!machineId) {
    return poErr(req, ctx, "PROD_PO_MACHINE_REQUIRED", 400, "machine_id required for this PO type");
  }
  const machine = await fetchMachine(companyId, machineId);
  if (!machine || machine.active !== true) {
    return poErr(req, ctx, "PROD_PO_MACHINE_INVALID", 422, "machine_id must belong to the company and be active");
  }
  return null;
}

async function fetchStrokeAlternates(strokeMasterId: string | null): Promise<Map<string, JsonRecord>> {
  const result = new Map<string, JsonRecord>();
  if (!strokeMasterId) return result;
  const { data, error } = await serviceRoleClient
    .schema("erp_production")
    .from("stroke_line")
    .select("material_id, alternate_material_id, material_group_id, dosage_pct")
    .eq("stroke_master_id", strokeMasterId);
  if (error) {
    console.error("[process_order.fetchStrokeAlternates] query failed:", JSON.stringify(error));
    throw new Error("PROD_PO_FETCH_FAILED");
  }
  for (const row of (data ?? []) as JsonRecord[]) {
    result.set(String(row.material_id), row);
  }
  return result;
}

async function fetchAllowedAlternateIdsByStroke(
  strokeMasterId: string | null,
  logPrefix: string,
  errorCode: string,
): Promise<Map<string, string[]>> {
  if (!strokeMasterId) return new Map<string, string[]>();
  const { data, error } = await serviceRoleClient
    .schema("erp_production")
    .from("stroke_line")
    .select("material_id, alternate_material_id, material_group_id")
    .eq("stroke_master_id", strokeMasterId);
  if (error) {
    console.error(`${logPrefix} stroke-line alternate query failed:`, JSON.stringify(error));
    throw new Error(errorCode);
  }
  return buildAllowedAlternateIdsByStrokeLines((data ?? []) as JsonRecord[], logPrefix, errorCode);
}

async function buildAllowedAlternateIdsByStrokeLines(
  strokeLines: JsonRecord[],
  logPrefix: string,
  errorCode: string,
): Promise<Map<string, string[]>> {
  const groupMemberMap = await getMaterialGroupMemberIdsByGroupIds(
    strokeLines.map((line) => String(line.material_group_id ?? "")),
    logPrefix,
    errorCode,
  );

  const allowedMap = new Map<string, string[]>();
  for (const strokeLine of strokeLines) {
    const formulationMaterialId = String(strokeLine.material_id ?? "");
    if (!formulationMaterialId) continue;

    const allowedIds = new Set<string>();
    const directAlternateId = toTrimmedString(strokeLine.alternate_material_id);
    if (directAlternateId) allowedIds.add(directAlternateId);

    const groupId = String(strokeLine.material_group_id ?? "");
    for (const memberId of groupMemberMap.get(groupId) ?? []) {
      if (memberId && memberId !== formulationMaterialId) allowedIds.add(memberId);
    }

    allowedMap.set(formulationMaterialId, Array.from(allowedIds));
  }
  return allowedMap;
}

async function fetchOrderLines(orderId: string, strokeMasterId: string | null = null): Promise<JsonRecord[]> {
  const { data, error } = await serviceRoleClient
    .schema("erp_production")
    .from("process_order_line")
    .select(`
      id, process_order_id, material_id, planned_qty, actual_qty, uom_code,
      issue_sloc_id, is_rm, display_order, stock_ledger_id,
      actual_material_id, dosage_pct, is_formulation_line,
      approved_status, ap_approved_qty, variance_qty
    `)
    .eq("process_order_id", orderId)
    .order("display_order");
  if (error) {
    console.error("[process_order.fetchOrderLines] line query failed:", JSON.stringify(error));
    throw new Error("PROD_PO_FETCH_FAILED");
  }

  const lines = (data ?? []) as JsonRecord[];
  const [alternateMap, allowedAlternateMap] = await Promise.all([
    fetchStrokeAlternates(strokeMasterId),
    fetchAllowedAlternateIdsByStroke(
      strokeMasterId,
      "[process_order.fetchOrderLines]",
      "PROD_PO_FETCH_FAILED",
    ),
  ]);
  const materialIds = [
    ...lines.map((line) => String(line.material_id ?? "")),
    ...lines.map((line) => String(line.actual_material_id ?? "")),
    ...Array.from(allowedAlternateMap.values()).flat(),
  ];
  const slocIds = lines.map((line) => String(line.issue_sloc_id ?? ""));

  const [materialMap, slocMap] = await Promise.all([
    getMaterialMapByIds(
      materialIds,
      "[process_order.fetchOrderLines]",
      "PROD_PO_FETCH_FAILED",
      "id, pace_code, material_name, base_uom_code, material_type, shade_code",
    ),
    getStorageLocationMapByIds(
      slocIds,
      "[process_order.fetchOrderLines]",
      "PROD_PO_FETCH_FAILED",
    ),
  ]);

  return lines.map((line) => {
    const alternate = alternateMap.get(String(line.material_id ?? "")) ?? null;
    const alternateMaterialId = toTrimmedString(alternate?.alternate_material_id);
    const allowedAlternateIds = allowedAlternateMap.get(String(line.material_id ?? "")) ?? [];
    return {
      ...line,
      dosage_pct: line.dosage_pct ?? alternate?.dosage_pct ?? null,
      material: materialMap.get(String(line.material_id ?? "")) ?? null,
      actual_material: materialMap.get(String(line.actual_material_id ?? "")) ?? null,
      registered_alternate_material_id: alternateMaterialId || null,
      registered_alternate_material: alternateMaterialId
        ? materialMap.get(alternateMaterialId) ?? null
        : null,
      allowed_alternate_material_ids: allowedAlternateIds,
      allowed_alternate_materials: allowedAlternateIds
        .map((materialId) => materialMap.get(materialId) ?? null)
        .filter(Boolean),
      issue_storage_location: slocMap.get(String(line.issue_sloc_id ?? "")) ?? null,
    };
  });
}

async function fetchReservationRowsBySourceLineIds(sourceLineIds: string[]): Promise<Map<string, JsonRecord>> {
  const ids = [...new Set(sourceLineIds.filter(Boolean))];
  const reservationMap = new Map<string, JsonRecord>();
  if (ids.length === 0) return reservationMap;

  const { data, error } = await serviceRoleClient
    .schema("erp_production")
    .from("reservation_document")
    .select("id, source_line_id, material_id, required_qty, issued_qty, balance_qty, status, storage_location_id, uom_code")
    .in("source_line_id", ids)
    .in("status", RESERVATION_ACTIVE_STATUSES);
  if (error) {
    console.error("[process_order.fetchReservationRowsBySourceLineIds] query failed:", JSON.stringify(error));
    throw new Error("PROD_PO_FETCH_FAILED");
  }

  for (const row of (data ?? []) as JsonRecord[]) {
    reservationMap.set(String(row.source_line_id), row);
  }
  return reservationMap;
}

async function cancelOpenReservationsForProcessOrder(id: string, userId: string, now: string): Promise<void> {
  const { error } = await serviceRoleClient
    .schema("erp_production")
    .from("reservation_document")
    .update({
      status: "CANCELLED",
      last_updated_by: userId,
      last_updated_at: now,
    })
    .eq("source_type", "PROCESS_PO")
    .eq("source_id", id)
    .in("status", RESERVATION_OPEN_STATUSES);
  if (error) {
    console.error("[process_order.cancelOpenReservationsForProcessOrder] update failed:", JSON.stringify(error));
    throw new Error("PROD_PO_RESERVATION_UPDATE_FAILED");
  }
}

// Found live 2026-08-11/12: this was named "reset" and set status back to "OPEN" —
// but its only two callers are both inside reverseProcessOrderHandler, where the PO
// is being permanently killed (REVERSED can never return to STANDARD, per §83.4 lock).
// Resetting to "OPEN" left the reservation counted forever in
// RESERVATION_OPEN_STATUSES-based availability checks (computePhysicalAvailabilityRows,
// checkStockAvailability) even though the PO that made it will never draw the material —
// permanently locking real stock away from every other order. "CANCELLED" already exists
// in the reservation_document status CHECK constraint and is exactly what
// reversePackingOrderHandler's own sibling cancellation already uses — this now matches
// that pattern instead of silently reopening a dead hold. issued_qty is left as-is
// (not zeroed) so a fully-issued reservation's history stays visible after cancel, same
// as the Packing PO side.
async function cancelReservationsForProcessOrder(id: string, userId: string, now: string): Promise<void> {
  const { error } = await serviceRoleClient
    .schema("erp_production")
    .from("reservation_document")
    .update({
      status: "CANCELLED",
      last_updated_by: userId,
      last_updated_at: now,
    })
    .eq("source_type", "PROCESS_PO")
    .eq("source_id", id)
    .in("status", RESERVATION_ACTIVE_STATUSES);
  if (error) {
    console.error("[process_order.cancelReservationsForProcessOrder] update failed:", JSON.stringify(error));
    throw new Error("PROD_PO_RESERVATION_UPDATE_FAILED");
  }
}

async function resolveOutputStorageLocationId(strokeMasterId: string | null, poType: string | null): Promise<string | null> {
  if (!strokeMasterId) return null;
  const targetPoType = toUpperTrimmedString(poType);
  if (["MTO", "HPS", "MTS", "MTEST"].includes(targetPoType)) {
    const { data: applicability, error: applicabilityError } = await serviceRoleClient
      .schema("erp_production")
      .from("stroke_po_type_applicability")
      .select("default_storage_location_id")
      .eq("stroke_master_id", strokeMasterId)
      .eq("target_po_type", targetPoType)
      .eq("is_active", true)
      .maybeSingle();
    if (applicabilityError) {
      console.error("[process_order.resolveOutputStorageLocationId] applicability query failed:", JSON.stringify(applicabilityError));
      throw new Error("PROD_PO_FETCH_FAILED");
    }
    const targetStorageLocationId = toTrimmedString((applicability as JsonRecord | null)?.default_storage_location_id);
    if (targetStorageLocationId) return targetStorageLocationId;
  }
  const { data, error } = await serviceRoleClient
    .schema("erp_production")
    .from("stroke_master")
    .select("default_storage_location_id")
    .eq("id", strokeMasterId)
    .maybeSingle();
  if (error) {
    console.error("[process_order.resolveOutputStorageLocationId] stroke query failed:", JSON.stringify(error));
    throw new Error("PROD_PO_FETCH_FAILED");
  }
  return toTrimmedString((data as JsonRecord | null)?.default_storage_location_id) || null;
}

async function postStockMovement(params: {
  documentNumber: string;
  documentDate: string;
  postingDate: string;
  movementTypeCode: string;
  companyId: unknown;
  storageLocationId: unknown;
  materialId: unknown;
  quantity: number;
  baseUomCode: string;
  unitValue: number;
  stockTypeCode: string;
  direction: "IN" | "OUT";
  postedBy: string;
  reversalOfId?: string | null;
  batchNumber?: string | null;
  // §106: Material Document identity (MBLNR+MJAHR) for the posting event; the Process PO
  // number (documentNumber) is carried as the reference.
  matDoc?: MaterialDocumentRef;
  referenceDocumentId?: string | null;
}): Promise<StockPostingResult> {
  const { data, error } = await serviceRoleClient
    .schema("erp_inventory")
    .rpc("post_stock_movement", {
      p_document_number: params.documentNumber,
      p_document_date: params.documentDate,
      p_posting_date: params.postingDate,
      p_movement_type_code: params.movementTypeCode,
      p_company_id: params.companyId,
      p_storage_location_id: params.storageLocationId,
      p_material_id: params.materialId,
      p_quantity: params.quantity,
      p_base_uom_code: params.baseUomCode,
      p_unit_value: params.unitValue,
      p_stock_type_code: params.stockTypeCode,
      p_direction: params.direction,
      p_posted_by: params.postedBy,
      p_reversal_of_id: params.reversalOfId ?? null,
      p_batch_number: params.batchNumber ?? null,
      p_material_doc_number: params.matDoc?.docNumber ?? null,
      p_material_doc_year: params.matDoc?.docYear ?? null,
      p_reference_document_number: params.matDoc ? params.documentNumber : null,
      p_reference_document_type: params.matDoc ? "PROC_PO" : null,
      p_reference_document_id: params.referenceDocumentId ?? null,
    });
  if (error || !Array.isArray(data) || data.length === 0) {
    console.error("[process_order.postStockMovement] rpc failed:", JSON.stringify(error));
    // Found live 2026-08-12 (same gap fixed in packing_order.handlers.ts): surface the
    // real DB-raised reason (e.g. "INSUFFICIENT_STOCK") instead of a bare, opaque code.
    const dbReason = toTrimmedString((error as { message?: string } | null)?.message);
    const reason = dbReason === "INSUFFICIENT_STOCK"
      ? "insufficient UNRESTRICTED stock for this material/location/company"
      : dbReason || "unknown error";
    throw new Error(`PROD_STOCK_POST_FAILED: ${params.movementTypeCode} ${params.direction} (${reason})`);
  }
  return data[0] as StockPostingResult;
}

type MovementSpec = Record<string, unknown>;

type DocumentPosting = {
  line_ref: string;
  stock_document_id: string;
  stock_ledger_id: string;
  valuation_rate: number | null;
};

/*
 * Takes the SAME argument shape as postStockMovement, but builds an entry for
 * erp_inventory.post_document instead of posting straight away. Keeping the shapes
 * identical is deliberate: migrating a call site is then a one-line change, and the
 * two cannot drift apart into subtly different parameter sets.
 *
 * `lineRef` is how the returned stock_ledger_id finds its way back to the right
 * business row — a process_order_line id for RM/PM lines, or one of the fixed
 * labels FG / QI_OUT / QI_RELEASE that complete_process_po_verify looks for.
 */
function toMovement(params: Parameters<typeof postStockMovement>[0], lineRef: string): MovementSpec {
  return {
    line_ref: lineRef,
    document_number: params.documentNumber,
    document_date: params.documentDate,
    posting_date: params.postingDate,
    movement_type_code: params.movementTypeCode,
    company_id: params.companyId,
    storage_location_id: params.storageLocationId,
    material_id: params.materialId,
    quantity: params.quantity,
    base_uom_code: params.baseUomCode,
    unit_value: params.unitValue,
    stock_type_code: params.stockTypeCode,
    direction: params.direction,
    reversal_of_id: params.reversalOfId ?? null,
    batch_number: params.batchNumber ?? null,
    material_doc_number: params.matDoc?.docNumber ?? null,
    material_doc_year: params.matDoc?.docYear ?? null,
    reference_document_number: params.matDoc ? params.documentNumber : null,
  };
}

/*
 * One round trip, one transaction (CLAUDE.md 8D, feasibility §107.8). Every movement
 * plus the source's registered completion function run together — any failure rolls
 * back all of it, so a half-posted document is no longer possible.
 */
async function postDocument(args: {
  referenceDocumentType: string;
  referenceDocumentId: string;
  movements: MovementSpec[];
  postedBy: string;
  context: Record<string, unknown>;
}): Promise<DocumentPosting[]> {
  const { data, error } = await serviceRoleClient
    .schema("erp_inventory")
    .rpc("post_document", {
      p_reference_document_type: args.referenceDocumentType,
      p_reference_document_id: args.referenceDocumentId,
      p_movements: args.movements,
      p_posted_by: args.postedBy,
      p_context: args.context,
    });
  if (error) {
    console.error("[process_order.postDocument] rpc failed:", JSON.stringify(error));
    throw new Error("PROD_PO_VERIFY_FAILED");
  }
  const postings = (data as { postings?: unknown } | null)?.postings;
  return (Array.isArray(postings) ? postings : []) as DocumentPosting[];
}

// §104: current UNRESTRICTED valuation rate for a set of (material, storage_location)
// pairs, so RM/INT issues can post at their real cost (not 0) and roll up into the SFG
// cost. Batched read (one query), keyed `${materialId}|${slocId}`; 0 when not yet valued.
async function fetchUnrestrictedRates(
  companyId: string,
  keys: Array<{ materialId: string; slocId: string }>,
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const pairs = keys.filter((k) => k.materialId && k.slocId);
  if (pairs.length === 0) return map;
  const materialIds = [...new Set(pairs.map((p) => p.materialId))];
  const slocIds = [...new Set(pairs.map((p) => p.slocId))];
  const { data, error } = await serviceRoleClient
    .schema("erp_inventory")
    .from("stock_snapshot")
    .select("material_id, storage_location_id, valuation_rate")
    .eq("company_id", companyId)
    .eq("stock_type_code", "UNRESTRICTED")
    .is("batch_id", null)
    .in("material_id", materialIds)
    .in("storage_location_id", slocIds);
  if (error) {
    console.error("[process_order.fetchUnrestrictedRates] query failed:", JSON.stringify(error));
    throw new Error("PROD_PO_RATE_LOOKUP_FAILED");
  }
  for (const row of (data ?? []) as JsonRecord[]) {
    map.set(`${String(row.material_id)}|${String(row.storage_location_id)}`, Number(row.valuation_rate ?? 0));
  }
  return map;
}

// §104.8: resolve the per-KG conversion rate for (company, segment, prodshade, posting date).
// Returns null when none is configured for that date — caller HARD-BLOCKS the posting.
async function resolveConversionRate(
  companyId: string,
  segmentCode: string,
  prodshadeMaterialId: string,
  postingDate: string,
): Promise<number | null> {
  const { data, error } = await serviceRoleClient
    .schema("erp_production")
    .rpc("resolve_conversion_rate", {
      p_company_id: companyId,
      p_segment_code: segmentCode,
      p_prodshade_material_id: prodshadeMaterialId,
      p_posting_date: postingDate,
    });
  if (error) {
    console.error("[process_order.resolveConversionRate] rpc failed:", JSON.stringify(error));
    throw new Error("PROD_PO_CONVERSION_RESOLVE_FAILED");
  }
  return data === null || data === undefined ? null : Number(data);
}

// post_stock_movement()'s p_reversal_of_id references stock_document.id (FK
// stock_document_reversal_document_id_fkey), NOT stock_ledger.id — but every
// *_stock_ledger_id column on process_order/process_order_line stores the
// RPC's own stock_ledger_id return value. Passing that raw value as
// p_reversal_of_id violates the FK. Resolve first.
//
// §104.8: also returns each original leg's own posted valuation_rate. A CORS reversal
// must restore/remove the EXACT value the original leg posted at — post_stock_movement()
// does nothing special for p_reversal_of_id valuation-wise: an IN reversal (P262 RM/PM
// restore, P321 QI restore) recomputes the weighted average from p_unit_value, so posting
// it at 0 would dilute the material's rate toward zero. Reverse at the original rate.
type StockLedgerRef = { docId: string; rate: number };
async function resolveStockLedgerRefsByLedgerIds(ledgerIds: string[]): Promise<Map<string, StockLedgerRef>> {
  const ids = [...new Set(ledgerIds.filter(Boolean))];
  const map = new Map<string, StockLedgerRef>();
  if (ids.length === 0) return map;
  const { data, error } = await serviceRoleClient
    .schema("erp_inventory")
    .from("stock_ledger")
    .select("id, stock_document_id, valuation_rate")
    .in("id", ids);
  if (error) {
    console.error("[process_order.resolveStockLedgerRefsByLedgerIds] query failed:", JSON.stringify(error));
    throw new Error("PROD_PO_LEDGER_LOOKUP_FAILED");
  }
  for (const row of (data ?? []) as JsonRecord[]) {
    const ledgerId = String(row.id ?? "");
    const docId = toTrimmedString(row.stock_document_id);
    if (ledgerId && docId) map.set(ledgerId, { docId, rate: Number(row.valuation_rate ?? 0) });
  }
  return map;
}

async function fetchProductionMaterialBaseUom(materialId: string): Promise<string> {
  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("material_master")
    .select("base_uom_code")
    .eq("id", materialId)
    .maybeSingle();
  if (error) {
    console.error("[process_order.fetchProductionMaterialBaseUom] query failed:", JSON.stringify(error));
    throw new Error("PROD_PO_FETCH_FAILED");
  }
  return String((data as JsonRecord | null)?.base_uom_code ?? "KG");
}

function getIssueStorageLocationId(line: JsonRecord): string | null {
  return toTrimmedString(line.issue_sloc_id) || null;
}

function buildAvailabilityKey(materialId: string, storageLocationId: string): string {
  return `${materialId}::${storageLocationId}`;
}

function getReservationBalanceQty(reservation: JsonRecord | null): number {
  if (!reservation) return 0;
  const explicitBalance = parseNonNegativeNumber(reservation.balance_qty);
  if (explicitBalance !== null) return explicitBalance;
  const requiredQty = parseNonNegativeNumber(reservation.required_qty) ?? 0;
  const issuedQty = parseNonNegativeNumber(reservation.issued_qty) ?? 0;
  return Math.max(0, requiredQty - issuedQty);
}

function buildReservationCreditMap(reservationRows: Iterable<JsonRecord>): Map<string, number> {
  const creditMap = new Map<string, number>();
  for (const reservation of reservationRows) {
    const materialId = toTrimmedString(reservation.material_id);
    const storageLocationId = toTrimmedString(reservation.storage_location_id);
    const balanceQty = getReservationBalanceQty(reservation);
    if (!materialId || !storageLocationId || balanceQty <= 0) continue;
    const key = buildAvailabilityKey(materialId, storageLocationId);
    creditMap.set(key, (creditMap.get(key) ?? 0) + balanceQty);
  }
  return creditMap;
}

function applyReservationCreditsToAvailabilityRows(
  rows: AvailabilityRow[],
  reservationCreditMap: Map<string, number>,
): AvailabilityRow[] {
  return rows.map((row) => {
    const key = buildAvailabilityKey(row.material_id, row.storage_location_id);
    const creditedAvailableQty = row.available_qty + (reservationCreditMap.get(key) ?? 0);
    return {
      ...row,
      available_qty: creditedAvailableQty,
      short: creditedAvailableQty < row.needed_qty - EPSILON,
    };
  });
}

interface LineOverride {
  storageLocationId: string | null;
  actualMaterialId: string | null;
}

// Keyed by the line's Formulation material_id (never the substitute) so callers can always
// find an override by looking up the stroke line's own material_id.
function buildLineOverrideMap(overrides: unknown): Map<string, LineOverride> {
  const map = new Map<string, LineOverride>();
  if (!Array.isArray(overrides)) return map;
  for (const entry of overrides as JsonRecord[]) {
    const materialId = toTrimmedString(entry.material_id);
    if (!materialId) continue;
    map.set(materialId, {
      storageLocationId: toTrimmedString(entry.storage_location_id) || null,
      actualMaterialId: toTrimmedString(entry.actual_material_id) || null,
    });
  }
  return map;
}

function computeApprovalValues(
  req: Request,
  ctx: ProdHandlerContext,
  plannedQty: number,
  actualQty: number,
  bodyLine: JsonRecord,
): { approved_status: string; ap_approved_qty: number; variance_qty: number } | Response {
  if (qtysEffectivelyMatch(plannedQty, actualQty)) {
    return {
      approved_status: "YES",
      ap_approved_qty: actualQty,
      variance_qty: 0,
    };
  }

  const approvedStatus = toUpperTrimmedString(bodyLine.approved_status);
  if (!approvedStatus || !["YES", "NO", "PARTIAL"].includes(approvedStatus)) {
    return poErr(req, ctx, "PROD_PO_APPROVED_STATUS_REQUIRED", 400, "approved_status required when Actual differs from Standard");
  }

  if (approvedStatus === "YES") {
    return {
      approved_status: "YES",
      ap_approved_qty: actualQty,
      variance_qty: 0,
    };
  }

  if (approvedStatus === "NO") {
    return {
      approved_status: "NO",
      ap_approved_qty: plannedQty,
      variance_qty: actualQty - plannedQty,
    };
  }

  const apApprovedQty = parseNonNegativeNumber(bodyLine.ap_approved_qty);
  if (apApprovedQty === null) {
    return poErr(req, ctx, "PROD_PO_AP_APPROVED_QTY_REQUIRED", 400, "ap_approved_qty required for PARTIAL");
  }

  return {
    approved_status: "PARTIAL",
    ap_approved_qty: apApprovedQty,
    variance_qty: actualQty - apApprovedQty,
  };
}

async function applyFinalOrVerifyLineUpdates(params: {
  req: Request;
  ctx: ProdHandlerContext;
  po: JsonRecord;
  bodyLines: JsonRecord[];
  plannedStartDate: string | null;
}): Promise<{ response?: Response; lines?: JsonRecord[]; hasUnapprovedDeviation?: boolean }> {
  const { req, ctx, po, bodyLines, plannedStartDate } = params;
  if (bodyLines.length === 0) {
    const lines = await fetchOrderLines(String(po.id), toTrimmedString(po.stroke_master_id) || null);
    return {
      lines,
      hasUnapprovedDeviation: lines.some((line) => Number(line.variance_qty ?? 0) > EPSILON),
    };
  }

  const orderId = String(po.id);
  const existingLines = await fetchOrderLines(orderId, toTrimmedString(po.stroke_master_id) || null);
  const existingLineMap = new Map(existingLines.map((line) => [String(line.id), line]));
  const existingReservationMap = await fetchReservationRowsBySourceLineIds(existingLines.map((line) => String(line.id)));
  const allowedAlternateMap = await fetchAllowedAlternateIdsByStroke(
    toTrimmedString(po.stroke_master_id) || null,
    "[process_order.applyFinalOrVerifyLineUpdates]",
    "PROD_PO_FETCH_FAILED",
  );
  let nextDisplayOrder = existingLines.reduce((maxValue, line) => Math.max(maxValue, Number(line.display_order ?? 0)), 0) + 1;
  const now = new Date().toISOString();

  for (const bodyLine of bodyLines) {
    const lineId = toTrimmedString(bodyLine.id);
    const existingLine = lineId ? existingLineMap.get(lineId) ?? null : null;
    const actualQty = parseNonNegativeNumber(bodyLine.actual_qty) ?? 0;

    if (existingLine) {
      const plannedQty = Number(existingLine.planned_qty ?? 0);
      const approval = computeApprovalValues(req, ctx, plannedQty, actualQty, bodyLine);
      if (approval instanceof Response) return { response: approval };
      const nextRequiredQty = actualQty;

      let nextActualMaterialId = toTrimmedString(bodyLine.actual_material_id) || null;
      const currentActualMaterialId = toTrimmedString(existingLine.actual_material_id) || null;
      const allowedAlternateIds = new Set(allowedAlternateMap.get(String(existingLine.material_id)) ?? []);
      const nextStorageLocationId = toTrimmedString(bodyLine.storage_location_id) || null;
      const currentStorageLocationId = toTrimmedString(existingLine.issue_sloc_id) || null;

      if (!nextActualMaterialId || nextActualMaterialId === String(existingLine.material_id)) {
        nextActualMaterialId = null;
      }

      if (nextStorageLocationId && nextStorageLocationId !== currentStorageLocationId) {
        const reservation = existingReservationMap.get(String(existingLine.id)) ?? null;
        if (reservation && RESERVATION_OPEN_STATUSES.includes(String(reservation.status ?? ""))) {
          const { error: reservationLocationErr } = await serviceRoleClient
            .schema("erp_production")
            .from("reservation_document")
            .update({
              storage_location_id: nextStorageLocationId,
              last_updated_by: ctx.auth_user_id,
              last_updated_at: now,
            })
            .eq("id", reservation.id as string);
          if (reservationLocationErr) {
            console.error("[process_order.applyFinalOrVerifyLineUpdates] reservation location update failed:", JSON.stringify(reservationLocationErr));
            throw new Error("PROD_PO_LINE_UPDATE_FAILED");
          }
          existingReservationMap.set(String(existingLine.id), {
            ...reservation,
            storage_location_id: nextStorageLocationId,
          });
        }
      }

      if (nextActualMaterialId !== currentActualMaterialId) {
        if (nextActualMaterialId && !allowedAlternateIds.has(nextActualMaterialId)) {
          return {
            response: poErr(req, ctx, "PROD_PO_SUBSTITUTE_NOT_REGISTERED", 422, "actual_material_id must match the registered alternate"),
          };
        }

        const reservation = existingReservationMap.get(String(existingLine.id)) ?? null;
        if (reservation && RESERVATION_OPEN_STATUSES.includes(String(reservation.status ?? ""))) {
          const { error: cancelReservationErr } = await serviceRoleClient
            .schema("erp_production")
            .from("reservation_document")
            .update({
              status: "CANCELLED",
              last_updated_by: ctx.auth_user_id,
              last_updated_at: now,
            })
            .eq("id", reservation.id as string);
          if (cancelReservationErr) {
            console.error("[process_order.applyFinalOrVerifyLineUpdates] reservation cancel failed:", JSON.stringify(cancelReservationErr));
            throw new Error("PROD_PO_LINE_UPDATE_FAILED");
          }

          const swapMaterialId = nextActualMaterialId || String(existingLine.material_id);
          const { data: insertedReservation, error: insertReservationErr } = await serviceRoleClient
            .schema("erp_production")
            .from("reservation_document")
            .insert({
              source_type: "PROCESS_PO",
              source_id: orderId,
              source_line_id: existingLine.id,
              company_id: po.company_id,
              material_id: swapMaterialId,
              storage_location_id: nextStorageLocationId ?? reservation.storage_location_id ?? currentStorageLocationId ?? null,
              required_qty: nextRequiredQty,
              uom_code: reservation.uom_code ?? existingLine.uom_code ?? "KG",
              required_by_date: plannedStartDate,
              issued_qty: 0,
              status: "OPEN",
              created_by: ctx.auth_user_id,
              created_at: now,
              last_updated_by: ctx.auth_user_id,
              last_updated_at: now,
            })
            .select("id, source_line_id, material_id, required_qty, issued_qty, status, storage_location_id, uom_code")
            .single();
          if (insertReservationErr) {
            console.error("[process_order.applyFinalOrVerifyLineUpdates] reservation insert failed:", JSON.stringify(insertReservationErr));
            throw new Error("PROD_PO_LINE_UPDATE_FAILED");
          }
          existingReservationMap.set(String(existingLine.id), (insertedReservation ?? {}) as JsonRecord);
        }
      }

      const activeReservation = existingReservationMap.get(String(existingLine.id)) ?? null;
      if (activeReservation && RESERVATION_OPEN_STATUSES.includes(String(activeReservation.status ?? ""))) {
        const issuedQty = Number(activeReservation.issued_qty ?? 0);
        const reservationStatus = issuedQty <= EPSILON
          ? "OPEN"
          : issuedQty >= nextRequiredQty - EPSILON
          ? "FULLY_ISSUED"
          : "PARTIAL";
        const { error: reservationQtyErr } = await serviceRoleClient
          .schema("erp_production")
          .from("reservation_document")
          .update({
            required_qty: nextRequiredQty,
            status: reservationStatus,
            last_updated_by: ctx.auth_user_id,
            last_updated_at: now,
          })
          .eq("id", activeReservation.id as string);
        if (reservationQtyErr) {
          console.error("[process_order.applyFinalOrVerifyLineUpdates] reservation qty update failed:", JSON.stringify(reservationQtyErr));
          throw new Error("PROD_PO_LINE_UPDATE_FAILED");
        }
        existingReservationMap.set(String(existingLine.id), {
          ...activeReservation,
          required_qty: nextRequiredQty,
          status: reservationStatus,
        });
      }

      const { error: lineUpdateErr } = await serviceRoleClient
        .schema("erp_production")
        .from("process_order_line")
        .update({
          actual_qty: actualQty,
          approved_status: approval.approved_status,
          ap_approved_qty: approval.ap_approved_qty,
          variance_qty: approval.variance_qty,
          actual_material_id: nextActualMaterialId,
          issue_sloc_id: nextStorageLocationId ?? currentStorageLocationId,
        })
        .eq("id", existingLine.id as string)
        .eq("process_order_id", orderId);
      if (lineUpdateErr) {
        console.error("[process_order.applyFinalOrVerifyLineUpdates] line update failed:", JSON.stringify(lineUpdateErr));
        throw new Error("PROD_PO_LINE_UPDATE_FAILED");
      }
      continue;
    }

    const materialId = toTrimmedString(bodyLine.material_id);
    if (!materialId) continue;

    const approval = computeApprovalValues(req, ctx, 0, actualQty, bodyLine);
    if (approval instanceof Response) return { response: approval };

    const { data: insertedLine, error: insertLineErr } = await serviceRoleClient
      .schema("erp_production")
      .from("process_order_line")
      .insert({
        process_order_id: orderId,
        material_id: materialId,
        planned_qty: 0,
        actual_qty: actualQty,
        uom_code: toTrimmedString(bodyLine.uom_code) || "KG",
        issue_sloc_id: toTrimmedString(bodyLine.storage_location_id) || null,
        is_rm: bodyLine.is_rm !== false,
        display_order: nextDisplayOrder++,
        dosage_pct: parseNonNegativeNumber(bodyLine.dosage_pct),
        is_formulation_line: false,
        approved_status: approval.approved_status,
        ap_approved_qty: approval.ap_approved_qty,
        variance_qty: approval.variance_qty,
        actual_material_id: null,
      })
      .select(`
        id, process_order_id, material_id, planned_qty, actual_qty, uom_code,
        issue_sloc_id, is_rm, display_order, stock_ledger_id,
        actual_material_id, dosage_pct, is_formulation_line,
        approved_status, ap_approved_qty, variance_qty
      `)
      .single();
    if (insertLineErr) {
      console.error("[process_order.applyFinalOrVerifyLineUpdates] added line insert failed:", JSON.stringify(insertLineErr));
      throw new Error("PROD_PO_LINE_UPDATE_FAILED");
    }

    const insertedLineRecord = (insertedLine ?? {}) as JsonRecord;
    existingLineMap.set(String(insertedLineRecord.id), insertedLineRecord);

    const { data: insertedReservation, error: insertReservationErr } = await serviceRoleClient
      .schema("erp_production")
      .from("reservation_document")
      .insert({
        source_type: "PROCESS_PO",
        source_id: orderId,
        source_line_id: insertedLineRecord.id,
        company_id: po.company_id,
        material_id: materialId,
        storage_location_id: toTrimmedString(insertedLineRecord.issue_sloc_id) || null,
        required_qty: actualQty,
        uom_code: toTrimmedString(insertedLineRecord.uom_code) || "KG",
        required_by_date: plannedStartDate,
        issued_qty: 0,
        status: "OPEN",
        created_by: ctx.auth_user_id,
        created_at: now,
        last_updated_by: ctx.auth_user_id,
        last_updated_at: now,
      })
      .select("id, source_line_id, material_id, required_qty, issued_qty, status, storage_location_id, uom_code")
      .single();
    if (insertReservationErr) {
      console.error("[process_order.applyFinalOrVerifyLineUpdates] added reservation insert failed:", JSON.stringify(insertReservationErr));
      throw new Error("PROD_PO_LINE_UPDATE_FAILED");
    }
    existingReservationMap.set(String(insertedLineRecord.id), (insertedReservation ?? {}) as JsonRecord);
  }

  const lines = await fetchOrderLines(orderId, toTrimmedString(po.stroke_master_id) || null);
  return {
    lines,
    hasUnapprovedDeviation: lines.some((line) => Number(line.variance_qty ?? 0) > EPSILON),
  };
}

async function computeAvailabilityRows(
  companyId: string,
  needed: Map<string, AvailabilityNeed>,
): Promise<AvailabilityRow[]> {
  const needs = Array.from(needed.values()).filter((entry) => entry.materialId && entry.storageLocationId && entry.qty > 0);
  if (needs.length === 0) return [];

  const materialIds = [...new Set(needs.map((entry) => entry.materialId))];
  const locationIds = [...new Set(needs.map((entry) => entry.storageLocationId))];

  const { data: ledgerRows, error: ledgerErr } = await serviceRoleClient
    .schema("erp_inventory")
    .from("stock_ledger")
    .select("material_id, storage_location_id, direction, quantity")
    .eq("company_id", companyId)
    .eq("stock_type_code", "UNRESTRICTED")
    .in("material_id", materialIds)
    .in("storage_location_id", locationIds);
  if (ledgerErr) {
    console.error("[process_order.checkStockAvailability] ledger query failed:", JSON.stringify(ledgerErr));
    throw new Error("PROD_PO_STOCK_CHECK_FAILED");
  }

  const available = new Map<string, number>();
  for (const row of (ledgerRows ?? []) as JsonRecord[]) {
    const key = buildAvailabilityKey(String(row.material_id), String(row.storage_location_id));
    const qty = Number(row.quantity ?? 0);
    available.set(key, (available.get(key) ?? 0) + (String(row.direction) === "IN" ? qty : -qty));
  }

  const { data: reservationRows, error: reservationErr } = await serviceRoleClient
    .schema("erp_production")
    .from("reservation_document")
    .select("material_id, storage_location_id, balance_qty")
    .eq("company_id", companyId)
    .in("material_id", materialIds)
    .in("storage_location_id", locationIds)
    .in("status", RESERVATION_OPEN_STATUSES);
  if (reservationErr) {
    console.error("[process_order.checkStockAvailability] reservation query failed:", JSON.stringify(reservationErr));
    throw new Error("PROD_PO_STOCK_CHECK_FAILED");
  }
  for (const row of (reservationRows ?? []) as JsonRecord[]) {
    const key = buildAvailabilityKey(String(row.material_id), String(row.storage_location_id));
    const qty = Number(row.balance_qty ?? 0);
    available.set(key, (available.get(key) ?? 0) - qty);
  }

  const { data: matRows, error: matErr } = await serviceRoleClient
    .schema("erp_master")
    .from("material_master")
    .select("id, material_type")
    .in("id", materialIds);
  if (matErr) {
    console.error("[process_order.checkStockAvailability] material query failed:", JSON.stringify(matErr));
    throw new Error("PROD_PO_STOCK_CHECK_FAILED");
  }

  const intMats = new Set(
    ((matRows ?? []) as JsonRecord[])
      .filter((row) => row.material_type === "INT")
      .map((row) => String(row.id)),
  );

  if (intMats.size > 0) {
    const { data: intPOs, error: intErr } = await serviceRoleClient
      .schema("erp_production")
      .from("process_order")
      .select("material_id, planned_qty, actual_qty, stroke_master_id")
      .eq("company_id", companyId)
      .eq("po_type", "INT")
      .in("status", ["STANDARD", "QA_APPROVED", "BATCH_STARTED", "FINAL"])
      .in("material_id", Array.from(intMats));
    if (intErr) {
      console.error("[process_order.checkStockAvailability] int-po query failed:", JSON.stringify(intErr));
      throw new Error("PROD_PO_STOCK_CHECK_FAILED");
    }

    const strokeIds = [...new Set(
      ((intPOs ?? []) as JsonRecord[])
        .map((row) => toTrimmedString(row.stroke_master_id))
        .filter(Boolean),
    )];
    const strokeLocationMap = new Map<string, string>();
    if (strokeIds.length > 0) {
      const { data: strokeRows, error: strokeErr } = await serviceRoleClient
        .schema("erp_production")
        .from("stroke_master")
        .select("id, default_storage_location_id")
        .in("id", strokeIds);
      if (strokeErr) {
        console.error("[process_order.checkStockAvailability] int stroke query failed:", JSON.stringify(strokeErr));
        throw new Error("PROD_PO_STOCK_CHECK_FAILED");
      }
      for (const strokeRow of (strokeRows ?? []) as JsonRecord[]) {
        const strokeId = String(strokeRow.id);
        const storageLocationId = toTrimmedString(strokeRow.default_storage_location_id);
        if (strokeId && storageLocationId) {
          strokeLocationMap.set(strokeId, storageLocationId);
        }
      }
    }

    for (const row of (intPOs ?? []) as JsonRecord[]) {
      const storageLocationId = strokeLocationMap.get(toTrimmedString(row.stroke_master_id) || "");
      if (!storageLocationId) continue;
      const key = buildAvailabilityKey(String(row.material_id), storageLocationId);
      const qty = Number(row.actual_qty ?? row.planned_qty ?? 0);
      available.set(key, (available.get(key) ?? 0) + qty);
    }
  }

  return Array.from(needed.entries()).map(([, entry]) => {
    const key = buildAvailabilityKey(entry.materialId, entry.storageLocationId);
    const availableQty = Math.max(0, available.get(key) ?? 0);
    return {
      material_id: entry.materialId,
      storage_location_id: entry.storageLocationId,
      needed_qty: entry.qty,
      available_qty: availableQty,
      short: availableQty < entry.qty - EPSILON,
    };
  });
}

// Found live 2026-08-19 (business owner, CMP006/PO 9300000092): this check subtracted
// EVERY open reservation for the material+location, including the requesting PO's own
// reservation — so a PO already holding its own Start-Batch-time reservation would block
// ITSELF at Final/Verify, because its own already-reserved qty was counted twice (once as
// "stock this PO owns", once as "stock unavailable because someone reserved it"). Fixed by
// excluding source_type='PROCESS_PO' AND source_id=excludePoId (this PO's own row) from the
// reservation subtraction — only OTHER documents' open reservations should compete for the
// same physical stock.
async function computePhysicalAvailabilityRows(
  companyId: string,
  needed: Map<string, AvailabilityNeed>,
  excludePoId?: string,
): Promise<AvailabilityRow[]> {
  const needs = Array.from(needed.values()).filter((entry) => entry.materialId && entry.storageLocationId && entry.qty > 0);
  if (needs.length === 0) return [];

  const materialIds = [...new Set(needs.map((entry) => entry.materialId))];
  const locationIds = [...new Set(needs.map((entry) => entry.storageLocationId))];

  const { data: ledgerRows, error: ledgerErr } = await serviceRoleClient
    .schema("erp_inventory")
    .from("stock_ledger")
    .select("material_id, storage_location_id, direction, quantity")
    .eq("company_id", companyId)
    .eq("stock_type_code", "UNRESTRICTED")
    .in("material_id", materialIds)
    .in("storage_location_id", locationIds);
  if (ledgerErr) {
    console.error("[process_order.computePhysicalAvailabilityRows] ledger query failed:", JSON.stringify(ledgerErr));
    throw new Error("PROD_PO_STOCK_CHECK_FAILED");
  }

  const available = new Map<string, number>();
  for (const row of (ledgerRows ?? []) as JsonRecord[]) {
    const key = buildAvailabilityKey(String(row.material_id), String(row.storage_location_id));
    const qty = Number(row.quantity ?? 0);
    available.set(key, (available.get(key) ?? 0) + (String(row.direction) === "IN" ? qty : -qty));
  }

  const { data: reservationRows, error: reservationErr } = await serviceRoleClient
    .schema("erp_production")
    .from("reservation_document")
    .select("material_id, storage_location_id, balance_qty, source_type, source_id")
    .eq("company_id", companyId)
    .in("material_id", materialIds)
    .in("storage_location_id", locationIds)
    .in("status", RESERVATION_OPEN_STATUSES);
  if (reservationErr) {
    console.error("[process_order.computePhysicalAvailabilityRows] reservation query failed:", JSON.stringify(reservationErr));
    throw new Error("PROD_PO_STOCK_CHECK_FAILED");
  }

  for (const row of (reservationRows ?? []) as JsonRecord[]) {
    if (excludePoId && String(row.source_type) === "PROCESS_PO" && String(row.source_id) === excludePoId) continue;
    const key = buildAvailabilityKey(String(row.material_id), String(row.storage_location_id));
    const qty = Number(row.balance_qty ?? 0);
    available.set(key, (available.get(key) ?? 0) - qty);
  }

  return Array.from(needed.entries()).map(([, entry]) => {
    const key = buildAvailabilityKey(entry.materialId, entry.storageLocationId);
    const availableQty = Math.max(0, available.get(key) ?? 0);
    return {
      material_id: entry.materialId,
      storage_location_id: entry.storageLocationId,
      needed_qty: entry.qty,
      available_qty: availableQty,
      short: availableQty < entry.qty - EPSILON,
    };
  });
}

async function checkStockAvailability(
  companyId: string,
  needed: Map<string, AvailabilityNeed>,
): Promise<AvailabilityRow[]> {
  const rows = await computeAvailabilityRows(companyId, needed);
  return rows.filter((row) => row.short);
}

function buildLineAvailabilityNeeds(lines: JsonRecord[]): Map<string, AvailabilityNeed> {
  const needed = new Map<string, AvailabilityNeed>();
  for (const line of lines) {
    const qty = Number(line.actual_qty ?? line.planned_qty ?? 0);
    if (qty <= 0) continue;
    const storageLocationId = toTrimmedString(line.issue_sloc_id);
    if (!storageLocationId) continue;
    const materialId = toTrimmedString(line.actual_material_id) || String(line.material_id ?? "");
    if (!materialId) continue;
    const key = buildAvailabilityKey(materialId, storageLocationId);
    const current = needed.get(key);
    needed.set(key, {
      materialId,
      storageLocationId,
      qty: (current?.qty ?? 0) + qty,
    });
  }
  return needed;
}

// Found live 2026-08-12: every shortage/short-material error message in this file (4
// separate call shapes — this shared helper plus two inline copies plus the INT unmet
// list) rendered raw UUID prefixes (`material_id.slice(0,8)`) instead of a resolved
// name — a direct violation of CLAUDE.md §8A ("কোনো Business Data UUID হিসেবে দেখাবে না")
// that nobody caught because the frontend just toasts `error.message` as-is. A user
// hitting PROD_PO_INSUFFICIENT_STOCK saw "0b3360af @ 637eb0ee" with no way to know that
// meant Caustic Soda Lye at S003 — had to be decoded via DevTools/DB query. This is the
// ONE shared resolver now used everywhere a shortage list needs to become readable text;
// reuses the same getMaterialMapByIds/getStorageLocationMapByIds helpers already used
// throughout this file for every other UUID→name resolution, instead of inventing a
// separate path just for error messages.
async function formatShortageDetail(shortages: AvailabilityRow[]): Promise<string> {
  if (shortages.length === 0) return "";
  const materialIds = [...new Set(shortages.map((row) => row.material_id))];
  const storageLocationIds = [...new Set(shortages.map((row) => row.storage_location_id))];
  const [materialMap, slocMap] = await Promise.all([
    getMaterialMapByIds(materialIds, "[process_order.formatShortageDetail]", "PROD_PO_STOCK_CHECK_FAILED", "id, pace_code, material_name"),
    getStorageLocationMapByIds(storageLocationIds, "[process_order.formatShortageDetail]", "PROD_PO_STOCK_CHECK_FAILED"),
  ]);
  return shortages
    .map((row) => {
      const mat = materialMap.get(row.material_id);
      const matLabel = mat ? `${toTrimmedString(mat.pace_code) || "—"} — ${toTrimmedString(mat.material_name) || "—"}` : row.material_id;
      const sloc = slocMap.get(row.storage_location_id);
      const slocLabel = sloc ? (toTrimmedString(sloc.code) || toTrimmedString(sloc.name) || row.storage_location_id) : row.storage_location_id;
      return `${matLabel} @ ${slocLabel} (need ${row.needed_qty.toFixed(3)}, have ${row.available_qty.toFixed(3)})`;
    })
    .join("; ");
}

// Same resolver as formatShortageDetail, for the INT-specific "output not yet declared"
// list — was rendering raw UUID prefixes too (unmet.push(materialId.slice(0,8))).
async function formatMaterialLabels(materialIds: string[]): Promise<string> {
  if (materialIds.length === 0) return "";
  const ids = [...new Set(materialIds)];
  const materialMap = await getMaterialMapByIds(ids, "[process_order.formatMaterialLabels]", "PROD_PO_STOCK_CHECK_FAILED", "id, pace_code, material_name");
  return ids
    .map((id) => {
      const mat = materialMap.get(id);
      return mat ? `${toTrimmedString(mat.pace_code) || "—"} — ${toTrimmedString(mat.material_name) || "—"}` : id;
    })
    .join(", ");
}

export async function availabilityPreviewProcessOrderHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const url = new URL(req.url);
    const companyId = toTrimmedString(url.searchParams.get("company_id") ?? "");
    const strokeMasterId = toTrimmedString(url.searchParams.get("stroke_master_id") ?? "");
    const processOrderId = toTrimmedString(url.searchParams.get("process_order_id") ?? "");
    const plannedQty = parsePositiveNumber(url.searchParams.get("planned_qty") ?? "");
    const overridesRaw = url.searchParams.get("overrides") ?? "[]";

    if (!companyId) {
      return poErr(req, ctx, "PROD_PO_INVALID", 400, "company_id required");
    }
    try {
      await assertCompanyScope(ctx, companyId);
    } catch {
      return poErr(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }

    let overrides: JsonRecord[] = [];
    try {
      const parsed = JSON.parse(overridesRaw);
      overrides = Array.isArray(parsed) ? (parsed as JsonRecord[]) : [];
    } catch {
      return poErr(req, ctx, "PROD_PO_INVALID", 400, "overrides must be valid JSON");
    }

    const needed = new Map<string, AvailabilityNeed>();

    let reservationCreditMap = new Map<string, number>();

    if (processOrderId) {
      const po = await fetchProcessOrder(processOrderId);
      if (!po) return poErr(req, ctx, "PROD_PO_NOT_FOUND", 404, "Process order not found");
      const lines = await fetchOrderLines(processOrderId, toTrimmedString(po.stroke_master_id) || null);
      const reservationMap = await fetchReservationRowsBySourceLineIds(lines.map((line) => String(line.id)));
      reservationCreditMap = buildReservationCreditMap(reservationMap.values());
      const lineOverrides = new Map<string, JsonRecord>();
      const additionalOverrides: JsonRecord[] = [];

      for (const entry of overrides) {
        const lineId = toTrimmedString(entry.line_id);
        if (lineId) lineOverrides.set(lineId, entry);
        else additionalOverrides.push(entry);
      }

      for (const line of lines) {
        const override = lineOverrides.get(String(line.id)) ?? null;
        const materialId = toTrimmedString(override?.material_id) || String(line.material_id);
        const storageLocationId = toTrimmedString(override?.storage_location_id) || toTrimmedString(line.issue_sloc_id) || null;
        const qty = parseNonNegativeNumber(override?.qty ?? line.actual_qty ?? line.planned_qty);
        if (!materialId || !storageLocationId || qty === null || qty <= 0) continue;
        const key = buildAvailabilityKey(materialId, storageLocationId);
        const current = needed.get(key);
        needed.set(key, {
          materialId,
          storageLocationId,
          qty: (current?.qty ?? 0) + qty,
        });
      }

      for (const entry of additionalOverrides) {
        const materialId = toTrimmedString(entry.material_id);
        const storageLocationId = toTrimmedString(entry.storage_location_id);
        const qty = parseNonNegativeNumber(entry.qty);
        if (!materialId || !storageLocationId || qty === null || qty <= 0) continue;
        const key = buildAvailabilityKey(materialId, storageLocationId);
        const current = needed.get(key);
        needed.set(key, {
          materialId,
          storageLocationId,
          qty: (current?.qty ?? 0) + qty,
        });
      }
    } else {
      if (!strokeMasterId || !plannedQty) {
        return poErr(req, ctx, "PROD_PO_INVALID", 400, "stroke_master_id and planned_qty required when process_order_id is absent");
      }
      const overrideMap = buildLineOverrideMap(overrides);
      const { data: strokeLines, error: strokeLinesErr } = await serviceRoleClient
        .schema("erp_production")
        .from("stroke_line")
        .select("material_id, alternate_material_id, material_group_id, dosage_pct, default_storage_location_id")
        .eq("stroke_master_id", strokeMasterId);
      if (strokeLinesErr) {
        console.error("[process_order.availabilityPreview] stroke-line query failed:", JSON.stringify(strokeLinesErr));
        throw new Error("PROD_PO_STOCK_CHECK_FAILED");
      }

      const allowedAlternateMap = await buildAllowedAlternateIdsByStrokeLines(
        (strokeLines ?? []) as JsonRecord[],
        "[process_order.availabilityPreview]",
        "PROD_PO_STOCK_CHECK_FAILED",
      );

      for (const strokeLine of (strokeLines ?? []) as JsonRecord[]) {
        const formulationMaterialId = String(strokeLine.material_id);
        const override = overrideMap.get(formulationMaterialId) ?? null;
        const allowedAlternateIds = new Set(allowedAlternateMap.get(formulationMaterialId) ?? []);
        const effectiveMaterialId = (override?.actualMaterialId && allowedAlternateIds.has(override.actualMaterialId))
          ? override.actualMaterialId
          : formulationMaterialId;
        const storageLocationId = override?.storageLocationId
          ?? toTrimmedString(strokeLine.default_storage_location_id)
          ?? null;
        if (!storageLocationId) continue;
        const qty = (Number(strokeLine.dosage_pct ?? 0) / 100) * plannedQty;
        const key = buildAvailabilityKey(effectiveMaterialId, storageLocationId);
        const current = needed.get(key);
        needed.set(key, {
          materialId: effectiveMaterialId,
          storageLocationId,
          qty: (current?.qty ?? 0) + qty,
        });
      }
    }

    const rows = applyReservationCreditsToAvailabilityRows(
      await computeAvailabilityRows(companyId, needed),
      reservationCreditMap,
    );
    return okResponse({ data: rows }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PO_STOCK_CHECK_FAILED";
    return poErr(req, ctx, code, 500, "Availability preview failed");
  }
}

export async function listProcessOrdersHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const url = new URL(req.url);
    const companyId = toTrimmedString(url.searchParams.get("company_id") ?? "");
    const poNumber = toTrimmedString(url.searchParams.get("po_number") ?? "");
    const status = toUpperTrimmedString(url.searchParams.get("status") ?? "");
    const poType = toUpperTrimmedString(url.searchParams.get("po_type") ?? "");
    const poTypeIn = toTrimmedString(url.searchParams.get("po_type_in") ?? "");
    const poTypeList = poTypeIn
      ? poTypeIn.split(",").map((value) => toUpperTrimmedString(value)).filter(Boolean)
      : [];
    const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
    const perPage = Math.min(100, Math.max(10, parseInt(url.searchParams.get("per_page") ?? "20", 10)));

    // Without this, any authenticated production role saw every company's Process
    // POs the moment the Company filter was left blank - the only guard was the
    // route-level capability check, which says nothing about *which* company. Scope
    // to the caller's own companies (erp_map.user_companies) unless SA/GA.
    let allowedCompanyIds: string[] | null = null;
    if (ctx.roleCode !== "SA" && ctx.roleCode !== "GA") {
      const { data: userCompanies, error: userCompaniesError } = await serviceRoleClient
        .schema("erp_map")
        .from("user_companies")
        .select("company_id")
        .eq("auth_user_id", ctx.auth_user_id);
      if (userCompaniesError) {
        console.error("[process_order.listProcessOrders] user_companies query failed:", JSON.stringify(userCompaniesError));
        throw new Error("PROD_PO_LIST_FAILED");
      }
      const resolvedCompanyIds = ((userCompanies ?? []) as JsonRecord[]).map((row) => String(row.company_id ?? ""));
      allowedCompanyIds = resolvedCompanyIds;
      if (companyId && !resolvedCompanyIds.includes(companyId)) {
        return poErr(req, ctx, "PROD_PO_COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
      }
    }

    let query = serviceRoleClient
      .schema("erp_production")
      .from("process_order")
      .select(`
        id, company_id, po_number, po_type, segment_code,
        material_id, stroke_master_id, machine_id, batch_number,
        planned_qty, actual_qty, status,
        qa_decided_by, qa_decided_at,
        batch_started_at, finalized_at, verified_at, created_by, created_at
      `, { count: "exact" })
      .order("created_at", { ascending: false });

    if (companyId) query = query.eq("company_id", companyId);
    else if (allowedCompanyIds) query = query.in("company_id", allowedCompanyIds);
    if (poNumber) query = query.eq("po_number", poNumber);
    if (status) query = query.eq("status", status);
    if (poTypeList.length > 0) query = query.in("po_type", poTypeList);
    else if (poType) query = query.eq("po_type", poType);

    const { data, error, count } = await ((query as typeof query & {
      range: (from: number, to: number) => typeof query;
    }).range((page - 1) * perPage, page * perPage - 1)) as {
      data: unknown;
      error: unknown;
      count?: number;
    };
    if (error) {
      console.error("[process_order.listProcessOrders] query failed:", JSON.stringify(error));
      throw new Error("PROD_PO_LIST_FAILED");
    }

    const rows = (data ?? []) as JsonRecord[];

    const strokeIds = [...new Set(rows.map((row) => String(row.stroke_master_id ?? "")).filter(Boolean))];
    const machineIds = [...new Set(rows.map((row) => String(row.machine_id ?? "")).filter(Boolean))];
    const createdByIds = [...new Set(rows.map((row) => String(row.created_by ?? "")).filter(Boolean))];

    // PERF: INDEPENDENT per CLAUDE.md 8B — all four lookups read only `rows`, never each other's
    // result, so they run as one parallel round instead of four sequential Oregon->Mumbai round
    // trips. Every branch raises the same PROD_PO_LIST_FAILED, so Promise.all's first-rejection
    // surfaces the identical error the old sequential order did.
    const [materialMap, strokeNumberById, machineById, createdByDisplayMap] = await Promise.all([
      getMaterialMapByIds(
        rows.map((row) => String(row.material_id ?? "")),
        "[process_order.listProcessOrders]",
        "PROD_PO_LIST_FAILED",
        "id, pace_code, material_name, shade_code",
      ),
      (async () => {
        const map = new Map<string, string>();
        if (strokeIds.length === 0) return map;
        const { data: strokes, error: strokeErr } = await serviceRoleClient
          .schema("erp_production")
          .from("stroke_master")
          .select("id, stroke_number")
          .in("id", strokeIds);
        if (strokeErr) {
          console.error("[process_order.listProcessOrders] stroke query failed:", JSON.stringify(strokeErr));
          throw new Error("PROD_PO_LIST_FAILED");
        }
        for (const stroke of (strokes ?? []) as JsonRecord[]) {
          map.set(String(stroke.id), String(stroke.stroke_number ?? ""));
        }
        return map;
      })(),
      (async () => {
        const map = new Map<string, JsonRecord>();
        if (machineIds.length === 0) return map;
        const { data: machines, error: machineErr } = await serviceRoleClient
          .schema("erp_master")
          .from("machine_master")
          .select("id, machine_code, machine_name")
          .in("id", machineIds);
        if (machineErr) {
          console.error("[process_order.listProcessOrders] machine query failed:", JSON.stringify(machineErr));
          throw new Error("PROD_PO_LIST_FAILED");
        }
        for (const machine of (machines ?? []) as JsonRecord[]) {
          map.set(String(machine.id), machine);
        }
        return map;
      })(),
      (async () => {
        if (createdByIds.length === 0) return new Map<string, string>();
        try {
          return await resolveUserDisplayNames(createdByIds);
        } catch (error) {
          console.error("[process_order.listProcessOrders] created-by resolution failed:", JSON.stringify(error));
          throw new Error("PROD_PO_LIST_FAILED");
        }
      })(),
    ]);

    return okResponse({
      data: rows.map((row) => ({
        ...row,
        material: materialMap.get(String(row.material_id ?? "")) ?? null,
        stroke_number: strokeNumberById.get(String(row.stroke_master_id ?? "")) || null,
        machine: machineById.get(String(row.machine_id ?? "")) ?? null,
        created_by_display: createdByDisplayMap.get(String(row.created_by ?? "")) || null,
      })),
      pagination: { page, per_page: perPage, total: count ?? 0, total_pages: Math.ceil((count ?? 0) / perPage) },
    }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PO_LIST_FAILED";
    return poErr(req, ctx, code, 500, "Process order list failed");
  }
}

export async function getProcessOrderHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const id = getIdFromPath(req);
    if (!id) return poErr(req, ctx, "PROD_PO_ID_MISSING", 400, "Process order ID required");

    const { data: po, error } = await serviceRoleClient
      .schema("erp_production")
      .from("process_order")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      console.error("[process_order.getProcessOrder] query failed:", JSON.stringify(error));
      throw new Error("PROD_PO_FETCH_FAILED");
    }
    if (!po) return poErr(req, ctx, "PROD_PO_NOT_FOUND", 404, "Process order not found");
    try {
      await assertCompanyScope(ctx, String((po as JsonRecord).company_id ?? ""));
    } catch {
      return poErr(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }

    const poRow = po as JsonRecord;
    const strokeMasterId = toTrimmedString(poRow.stroke_master_id) || null;
    const machineId = toTrimmedString(poRow.machine_id) || null;

    // stroke_master lives in erp_production, machine_master in erp_master - the old
    // PostgREST embed shorthand (`table!fk_column(...)`) can't resolve a cross-schema
    // relationship reliably from a single-schema request context, so it 500'd. Fetch
    // both explicitly instead, matching the pattern already used everywhere else in
    // this file (e.g. listProcessOrdersHandler's own stroke/machine lookups).
    const [materialMap, strokeResult, machineResult] = await Promise.all([
      getMaterialMapByIds(
        [String(poRow.material_id ?? "")],
        "[process_order.getProcessOrder]",
        "PROD_PO_FETCH_FAILED",
        "id, pace_code, material_name, shade_code, base_uom_code",
      ),
      strokeMasterId
        ? serviceRoleClient
            .schema("erp_production")
            .from("stroke_master")
            .select("id, stroke_number, description, status")
            .eq("id", strokeMasterId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      machineId
        ? serviceRoleClient
            .schema("erp_master")
            .from("machine_master")
            .select("id, machine_code, machine_name")
            .eq("id", machineId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);

    if (strokeResult.error) {
      console.error("[process_order.getProcessOrder] stroke query failed:", JSON.stringify(strokeResult.error));
      throw new Error("PROD_PO_FETCH_FAILED");
    }
    if (machineResult.error) {
      console.error("[process_order.getProcessOrder] machine query failed:", JSON.stringify(machineResult.error));
      throw new Error("PROD_PO_FETCH_FAILED");
    }

    const lines = await fetchOrderLines(id, strokeMasterId);
    const { data: packOrders, error: packErr } = await serviceRoleClient
      .schema("erp_production")
      .from("packing_order")
      .select("id, po_number, status, planned_qty_kg, actual_qty_kg")
      .eq("process_order_id", id)
      .neq("status", "REVERSED");
    if (packErr) {
      console.error("[process_order.getProcessOrder] packing-order query failed:", JSON.stringify(packErr));
      throw new Error("PROD_PO_FETCH_FAILED");
    }

    return okResponse({
      data: {
        ...poRow,
        material: materialMap.get(String(poRow.material_id ?? "")) ?? null,
        stroke: strokeResult.data ?? null,
        machine: machineResult.data ?? null,
        lines,
        packing_orders: packOrders ?? [],
      },
    }, ctx.request_id, req);
  } catch (err) {
    console.error(
      "[process_order.getProcessOrder] unhandled error:",
      err instanceof Error ? (err.stack ?? err.message) : String(err),
    );
    const code = err instanceof Error ? err.message : "PROD_PO_FETCH_FAILED";
    return poErr(req, ctx, code, 500, "Process order fetch failed");
  }
}

// §131.2 (2026-08-26): lets PR09's frontend disable po_type options the caller can't
// actually use (e.g. MTEST for Production, or MTO/HPS/MTS/INT for QA) WITHOUT
// hardcoding role/department names client-side (CLAUDE.md bug pattern #12 — this
// exact anti-pattern already bit QAQueuePage.jsx once). It just asks the real ACL
// engine "can I WRITE to PROD_PO_CREATE / PROD_MTEST_PO_CREATE at this company",
// same check createProcessOrderHandler itself performs — this is read-only and
// reveals nothing beyond two booleans, so it's registered skipAcl:true (any
// authenticated user can ask about their own capability).
export async function getProcessOrderCreateCapabilityHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    const companyId = toTrimmedString(new URL(req.url).searchParams.get("company_id"));
    if (!companyId) {
      return poErr(req, ctx, "PROD_PO_INVALID", 400, "company_id required");
    }
    try {
      await assertCompanyScope(ctx, companyId);
    } catch {
      return poErr(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }
    const [standard, mtest] = await Promise.all([
      canMaintainCompanyResource(ctx, companyId, "PROD_PO_CREATE", "WRITE"),
      canMaintainCompanyResource(ctx, companyId, "PROD_MTEST_PO_CREATE", "WRITE"),
    ]);
    return okResponse({ standard, mtest }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PO_CAPABILITY_CHECK_FAILED";
    return poErr(req, ctx, code, 500, "Capability check failed");
  }
}

export async function createProcessOrderHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const body = await parseBody(req);

    const companyId = toTrimmedString(body.company_id);
    const poType = toUpperTrimmedString(body.po_type);
    const segmentCode = toUpperTrimmedString(body.segment_code);
    const materialId = toTrimmedString(body.material_id || body.prodshade_material_id);
    const strokeId = toTrimmedString(body.stroke_master_id) || null;
    const machineId = toTrimmedString(body.machine_id) || null;
    const plannedQty = parsePositiveNumber(body.planned_qty ?? body.planned_qty_kg);
    const plannedStartDate = toTrimmedString(body.planned_start_date) || null;
    const notes = toTrimmedString(body.notes);
    const lineOverrideMap = buildLineOverrideMap(body.line_location_overrides);

    if (!companyId || !VALID_PO_TYPES.has(poType) || !VALID_SEGMENTS.has(segmentCode) || !materialId || !plannedQty) {
      return poErr(req, ctx, "PROD_PO_INVALID", 400, "company_id, po_type, segment_code, material_id, planned_qty required");
    }
    if (plannedStartDate && !isManualDocumentDateWithinPastWindow(plannedStartDate)) {
      return poErr(req, ctx, "PROD_PO_PLANNED_START_DATE_OUTSIDE_ALLOWED_WINDOW", 400, MANUAL_PAST_DATE_WINDOW_MESSAGE);
    }

    try {
      await assertCompanyScope(ctx, companyId);
    } catch {
      return poErr(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }
    // §131.2 (2026-08-26): MTEST is QA-exclusive, gated by its OWN resource code —
    // PROD_PO_CREATE stays exactly as it was (Production-only) for every other
    // po_type. Never widen PROD_PO_CREATE itself to cover MTEST; that would also
    // hand Production MTEST access, which is not the design.
    const createResourceCode = poType === "MTEST" ? "PROD_MTEST_PO_CREATE" : "PROD_PO_CREATE";
    if (!(await canMaintainCompanyResource(ctx, companyId, createResourceCode, "WRITE"))) {
      return poErr(req, ctx, "PROD_PO_COMPANY_ACCESS_DENIED", 403, "You do not have edit access to Process PO for this company.");
    }

    const machineValidation = await validateRequiredMachine(req, ctx, companyId, poType, machineId);
    if (machineValidation) return machineValidation;

    if (!strokeId) {
      return poErr(req, ctx, "PROD_PO_STROKE_REQUIRED", 400, "stroke_master_id required");
    }

    if (strokeId) {
      const { data: stroke, error: strokeErr } = await serviceRoleClient
        .schema("erp_production")
        .from("stroke_master")
        .select("status, company_id, prodshade_material_id, material_type, conversion_factor")
        .eq("id", strokeId)
        .maybeSingle();
      if (strokeErr) {
        console.error("[process_order.createProcessOrder] stroke query failed:", JSON.stringify(strokeErr));
        throw new Error("PROD_PO_CREATE_FAILED");
      }
      if (!stroke || (stroke as JsonRecord).status !== "APPROVED") {
        return poErr(req, ctx, "PROD_PO_STROKE_NOT_APPROVED", 422, "Stroke master must be APPROVED");
      }
      const strokeRow = stroke as JsonRecord;
      if (String(strokeRow.company_id ?? "") !== companyId || String(strokeRow.prodshade_material_id ?? "") !== materialId) {
        return poErr(req, ctx, "PROD_PO_STROKE_MATERIAL_MISMATCH", 422, "Stroke master must belong to the selected company and Prodshade");
      }
      if (poType !== "INT") {
        const { data: applicability, error: applicabilityErr } = await serviceRoleClient
          .schema("erp_production")
          .from("stroke_po_type_applicability")
          .select("id")
          .eq("stroke_master_id", strokeId)
          .eq("target_po_type", poType)
          .eq("is_active", true)
          .maybeSingle();
        if (applicabilityErr) {
          console.error("[process_order.createProcessOrder] stroke applicability query failed:", JSON.stringify(applicabilityErr));
          throw new Error("PROD_PO_CREATE_FAILED");
        }
        if (!applicability) {
          return poErr(req, ctx, "PROD_PO_STROKE_NOT_ELIGIBLE_FOR_TYPE", 422, "Stroke master is not active for the selected Process PO Type");
        }
      }
      if (REQUIRED_MACHINE_TYPES.has(poType)) {
        const machine = await fetchMachine(companyId, machineId as string);
        const capacityKg = machine ? resolveMachineCapacityKg(machine, strokeRow) : null;
        if (!capacityKg) {
          return poErr(req, ctx, "PROD_PO_MACHINE_CAPACITY_NOT_CONFIGURED", 422, "Selected machine must have a positive KG capacity, or a Litre capacity with a valid Stroke conversion factor");
        }
        const maxPlannedQty = capacityKg * MACHINE_CAPACITY_TOLERANCE;
        if (plannedQty > maxPlannedQty + 0.000001) {
          return poErr(req, ctx, "PROD_PO_MACHINE_CAPACITY_EXCEEDED", 422, `Planned batch quantity cannot exceed ${maxPlannedQty.toFixed(3)} KG (110% of selected machine capacity)`);
        }
      }
    }

    if (strokeId) {
      const { data: strokeLines, error: strokeLinesErr } = await serviceRoleClient
        .schema("erp_production")
        .from("stroke_line")
        .select("material_id, alternate_material_id, material_group_id, dosage_pct, default_storage_location_id")
        .eq("stroke_master_id", strokeId);
      if (strokeLinesErr) {
        console.error("[process_order.createProcessOrder] stroke-line query failed:", JSON.stringify(strokeLinesErr));
        throw new Error("PROD_PO_CREATE_FAILED");
      }

      const allowedAlternateMap = await buildAllowedAlternateIdsByStrokeLines(
        (strokeLines ?? []) as JsonRecord[],
        "[process_order.createProcessOrder]",
        "PROD_PO_CREATE_FAILED",
      );

      for (const strokeLine of (strokeLines ?? []) as JsonRecord[]) {
        const override = lineOverrideMap.get(String(strokeLine.material_id)) ?? null;
        const allowedAlternateIds = new Set(allowedAlternateMap.get(String(strokeLine.material_id)) ?? []);
        if (override?.actualMaterialId && !allowedAlternateIds.has(override.actualMaterialId)) {
          return poErr(req, ctx, "PROD_PO_SUBSTITUTE_NOT_REGISTERED", 422, "actual_material_id must match the registered alternate");
        }
      }

      if ((strokeLines ?? []).length > 0) {
        const needed = new Map<string, AvailabilityNeed>();
        for (const strokeLine of (strokeLines ?? []) as JsonRecord[]) {
          const formulationMaterialId = String(strokeLine.material_id);
          const override = lineOverrideMap.get(formulationMaterialId) ?? null;
          const allowedAlternateIds = new Set(allowedAlternateMap.get(formulationMaterialId) ?? []);
          const effectiveMaterialId = (override?.actualMaterialId && allowedAlternateIds.has(override.actualMaterialId))
            ? override.actualMaterialId
            : formulationMaterialId;
          const storageLocationId = override?.storageLocationId
            ?? toTrimmedString(strokeLine.default_storage_location_id)
            ?? null;
          if (!storageLocationId) continue;
          const qty = (Number(strokeLine.dosage_pct ?? 0) / 100) * plannedQty;
          const key = buildAvailabilityKey(effectiveMaterialId, storageLocationId);
          const current = needed.get(key);
          needed.set(key, {
            materialId: effectiveMaterialId,
            storageLocationId,
            qty: (current?.qty ?? 0) + qty,
          });
        }

        const short = await checkStockAvailability(companyId, needed);
        if (short.length > 0) {
          const detail = await formatShortageDetail(short);
          return poErr(req, ctx, "PROD_PO_INSUFFICIENT_STOCK", 422, `Insufficient UNRESTRICTED stock for ${short.length} material(s): ${detail}`);
        }
      }
    }

    const poNumber = await generateGlobalDocNumber("PROC_PO");
    const now = new Date().toISOString();

    const { data: insertedPo, error: poErrInsert } = await serviceRoleClient
      .schema("erp_production")
      .from("process_order")
      .insert({
        company_id: companyId,
        po_number: poNumber,
        po_type: poType,
        segment_code: segmentCode,
        material_id: materialId,
        stroke_master_id: strokeId,
        machine_id: machineId,
        planned_qty: plannedQty,
        notes: notes || null,
        status: "STANDARD",
        created_by: ctx.auth_user_id,
        created_at: now,
        last_updated_at: now,
        last_updated_by: ctx.auth_user_id,
      })
      .select("id")
      .single();
    if (poErrInsert) {
      console.error("[process_order.createProcessOrder] process-order insert failed:", JSON.stringify(poErrInsert));
      throw new Error("PROD_PO_CREATE_FAILED");
    }

    const poId = String((insertedPo as JsonRecord).id);
    const insertedLines: JsonRecord[] = [];

    if (strokeId) {
      const { data: strokeLines, error: strokeLineErr } = await serviceRoleClient
        .schema("erp_production")
        .from("stroke_line")
        .select("material_id, alternate_material_id, material_group_id, dosage_pct, display_order, default_storage_location_id")
        .eq("stroke_master_id", strokeId)
        .order("display_order");
      if (strokeLineErr) {
        console.error("[process_order.createProcessOrder] stroke-line prepopulate query failed:", JSON.stringify(strokeLineErr));
        throw new Error("PROD_PO_LINE_PREPOPULATE_FAILED");
      }

      if ((strokeLines ?? []).length > 0) {
        const allowedAlternateMap = await buildAllowedAlternateIdsByStrokeLines(
          (strokeLines ?? []) as JsonRecord[],
          "[process_order.createProcessOrder]",
          "PROD_PO_LINE_PREPOPULATE_FAILED",
        );
        const lineRows = ((strokeLines ?? []) as JsonRecord[]).map((strokeLine) => {
          const override = lineOverrideMap.get(String(strokeLine.material_id)) ?? null;
          const allowedAlternateIds = new Set(allowedAlternateMap.get(String(strokeLine.material_id)) ?? []);
          const actualMaterialId = (override?.actualMaterialId && allowedAlternateIds.has(override.actualMaterialId))
            ? override.actualMaterialId
            : null;
          return {
            process_order_id: poId,
            material_id: strokeLine.material_id,
            actual_material_id: actualMaterialId,
            planned_qty: (Number(strokeLine.dosage_pct ?? 0) / 100) * plannedQty,
            actual_qty: null,
            uom_code: "KG",
            issue_sloc_id: override?.storageLocationId
              ?? toTrimmedString(strokeLine.default_storage_location_id)
              ?? null,
            is_rm: true,
            display_order: strokeLine.display_order,
            dosage_pct: strokeLine.dosage_pct,
            is_formulation_line: true,
          };
        });
        const { data: createdLines, error: lineErr } = await serviceRoleClient
          .schema("erp_production")
          .from("process_order_line")
          .insert(lineRows)
          .select("id, material_id, actual_material_id, planned_qty, issue_sloc_id, is_rm, uom_code");
        if (lineErr) {
          console.error("[process_order.createProcessOrder] prepopulate line insert failed:", JSON.stringify(lineErr));
          throw new Error("PROD_PO_LINE_PREPOPULATE_FAILED");
        }
        insertedLines.push(...((createdLines ?? []) as JsonRecord[]));
      }
    }

    const manualLines = Array.isArray(body.lines) ? (body.lines as JsonRecord[]) : [];
    if (manualLines.length > 0) {
      const manualRows = manualLines.map((line, index) => ({
        process_order_id: poId,
        material_id: toTrimmedString(line.material_id),
        planned_qty: parsePositiveNumber(line.planned_qty) ?? 0,
        actual_qty: null,
        uom_code: toTrimmedString(line.uom_code) || "KG",
        issue_sloc_id: toTrimmedString(line.storage_location_id || line.issue_sloc_id) || null,
        is_rm: line.is_rm !== false,
        display_order: 1000 + index,
        dosage_pct: parseNonNegativeNumber(line.dosage_pct),
        is_formulation_line: true,
      }));
      const { data: createdManualLines, error: manualErr } = await serviceRoleClient
        .schema("erp_production")
        .from("process_order_line")
        .insert(manualRows)
        .select("id, material_id, planned_qty, issue_sloc_id, is_rm, uom_code");
      if (manualErr) {
        console.error("[process_order.createProcessOrder] manual line insert failed:", JSON.stringify(manualErr));
        throw new Error("PROD_PO_LINE_PREPOPULATE_FAILED");
      }
      insertedLines.push(...((createdManualLines ?? []) as JsonRecord[]));
    }

    if (insertedLines.length > 0) {
      // Found live 2026-08-31 (CMP006): the old code re-checked availability
      // BEFORE this insert (line ~1865) and then blindly inserted reservations
      // here with no lock spanning the two -- two Process POs created close
      // together could both pass the earlier check and both reserve,
      // over-committing the same physical stock. reserve_process_order_materials()
      // (§8D-style, migration 20260831121606) recomputes availability AND
      // inserts the reservation rows in one Postgres transaction, serialized
      // per (company, material, location) via advisory lock, so this is the
      // authoritative check -- the earlier one is now just a fast-fail for the
      // common non-racing case.
      const { data: reserveResult, error: reserveErr } = await serviceRoleClient
        .schema("erp_production")
        .rpc("reserve_process_order_materials", {
          p_process_order_id: poId,
          p_company_id: companyId,
          p_required_by_date: plannedStartDate,
          p_created_by: ctx.auth_user_id,
        });
      if (reserveErr) {
        console.error("[process_order.createProcessOrder] reserve rpc failed:", JSON.stringify(reserveErr));
        throw new Error("PROD_PO_CREATE_FAILED");
      }
      const result = reserveResult as { ok: boolean; shortages?: AvailabilityRow[] } | null;
      if (!result?.ok) {
        // Stock genuinely unavailable at lock time -- undo the metadata-only
        // PO/lines just inserted (cascade deletes the lines) and surface the
        // same error shape the old up-front check produced.
        await serviceRoleClient.schema("erp_production").from("process_order").delete().eq("id", poId);
        const shortages = result?.shortages ?? [];
        const detail = await formatShortageDetail(shortages.map((row) => ({
          material_id: String(row.material_id),
          storage_location_id: String(row.storage_location_id),
          needed_qty: Number(row.needed_qty),
          available_qty: Number(row.available_qty),
          short: true,
        })));
        return poErr(req, ctx, "PROD_PO_INSUFFICIENT_STOCK", 422, `Insufficient UNRESTRICTED stock for ${shortages.length} material(s): ${detail}`);
      }
    }

    return createdOkResponse({ id: poId, po_number: poNumber }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PO_CREATE_FAILED";
    return poErr(req, ctx, code, 500, `Process order create failed: ${err instanceof Error ? err.message : ""}`);
  }
}

export async function pruneProcessOrderHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const id = getIdFromPath(req);
    if (!id) return poErr(req, ctx, "PROD_PO_ID_MISSING", 400, "ID required");

    const po = await fetchProcessOrder(id);
    if (!po) return poErr(req, ctx, "PROD_PO_NOT_FOUND", 404, "Process order not found");
    try {
      await assertCompanyScope(ctx, String(po.company_id ?? ""));
    } catch {
      return poErr(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }
    if (!(await canMaintainCompanyResource(ctx, String(po.company_id ?? ""), "PROD_PO_EDIT", "EDIT"))) {
      return poErr(req, ctx, "PROD_PO_COMPANY_ACCESS_DENIED", 403, "You do not have edit access to Process PO for this company.");
    }
    if (po.status !== "STANDARD") {
      return poErr(req, ctx, "PROD_PO_PRUNE_STATUS_INVALID", 422, "Prune allowed only at STANDARD");
    }

    const body = await parseBody(req);
    const reason = toTrimmedString(body.reason);
    if (!reason) {
      return poErr(req, ctx, "PROD_PO_PRUNE_REASON_REQUIRED", 400, "Prune reason required");
    }

    const now = new Date().toISOString();
    const { error: updateErr } = await serviceRoleClient
      .schema("erp_production")
      .from("process_order")
      .update({
        status: "CANCELLED",
        prune_reason: reason,
        pruned_by: ctx.auth_user_id,
        pruned_at: now,
        last_updated_at: now,
        last_updated_by: ctx.auth_user_id,
      })
      .eq("id", id);
    if (updateErr) {
      console.error("[process_order.pruneProcessOrder] process order update failed:", JSON.stringify(updateErr));
      throw new Error("PROD_PO_PRUNE_FAILED");
    }

    const { error: reservationErr } = await serviceRoleClient
      .schema("erp_production")
      .from("reservation_document")
      .update({
        status: "CANCELLED",
        last_updated_by: ctx.auth_user_id,
        last_updated_at: now,
      })
      .eq("source_type", "PROCESS_PO")
      .eq("source_id", id)
      .neq("status", "CANCELLED");
    if (reservationErr) {
      console.error("[process_order.pruneProcessOrder] reservation cancel failed:", JSON.stringify(reservationErr));
      throw new Error("PROD_PO_PRUNE_FAILED");
    }

    return okResponse({ id, status: "CANCELLED" }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PO_PRUNE_FAILED";
    return poErr(req, ctx, code, 500, "Prune failed");
  }
}

export async function updateProcessOrderLinesHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const id = getIdFromPath(req);
    if (!id) return poErr(req, ctx, "PROD_PO_ID_MISSING", 400, "ID required");

    const po = await fetchProcessOrder(id);
    if (!po) return poErr(req, ctx, "PROD_PO_NOT_FOUND", 404, "Not found");
    try {
      await assertCompanyScope(ctx, String(po.company_id ?? ""));
    } catch {
      return poErr(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }
    if (!(await canMaintainCompanyResource(ctx, String(po.company_id ?? ""), "PROD_PO_EDIT", "EDIT"))) {
      return poErr(req, ctx, "PROD_PO_COMPANY_ACCESS_DENIED", 403, "You do not have edit access to Process PO for this company.");
    }
    if (po.status !== "STANDARD") {
      return poErr(req, ctx, "PROD_PO_STATUS_LOCKED", 422, "Lines editable only at STANDARD status");
    }

    const body = await parseBody(req);
    const lines = Array.isArray(body.lines) ? body.lines : [];

    const { error: deleteErr } = await serviceRoleClient
      .schema("erp_production")
      .from("process_order_line")
      .delete()
      .eq("process_order_id", id);
    if (deleteErr) {
      console.error("[process_order.updateProcessOrderLines] delete failed:", JSON.stringify(deleteErr));
      throw new Error("PROD_PO_LINE_UPDATE_FAILED");
    }

    if (lines.length > 0) {
      const lineRows = (lines as JsonRecord[]).map((line, index) => ({
        process_order_id: id,
        material_id: toTrimmedString(line.material_id),
        planned_qty: parsePositiveNumber(line.planned_qty) ?? 0,
        actual_qty: null,
        uom_code: toTrimmedString(line.uom_code) || "KG",
        issue_sloc_id: toTrimmedString(line.issue_sloc_id) || null,
        is_rm: line.is_rm !== false,
        display_order: index,
        dosage_pct: parseNonNegativeNumber(line.dosage_pct),
        is_formulation_line: line.is_formulation_line !== false,
      }));
      const { error } = await serviceRoleClient
        .schema("erp_production")
        .from("process_order_line")
        .insert(lineRows);
      if (error) {
        console.error("[process_order.updateProcessOrderLines] insert failed:", JSON.stringify(error));
        throw new Error("PROD_PO_LINE_UPDATE_FAILED");
      }
    }

    if (body.planned_qty || body.planned_qty_kg) {
      const newQty = parsePositiveNumber(body.planned_qty ?? body.planned_qty_kg);
      if (newQty) {
        const { error: poUpdateErr } = await serviceRoleClient
          .schema("erp_production")
          .from("process_order")
          .update({
            planned_qty: newQty,
            last_updated_at: new Date().toISOString(),
            last_updated_by: ctx.auth_user_id,
          })
          .eq("id", id);
        if (poUpdateErr) {
          console.error("[process_order.updateProcessOrderLines] order update failed:", JSON.stringify(poUpdateErr));
          throw new Error("PROD_PO_LINE_UPDATE_FAILED");
        }
      }
    }

    return okResponse({ id }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PO_LINE_UPDATE_FAILED";
    return poErr(req, ctx, code, 500, "Lines update failed");
  }
}

export async function qaApproveProcessOrderHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    // ACL-gated via route-acl-registry (PROD_QA_QUEUE:APPROVE) — no longer a
    // blanket Manager/SA rank check; department grants are actually enforced.
    const id = getIdFromPath(req);
    if (!id) return poErr(req, ctx, "PROD_PO_ID_MISSING", 400, "ID required");

    const po = await fetchProcessOrder(id);
    if (!po) return poErr(req, ctx, "PROD_PO_NOT_FOUND", 404, "Not found");
    try {
      await assertCompanyScope(ctx, String(po.company_id ?? ""));
    } catch {
      return poErr(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }
    if (!(await canMaintainCompanyResource(ctx, String(po.company_id ?? ""), "PROD_QA_QUEUE", "APPROVE"))) {
      return poErr(req, ctx, "PROD_PO_COMPANY_ACCESS_DENIED", 403, "You do not have QA approval access for this company.");
    }
    if (po.status !== "STANDARD") {
      return poErr(req, ctx, "PROD_PO_STATUS_INVALID", 422, `Expected STANDARD, got ${po.status}`);
    }
    // Locked 2026-08-12: INT skips QA entirely (Standard -> Final directly, no batch
    // number, no Start Batch) — it never had a QA step to approve/reject in the first
    // place, so surface a clear error instead of silently accepting a no-op transition.
    if (po.po_type === "INT") {
      return poErr(req, ctx, "PROD_PO_QA_NOT_APPLICABLE", 422, "INT Process Orders skip QA approval — finalize directly from STANDARD");
    }
    // §131.1 (2026-08-26): MTEST also skips this step — Start Batch now requires exactly
    // STANDARD for MTEST (matching MTS), not QA_APPROVED. Approving here would move status
    // to QA_APPROVED and strand the PO — Start Batch would then reject it, since it no
    // longer accepts QA_APPROVED as MTEST's required status.
    if (po.po_type === "MTEST") {
      return poErr(req, ctx, "PROD_PO_QA_NOT_APPLICABLE", 422, "MTEST Process Orders skip QA approval — start batch directly from STANDARD");
    }

    const lines = await fetchOrderLines(id, toTrimmedString(po.stroke_master_id) || null);
    if (lines.length === 0) {
      return poErr(req, ctx, "PROD_PO_NO_LINES", 422, "Cannot approve without RM lines");
    }

    const now = new Date().toISOString();
    const { error } = await serviceRoleClient
      .schema("erp_production")
      .from("process_order")
      .update({
        status: "QA_APPROVED",
        qa_decided_by: ctx.auth_user_id,
        qa_decided_at: now,
        last_updated_at: now,
        last_updated_by: ctx.auth_user_id,
      })
      .eq("id", id);
    if (error) {
      console.error("[process_order.qaApproveProcessOrder] update failed:", JSON.stringify(error));
      throw new Error("PROD_PO_QA_APPROVE_FAILED");
    }

    return okResponse({ id, status: "QA_APPROVED" }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PO_QA_APPROVE_FAILED";
    return poErr(req, ctx, code, 500, "QA approve failed");
  }
}

export async function qaRejectProcessOrderHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    // ACL-gated via route-acl-registry (PROD_QA_QUEUE:APPROVE) — no longer a
    // blanket Manager/SA rank check; department grants are actually enforced.
    const id = getIdFromPath(req);
    if (!id) return poErr(req, ctx, "PROD_PO_ID_MISSING", 400, "ID required");

    const po = await fetchProcessOrder(id);
    if (!po) return poErr(req, ctx, "PROD_PO_NOT_FOUND", 404, "Not found");
    try {
      await assertCompanyScope(ctx, String(po.company_id ?? ""));
    } catch {
      return poErr(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }
    if (!(await canMaintainCompanyResource(ctx, String(po.company_id ?? ""), "PROD_QA_QUEUE", "APPROVE"))) {
      return poErr(req, ctx, "PROD_PO_COMPANY_ACCESS_DENIED", 403, "You do not have QA approval access for this company.");
    }
    if (po.status !== "STANDARD") {
      return poErr(req, ctx, "PROD_PO_STATUS_INVALID", 422, `Expected STANDARD, got ${po.status}`);
    }
    if (po.po_type === "INT") {
      return poErr(req, ctx, "PROD_PO_QA_NOT_APPLICABLE", 422, "INT Process Orders skip QA approval — use Reverse instead of QA Reject");
    }

    const body = await parseBody(req);
    const reason = toTrimmedString(body.reason);
    if (!reason) {
      return poErr(req, ctx, "PROD_QA_REJECT_REASON_MISSING", 400, "reason required");
    }

    const now = new Date().toISOString();
    const { error: updateErr } = await serviceRoleClient
      .schema("erp_production")
      .from("process_order")
      .update({
        status: "CANCELLED",
        qa_rejection_reason: reason,
        qa_decided_by: ctx.auth_user_id,
        qa_decided_at: now,
        prune_reason: reason,
        pruned_by: ctx.auth_user_id,
        pruned_at: now,
        last_updated_at: now,
        last_updated_by: ctx.auth_user_id,
      })
      .eq("id", id);
    if (updateErr) {
      console.error("[process_order.qaRejectProcessOrder] process order update failed:", JSON.stringify(updateErr));
      throw new Error("PROD_PO_QA_REJECT_FAILED");
    }

    await cancelOpenReservationsForProcessOrder(id, ctx.auth_user_id, now);

    return okResponse({ id, status: "CANCELLED" }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PO_QA_REJECT_FAILED";
    return poErr(req, ctx, code, 500, "QA reject failed");
  }
}

export async function startBatchHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const id = getIdFromPath(req);
    if (!id) return poErr(req, ctx, "PROD_PO_ID_MISSING", 400, "ID required");

    const po = await fetchProcessOrder(id);
    if (!po) return poErr(req, ctx, "PROD_PO_NOT_FOUND", 404, "Not found");
    try {
      await assertCompanyScope(ctx, String(po.company_id ?? ""));
    } catch {
      return poErr(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }
    // §131.2 (2026-08-26): MTEST is QA-exclusive, gated by its own resource code —
    // PROD_START_BATCH itself stays Production-only for MTO/HPS/MTS, unchanged.
    const startBatchResourceCode = po.po_type === "MTEST" ? "PROD_MTEST_START_BATCH" : "PROD_START_BATCH";
    if (!(await canMaintainCompanyResource(ctx, String(po.company_id ?? ""), startBatchResourceCode, "WRITE"))) {
      return poErr(req, ctx, "PROD_PO_COMPANY_ACCESS_DENIED", 403, "You do not have Start Batch access for this company.");
    }

    // §131.1 (2026-08-26): MTEST joins MTS in skipping the QA_APPROVED gate — QA is the
    // only actor on an MTEST PO end to end, so there is no separate "QA approves" step to wait for.
    const requiredStatus = (po.po_type === "MTS" || po.po_type === "MTEST") ? "STANDARD" : "QA_APPROVED";
    if (po.status !== requiredStatus) {
      return poErr(req, ctx, "PROD_PO_STATUS_INVALID", 422, `Must be ${requiredStatus} to start batch`);
    }

    const batchTypeMap: Record<string, string> = {
      MTO: "MTO",
      HPS: "HPS",
      MTS: "MTS",
      MTEST: "MTEST",
    };
    const batchType = batchTypeMap[String(po.po_type)];
    if (!batchType) {
      return poErr(req, ctx, "PROD_PO_STATUS_INVALID", 422, `Unsupported po_type for batch start: ${po.po_type}`);
    }

    const body = await parseBody(req);
    const selectedBatchNumberInstanceId = toTrimmedString(body.batch_number_instance_id) || null;
    const skipReleasedBatch = body.skip_released_batch === true;
    const companyId = String(po.company_id);
    const prodshadeId = batchType === "MTS" ? String(po.material_id ?? "") : null;
    const releasedOptions = await findReleasedBatchNumberInstances(companyId, batchType);
    let batchNumber = "";

    if (selectedBatchNumberInstanceId) {
      const reused = await activateReleasedBatchNumberInstance({
        instanceId: selectedBatchNumberInstanceId,
        companyId,
        poType: batchType,
        prodshadeMaterialId: prodshadeId,
        processOrderId: id,
        authUserId: ctx.auth_user_id,
      });
      if (!reused) {
        return poErr(req, ctx, "PROD_BATCH_NUMBER_RELEASE_NOT_FOUND", 422, "Selected released batch number is no longer available");
      }
      batchNumber = reused.batch_number;
    } else if (releasedOptions.length > 0 && !skipReleasedBatch) {
      // Caller hasn't explicitly chosen to skip yet — surface the choice instead of silently picking one.
      return poErr(req, ctx, "PROD_BATCH_RELEASED_AVAILABLE", 409, "Released batch numbers are available for this company and PO type");
    } else {
      batchNumber = await generateBatchNumber(companyId, batchType, prodshadeId);
    }
    const now = new Date().toISOString();

    const { error } = await serviceRoleClient
      .schema("erp_production")
      .from("process_order")
      .update({
        status: "BATCH_STARTED",
        batch_number: batchNumber,
        batch_started_at: now,
        batch_started_by: ctx.auth_user_id,
        last_updated_at: now,
        last_updated_by: ctx.auth_user_id,
      })
      .eq("id", id);
    if (error) {
      console.error("[process_order.startBatch] update failed:", JSON.stringify(error));
      throw new Error("PROD_PO_START_BATCH_FAILED");
    }

    await upsertBatchNumberInstanceForProcessOrder({
      companyId,
      poType: batchType,
      prodshadeMaterialId: prodshadeId,
      batchNumber,
      processOrderId: id,
      authUserId: ctx.auth_user_id,
      status: "ACTIVE",
    });

    return okResponse({ id, status: "BATCH_STARTED", batch_number: batchNumber }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PO_START_BATCH_FAILED";
    return poErr(req, ctx, code, 500, `Start batch failed: ${err instanceof Error ? err.message : ""}`);
  }
}

export async function editProcessOrderHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const id = getIdFromPath(req);
    if (!id) return poErr(req, ctx, "PROD_PO_ID_MISSING", 400, "ID required");

    const po = await fetchProcessOrder(id);
    if (!po) return poErr(req, ctx, "PROD_PO_NOT_FOUND", 404, "Not found");
    try {
      await assertCompanyScope(ctx, String(po.company_id ?? ""));
    } catch {
      return poErr(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }
    if (!(await canMaintainCompanyResource(ctx, String(po.company_id ?? ""), "PROD_PO_EDIT", "EDIT"))) {
      return poErr(req, ctx, "PROD_PO_COMPANY_ACCESS_DENIED", 403, "You do not have edit access to Process PO for this company.");
    }
    if (!["MTO", "HPS"].includes(String(po.po_type ?? "").toUpperCase())) {
      return poErr(req, ctx, "PROD_PO_EDIT_TYPE_INVALID", 422, "PR10 edit is available only for MTO or HPS Process POs");
    }
    if (String(po.status ?? "").toUpperCase() !== "STANDARD") {
      return poErr(req, ctx, "PROD_PO_EDIT_STATUS_INVALID", 422, "PR10 edit is available only at STANDARD status");
    }

    const body = await parseBody(req);
    const machineId = Object.prototype.hasOwnProperty.call(body, "machine_id")
      ? (toTrimmedString(body.machine_id) || null)
      : undefined;
    const nextPlannedQty = Object.prototype.hasOwnProperty.call(body, "planned_qty") || Object.prototype.hasOwnProperty.call(body, "planned_qty_kg")
      ? parsePositiveNumber(body.planned_qty ?? body.planned_qty_kg)
      : null;
    const lines = Array.isArray(body.lines) ? (body.lines as JsonRecord[]) : [];
    const existingLines = await fetchOrderLines(id, toTrimmedString(po.stroke_master_id) || null);
    const existingReservationMap = await fetchReservationRowsBySourceLineIds(existingLines.map((line) => String(line.id)));
    const allowedAlternateMap = await fetchAllowedAlternateIdsByStroke(
      toTrimmedString(po.stroke_master_id) || null,
      "[process_order.editProcessOrder]",
      "PROD_PO_FETCH_FAILED",
    );
    const now = new Date().toISOString();

    if (machineId !== undefined && machineId) {
      const machine = await fetchMachine(String(po.company_id), machineId);
      if (!machine || machine.active !== true) {
        return poErr(req, ctx, "PROD_PO_MACHINE_INVALID", 422, "machine_id must belong to the company and be active");
      }
    }

    if ((Object.prototype.hasOwnProperty.call(body, "planned_qty") || Object.prototype.hasOwnProperty.call(body, "planned_qty_kg")) && nextPlannedQty === null) {
      return poErr(req, ctx, "PROD_PO_INVALID", 400, "planned_qty must be a positive number");
    }

    const linePatchMap = new Map<string, JsonRecord>();
    for (const line of lines) {
      const lineId = toTrimmedString(line.id);
      if (lineId) linePatchMap.set(lineId, line);
    }

    const targetPlannedQty = nextPlannedQty ?? Number(po.planned_qty ?? 0);
    const finalLineStates: Array<{
      line: JsonRecord;
      nextActualMaterialId: string | null;
      nextStorageLocationId: string | null;
      nextPlannedQty: number;
    }> = [];
    for (const line of existingLines) {
      const bodyLine = linePatchMap.get(String(line.id)) ?? null;
      const currentActualMaterialId = toTrimmedString(line.actual_material_id) || null;
      let nextActualMaterialId = Object.prototype.hasOwnProperty.call(bodyLine ?? {}, "actual_material_id")
        ? (toTrimmedString(bodyLine?.actual_material_id) || null)
        : currentActualMaterialId;
      const allowedAlternateIds = new Set(allowedAlternateMap.get(String(line.material_id)) ?? []);
      if (!nextActualMaterialId || nextActualMaterialId === String(line.material_id)) {
        nextActualMaterialId = null;
      }
      if (nextActualMaterialId && !allowedAlternateIds.has(nextActualMaterialId)) {
        return poErr(req, ctx, "PROD_PO_SUBSTITUTE_NOT_REGISTERED", 422, "actual_material_id must match the registered alternate");
      }

      const nextStorageLocationId = Object.prototype.hasOwnProperty.call(bodyLine ?? {}, "storage_location_id")
        ? (toTrimmedString(bodyLine?.storage_location_id) || null)
        : (toTrimmedString(line.issue_sloc_id) || null);
      const recalculatedPlannedQty = Number(line.dosage_pct ?? 0) > 0
        ? ((Number(line.dosage_pct ?? 0) / 100) * targetPlannedQty)
        : Number(line.planned_qty ?? 0);

      finalLineStates.push({
        line,
        nextActualMaterialId,
        nextStorageLocationId,
        nextPlannedQty: recalculatedPlannedQty,
      });
    }

    const needed = new Map<string, AvailabilityNeed>();
    for (const lineState of finalLineStates) {
      const effectiveMaterialId = lineState.nextActualMaterialId || String(lineState.line.material_id);
      const storageLocationId = lineState.nextStorageLocationId;
      if (!effectiveMaterialId || !storageLocationId || lineState.nextPlannedQty <= 0) continue;
      const key = buildAvailabilityKey(effectiveMaterialId, storageLocationId);
      const current = needed.get(key);
      needed.set(key, {
        materialId: effectiveMaterialId,
        storageLocationId,
        qty: (current?.qty ?? 0) + lineState.nextPlannedQty,
      });
    }

    const short = applyReservationCreditsToAvailabilityRows(
      await computeAvailabilityRows(String(po.company_id), needed),
      buildReservationCreditMap(existingReservationMap.values()),
    ).filter((row) => row.short);
    if (short.length > 0) {
      const detail = await formatShortageDetail(short);
      return poErr(req, ctx, "PROD_PO_INSUFFICIENT_STOCK", 422, `Insufficient UNRESTRICTED stock for ${short.length} material(s): ${detail}`);
    }

    const poPatch: Record<string, unknown> = {
      last_updated_at: now,
      last_updated_by: ctx.auth_user_id,
    };
    if (machineId !== undefined) poPatch.machine_id = machineId;
    if (nextPlannedQty !== null && !qtysEffectivelyMatch(Number(po.planned_qty ?? 0), nextPlannedQty)) {
      poPatch.planned_qty = nextPlannedQty;
    }

    const shouldUpdatePo = Object.keys(poPatch).length > 2 || machineId !== undefined;
    if (shouldUpdatePo) {
      const { error: machineErr } = await serviceRoleClient
        .schema("erp_production")
        .from("process_order")
        .update(poPatch)
        .eq("id", id);
      if (machineErr) {
        console.error("[process_order.editProcessOrder] process-order update failed:", JSON.stringify(machineErr));
        throw new Error("PROD_PO_LINE_UPDATE_FAILED");
      }
    }

    for (const lineState of finalLineStates) {
      const line = lineState.line;
      const reservation = existingReservationMap.get(String(line.id)) ?? null;
      const currentStorageLocationId = toTrimmedString(line.issue_sloc_id) || null;
      const currentActualMaterialId = toTrimmedString(line.actual_material_id) || null;
      const nextActualMaterialId = lineState.nextActualMaterialId;
      const nextStorageLocationId = lineState.nextStorageLocationId;

      if (nextStorageLocationId && nextStorageLocationId !== currentStorageLocationId) {
        if (reservation && RESERVATION_OPEN_STATUSES.includes(String(reservation.status ?? ""))) {
          const { error: reservationLocationErr } = await serviceRoleClient
            .schema("erp_production")
            .from("reservation_document")
            .update({
              storage_location_id: nextStorageLocationId,
              last_updated_by: ctx.auth_user_id,
              last_updated_at: now,
            })
            .eq("id", reservation.id as string);
          if (reservationLocationErr) {
            console.error("[process_order.editProcessOrder] reservation location update failed:", JSON.stringify(reservationLocationErr));
            throw new Error("PROD_PO_LINE_UPDATE_FAILED");
          }
          existingReservationMap.set(String(line.id), {
            ...reservation,
            storage_location_id: nextStorageLocationId,
          });
        }
      }

      if (nextActualMaterialId !== currentActualMaterialId) {
        if (reservation && RESERVATION_OPEN_STATUSES.includes(String(reservation.status ?? ""))) {
          const { error: cancelReservationErr } = await serviceRoleClient
            .schema("erp_production")
            .from("reservation_document")
            .update({
              status: "CANCELLED",
              last_updated_by: ctx.auth_user_id,
              last_updated_at: now,
            })
            .eq("id", reservation.id as string);
          if (cancelReservationErr) {
            console.error("[process_order.editProcessOrder] reservation cancel failed:", JSON.stringify(cancelReservationErr));
            throw new Error("PROD_PO_LINE_UPDATE_FAILED");
          }

          const swapMaterialId = nextActualMaterialId || String(line.material_id);
          const { data: insertedReservation, error: insertReservationErr } = await serviceRoleClient
            .schema("erp_production")
            .from("reservation_document")
            .insert({
              source_type: "PROCESS_PO",
              source_id: id,
              source_line_id: line.id,
              company_id: po.company_id,
              material_id: swapMaterialId,
              storage_location_id: nextStorageLocationId ?? reservation.storage_location_id ?? currentStorageLocationId ?? null,
              required_qty: lineState.nextPlannedQty,
              uom_code: reservation.uom_code ?? line.uom_code ?? "KG",
              required_by_date: toTrimmedString(po.planned_start_date) || null,
              issued_qty: 0,
              status: "OPEN",
              created_by: ctx.auth_user_id,
              created_at: now,
              last_updated_by: ctx.auth_user_id,
              last_updated_at: now,
            })
            .select("id, source_line_id, material_id, required_qty, issued_qty, balance_qty, status, storage_location_id, uom_code")
            .single();
          if (insertReservationErr) {
            console.error("[process_order.editProcessOrder] reservation insert failed:", JSON.stringify(insertReservationErr));
            throw new Error("PROD_PO_LINE_UPDATE_FAILED");
          }
          existingReservationMap.set(String(line.id), (insertedReservation ?? {}) as JsonRecord);
        }
      } else if (reservation && RESERVATION_ACTIVE_STATUSES.includes(String(reservation.status ?? ""))) {
        const { error: reservationQtyErr } = await serviceRoleClient
          .schema("erp_production")
          .from("reservation_document")
          .update({
            required_qty: lineState.nextPlannedQty,
            last_updated_at: now,
            last_updated_by: ctx.auth_user_id,
          })
          .eq("id", reservation.id as string);
        if (reservationQtyErr) {
          console.error("[process_order.editProcessOrder] reservation qty update failed:", JSON.stringify(reservationQtyErr));
          throw new Error("PROD_PO_LINE_UPDATE_FAILED");
        }
      }

      const { error: lineErr } = await serviceRoleClient
        .schema("erp_production")
        .from("process_order_line")
        .update({
          planned_qty: lineState.nextPlannedQty,
          actual_material_id: nextActualMaterialId,
          issue_sloc_id: nextStorageLocationId ?? currentStorageLocationId,
        })
        .eq("id", line.id as string)
        .eq("process_order_id", id);
      if (lineErr) {
        console.error("[process_order.editProcessOrder] line update failed:", JSON.stringify(lineErr));
        throw new Error("PROD_PO_LINE_UPDATE_FAILED");
      }
    }

    return okResponse({ id }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PO_LINE_UPDATE_FAILED";
    const status = [
      "PROD_PO_EDIT_STATUS_INVALID",
      "PROD_PO_EDIT_TYPE_INVALID",
      "PROD_PO_MACHINE_INVALID",
      "PROD_PO_INSUFFICIENT_STOCK",
      "PROD_PO_SUBSTITUTE_NOT_REGISTERED",
    ].includes(code)
      ? 422
      : code === "PROD_PO_INVALID"
      ? 400
      : 500;
    return poErr(req, ctx, code, status, "Edit failed");
  }
}

export async function finalizeProcessOrderHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const id = getIdFromPath(req);
    if (!id) return poErr(req, ctx, "PROD_PO_ID_MISSING", 400, "ID required");

    const po = await fetchProcessOrder(id);
    if (!po) return poErr(req, ctx, "PROD_PO_NOT_FOUND", 404, "Not found");
    try {
      await assertCompanyScope(ctx, String(po.company_id ?? ""));
    } catch {
      return poErr(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }
    // §131.2 (2026-08-26): MTEST is QA-exclusive, gated by its own resource code —
    // PROD_PO_FINAL itself stays Production-only for MTO/HPS/MTS/INT, unchanged. This
    // one gate now covers both the Final write AND the Verify-equivalent posting that
    // follows it for MTEST (§131.1) — there is no separate PROD_MTEST_PO_VERIFY,
    // deliberately, since for MTEST that's the same single QA action as Final.
    const finalResourceCode = po.po_type === "MTEST" ? "PROD_MTEST_PO_FINAL" : "PROD_PO_FINAL";
    if (!(await canMaintainCompanyResource(ctx, String(po.company_id ?? ""), finalResourceCode, "WRITE"))) {
      return poErr(req, ctx, "PROD_PO_COMPANY_ACCESS_DENIED", 403, "You do not have Final posting access for this company.");
    }
    // Locked 2026-08-12: INT skips QA and Start Batch entirely (no batch number, per
    // §83.5) so it finalizes directly from STANDARD. Every other po_type still needs
    // BATCH_STARTED (reached via Start Batch — MTEST skips the QA_APPROVED gate before
    // that per §131.1, but still needs BATCH_STARTED to reach Final). MTEST does NOT use
    // the postsAtFinal/INT branch below (its posting shape — RM+PM+SFG+QI-release+reco —
    // is nothing like INT's simple RM-only output) — instead, after the generic FINAL
    // write further down runs, MTEST calls runProcessOrderVerify() directly (see the
    // po.po_type === "MTEST" branch right after that write) so Final absorbs Verify in
    // one request, same posting logic verifyProcessOrderHandler uses for MTO/HPS/MTS.
    const requiredStatus = po.po_type === "INT" ? "STANDARD" : "BATCH_STARTED";
    if (po.status !== requiredStatus) {
      return poErr(req, ctx, "PROD_PO_STATUS_INVALID", 422, `Must be ${requiredStatus} to finalize`);
    }

    const body = await parseBody(req);
    const actualQty = parsePositiveNumber(body.actual_qty ?? body.actual_qty_kg);
    if (!actualQty) {
      return poErr(req, ctx, "PROD_PO_ACTUAL_QTY_REQUIRED", 400, "actual_qty required");
    }

    const applyResult = await applyFinalOrVerifyLineUpdates({
      req,
      ctx,
      po,
      bodyLines: Array.isArray(body.lines) ? (body.lines as JsonRecord[]) : [],
      plannedStartDate: toTrimmedString(po.planned_start_date) || null,
    });
    if (applyResult.response) return applyResult.response;

    const allLines = applyResult.lines ?? [];
    const stockNeeds = buildLineAvailabilityNeeds(allLines);
    const physicalRows = await computePhysicalAvailabilityRows(String(po.company_id), stockNeeds, id);
    const shortRows = physicalRows.filter((row) => row.short);

    if (shortRows.length > 0) {
      const materialTypeById = new Map<string, string>();
      for (const line of allLines) {
        const effectiveMaterialId = toTrimmedString(line.actual_material_id) || String(line.material_id ?? "");
        const effectiveMaterial = (toTrimmedString(line.actual_material_id)
          ? line.actual_material
          : line.material) as JsonRecord | null;
        if (effectiveMaterialId && effectiveMaterial?.material_type) {
          materialTypeById.set(effectiveMaterialId, String(effectiveMaterial.material_type));
        }
      }

      const nonIntShortages = shortRows.filter((row) => materialTypeById.get(row.material_id) !== "INT");
      if (nonIntShortages.length > 0) {
        return poErr(
          req,
          ctx,
          "PROD_PO_INSUFFICIENT_STOCK",
          422,
          `Insufficient UNRESTRICTED stock for ${nonIntShortages.length} material(s): ${await formatShortageDetail(nonIntShortages)}`,
        );
      }

      const intNeeded = new Map<string, number>();
      for (const row of shortRows) {
        intNeeded.set(row.material_id, (intNeeded.get(row.material_id) ?? 0) + (row.needed_qty - row.available_qty));
      }

      const { data: declaredIntPOs, error: intErr } = await serviceRoleClient
        .schema("erp_production")
        .from("process_order")
        .select("material_id, actual_qty")
        .eq("company_id", String(po.company_id))
        .eq("po_type", "INT")
        .in("status", ["FINAL", "VERIFIED"])
        .in("material_id", Array.from(intNeeded.keys()));
      if (intErr) {
        console.error("[process_order.finalize] declared-int query failed:", JSON.stringify(intErr));
        throw new Error("PROD_PO_FINALIZE_FAILED");
      }

      const declaredQty = new Map<string, number>();
      for (const intPo of (declaredIntPOs ?? []) as JsonRecord[]) {
        const materialId = String(intPo.material_id);
        declaredQty.set(materialId, (declaredQty.get(materialId) ?? 0) + Number(intPo.actual_qty ?? 0));
      }

      const unmet: string[] = [];
      for (const [materialId, neededQty] of intNeeded.entries()) {
        if ((declaredQty.get(materialId) ?? 0) < neededQty - EPSILON) {
          unmet.push(materialId);
        }
      }

      if (unmet.length > 0) {
        return poErr(req, ctx, "PROD_PO_INT_NOT_VERIFIED", 422, `INT material(s) short in stock and output not yet declared: ${await formatMaterialLabels(unmet)}. Finalize or verify the INT Process Orders first.`);
      }
    }

    // INT is the only po_type using THIS branch's simple direct-post shape (RM issue +
    // single output receipt, no reco, no QI hold). MTEST also now posts at Final
    // (§131.1, 2026-08-26, superseding the 2026-08-15/§120.1 Final-record/Verify-post
    // split this comment used to describe) but through the full MTO/HPS-shaped posting
    // (runProcessOrderVerify, called separately further below) — not this branch.
    const postsAtFinal = po.po_type === "INT";
    if (postsAtFinal) {
      const shopfloorSlocId = await resolveOutputStorageLocationId(toTrimmedString(po.stroke_master_id) || null, toTrimmedString(po.po_type) || null);
      if (!shopfloorSlocId) {
        return poErr(req, ctx, "PROD_PO_SHOPFLOOR_SLOC_MISSING", 422, "Output storage location not configured for this stroke/segment");
      }

      const today = todayIso();
      const docNumber = String(po.po_number);
      const postedBy = ctx.auth_user_id;
      const reservationMap = await fetchReservationRowsBySourceLineIds(allLines.map((line) => String(line.id)));
      const ledgerEntries: JsonRecord[] = [];

      // §106: one Material Document for this Final-posting event (RM issues + output
      // receipt); the Process PO number is the reference.
      const matDoc = await generateMaterialDocNumber(String(po.company_id));

      // §104.8: INT costs what its RM cost (real weighted-average issue rate, rolled up
      // into the output). INT remains the only Final-posting path here.
      const isInt = po.po_type === "INT";
      const rateMap = isInt
        ? await fetchUnrestrictedRates(
            String(po.company_id),
            allLines.map((line) => ({
              materialId: toTrimmedString(line.actual_material_id) || String(line.material_id),
              slocId: String(getIssueStorageLocationId(line) ?? ""),
            })),
          )
        : new Map<string, number>();
      let totalRmValue = 0;

      // DEPENDENT: all lines share the same brand-new Material Document number — the
      // FOR UPDATE item_number lock has nothing to serialize against on the first
      // insert, so concurrent posts would race on the same item_number. Post sequentially.
      for (const line of allLines) {
        const lineActualQty = Number(line.actual_qty ?? 0);
        if (lineActualQty <= 0) continue;
        const slocId = getIssueStorageLocationId(line);
        if (!slocId) {
          return poErr(req, ctx, "PROD_PO_SLOC_MISSING", 422, `Storage location missing for ${line.material_id}`);
        }
        const movementMaterialId = toTrimmedString(line.actual_material_id) || String(line.material_id);
        const baseUom = String(
          ((toTrimmedString(line.actual_material_id) ? line.actual_material : line.material) as JsonRecord | null)?.base_uom_code ?? line.uom_code ?? "KG",
        );
        const rmRate = isInt ? (rateMap.get(`${movementMaterialId}|${slocId}`) ?? 0) : 0;
        totalRmValue += lineActualQty * rmRate;

        const posting = await postStockMovement({
          documentNumber: docNumber,
          documentDate: today,
          postingDate: today,
          movementTypeCode: "P261",
          companyId: po.company_id,
          storageLocationId: slocId,
          materialId: movementMaterialId,
          quantity: lineActualQty,
          baseUomCode: baseUom,
          unitValue: rmRate,
          stockTypeCode: "UNRESTRICTED",
          direction: "OUT",
          postedBy,
          matDoc,
          referenceDocumentId: String(po.id),
        });

        const { error: lineLedgerErr } = await serviceRoleClient
          .schema("erp_production")
          .from("process_order_line")
          .update({ stock_ledger_id: posting.stock_ledger_id })
          .eq("id", line.id as string);
        if (lineLedgerErr) {
          console.error("[process_order.finalize] line ledger update failed:", JSON.stringify(lineLedgerErr));
          throw new Error("PROD_PO_FINALIZE_FAILED");
        }

        const reservation = reservationMap.get(String(line.id));
        if (reservation) {
          const { error: reservationErr } = await serviceRoleClient
            .schema("erp_production")
            .from("reservation_document")
            .update({
              issued_qty: Number(reservation.required_qty ?? 0),
              status: "FULLY_ISSUED",
              last_updated_at: new Date().toISOString(),
              last_updated_by: ctx.auth_user_id,
            })
            .eq("id", reservation.id as string);
          if (reservationErr) {
            console.error("[process_order.finalize] reservation update failed:", JSON.stringify(reservationErr));
            throw new Error("PROD_PO_FINALIZE_FAILED");
          }
        }

        ledgerEntries.push({ line_id: line.id, movement: "P261", direction: "OUT", ...posting });
      }

      const fgUom = await fetchProductionMaterialBaseUom(String(po.material_id));
      let outputUnitValue = 0;
      if (isInt) {
        // §104.8 (LOCKED 2026-07-18): INT conversion cost is optional/data-driven — a
        // missing rate means 0-and-proceed (contrast Verify's hard block for SFG).
        const conversionRate = (await resolveConversionRate(
          String(po.company_id), String(po.segment_code ?? ""), String(po.material_id), today,
        )) ?? 0;
        outputUnitValue = actualQty > 0 ? (totalRmValue / actualQty) + conversionRate : conversionRate;
      }

      const fgPosting = await postStockMovement({
        documentNumber: docNumber,
        documentDate: today,
        postingDate: today,
        movementTypeCode: "P101",
        companyId: po.company_id,
        storageLocationId: shopfloorSlocId,
        materialId: po.material_id,
        quantity: actualQty,
        baseUomCode: fgUom,
        unitValue: outputUnitValue,
        stockTypeCode: "UNRESTRICTED",
        direction: "IN",
        postedBy,
        matDoc,
        referenceDocumentId: String(po.id),
      });

      const now = new Date().toISOString();
      const { error: poUpdateErr } = await serviceRoleClient
        .schema("erp_production")
        .from("process_order")
        .update({
          status: "VERIFIED",
          actual_qty: actualQty,
          fg_stock_ledger_id: fgPosting.stock_ledger_id,
          finalized_at: now,
          finalized_by: ctx.auth_user_id,
          verified_at: now,
          verified_by: ctx.auth_user_id,
          has_unapproved_deviation: applyResult.hasUnapprovedDeviation ?? false,
          last_updated_at: now,
          last_updated_by: ctx.auth_user_id,
        })
        .eq("id", id);
      if (poUpdateErr) {
        console.error("[process_order.finalize] process-order update failed:", JSON.stringify(poUpdateErr));
        throw new Error("PROD_PO_FINALIZE_FAILED");
      }

      return okResponse({
        id,
        status: "VERIFIED",
        verified_qty: actualQty,
        ledger_entries: [...ledgerEntries, { movement: "P101", direction: "IN", ...fgPosting }],
      }, ctx.request_id, req);
    }

    const now = new Date().toISOString();
    const { error } = await serviceRoleClient
      .schema("erp_production")
      .from("process_order")
      .update({
        status: "FINAL",
        actual_qty: actualQty,
        finalized_at: now,
        finalized_by: ctx.auth_user_id,
        has_unapproved_deviation: applyResult.hasUnapprovedDeviation ?? false,
        last_updated_at: now,
        last_updated_by: ctx.auth_user_id,
      })
      .eq("id", id);
    if (error) {
      console.error("[process_order.finalize] update failed:", JSON.stringify(error));
      throw new Error("PROD_PO_FINALIZE_FAILED");
    }

    // §131.1 (2026-08-26): MTEST's Final absorbs Verify — QA is the only actor on an
    // MTEST PO end to end, so there is no separate "QA verifies" click to wait for.
    // The FINAL write just above still ran (so finalized_at/finalized_by/actual_qty
    // are set exactly like every other po_type), then this immediately runs the same
    // posting logic verifyProcessOrderHandler would — same as a user clicking Final
    // and then Verify back-to-back, just in one request. `po.status` in memory is
    // still BATCH_STARTED here; runProcessOrderVerify doesn't re-check it (only
    // verifyProcessOrderHandler's own status gate does), so that's fine.
    if (po.po_type === "MTEST") {
      return await runProcessOrderVerify(req, ctx, po, id, allLines, actualQty, applyResult.hasUnapprovedDeviation ?? false);
    }

    return okResponse({ id, status: "FINAL" }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PO_FINALIZE_FAILED";
    return poErr(req, ctx, code, 500, "Finalize failed");
  }
}

export async function verifyProcessOrderHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    // ACL-gated via route-acl-registry (PROD_PO_VERIFY:APPROVE) — no longer a
    // blanket Manager/SA rank check; department grants are actually enforced.
    const id = getIdFromPath(req);
    if (!id) return poErr(req, ctx, "PROD_PO_ID_MISSING", 400, "ID required");

    const po = await fetchProcessOrder(id);
    if (!po) return poErr(req, ctx, "PROD_PO_NOT_FOUND", 404, "Not found");
    try {
      await assertCompanyScope(ctx, String(po.company_id ?? ""));
    } catch {
      return poErr(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }
    if (po.status !== "FINAL") {
      return poErr(req, ctx, "PROD_PO_STATUS_INVALID", 422, "Must be at FINAL to verify");
    }

    const body = await parseBody(req);
    const verifiedQty = parsePositiveNumber(body.verified_qty ?? body.verified_qty_kg) ?? Number(po.actual_qty ?? 0);
    const applyResult = await applyFinalOrVerifyLineUpdates({
      req,
      ctx,
      po,
      bodyLines: Array.isArray(body.lines) ? (body.lines as JsonRecord[]) : [],
      plannedStartDate: toTrimmedString(po.planned_start_date) || null,
    });
    if (applyResult.response) return applyResult.response;

    const lines = applyResult.lines ?? await fetchOrderLines(id, toTrimmedString(po.stroke_master_id) || null);
    return await runProcessOrderVerify(req, ctx, po, id, lines, verifiedQty, applyResult.hasUnapprovedDeviation ?? false);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PO_VERIFY_FAILED";
    return poErr(req, ctx, code, 500, `Verify failed: ${err instanceof Error ? err.message : ""}`);
  }
}

// §131.1 (2026-08-26): extracted so finalizeProcessOrderHandler can run this same
// posting logic for MTEST immediately after its own Final write, in one request —
// MTEST's Final absorbs Verify (no separate QA click), everything else (MTO/HPS/MTS)
// still reaches this only through the standalone verifyProcessOrderHandler above.
// Nothing here changed except: (a) this signature, (b) the MTEST conversion-rate
// exemption noted below. The posting/reco/costing logic is byte-for-byte the same.
async function runProcessOrderVerify(
  req: Request,
  ctx: ProdHandlerContext,
  po: JsonRecord,
  id: string,
  lines: JsonRecord[],
  verifiedQty: number,
  hasUnapprovedDeviation: boolean,
): Promise<Response> {
  const stockNeeds = buildLineAvailabilityNeeds(lines);
    const shortRows = (await computePhysicalAvailabilityRows(String(po.company_id), stockNeeds, id)).filter((row) => row.short);
    if (shortRows.length > 0) {
      return poErr(
        req,
        ctx,
        "PROD_PO_INSUFFICIENT_STOCK",
        422,
        `Insufficient UNRESTRICTED stock for ${shortRows.length} material(s): ${await formatShortageDetail(shortRows)}`,
      );
    }

    const shopfloorSlocId = await resolveOutputStorageLocationId(toTrimmedString(po.stroke_master_id) || null, toTrimmedString(po.po_type) || null);
    if (!shopfloorSlocId) {
      return poErr(req, ctx, "PROD_PO_SHOPFLOOR_SLOC_MISSING", 422, "Output storage location not configured for this stroke/segment");
    }

    const today = todayIso();
    const docNumber = String(po.po_number);
    const postedBy = ctx.auth_user_id;
    const batchNumber = toTrimmedString(po.batch_number) || null;
    // Collected here, posted once at the end via post_document — nothing below
    // touches the database until that single transactional call.
    const movements: MovementSpec[] = [];
    const reservationUpdates: Array<{ reservation_id: string; issued_qty: number; status: string }> = [];
    const reservationMap = await fetchReservationRowsBySourceLineIds(lines.map((line) => String(line.id)));

    // §106: one Material Document for the whole Verify event — every RM/INT issue (P261),
    // the SFG receipt (P101) and the QI auto-release (P321) are items under it; the
    // Process PO number is the reference.
    const verifyMatDoc = await generateMaterialDocNumber(String(po.company_id));

    // §104.8: valuation inputs, resolved once up front.
    // (a) each RM/INT's current UNRESTRICTED rate (issues post at cost, roll up into RMC).
    const rateMap = await fetchUnrestrictedRates(
      String(po.company_id),
      lines
        .filter((line) => Number(line.actual_qty ?? line.planned_qty ?? 0) > 0)
        .map((line) => ({
          materialId: toTrimmedString(line.actual_material_id) || String(line.material_id),
          slocId: getIssueStorageLocationId(line) ?? "",
        })),
    );
    // (b) conversion rate/KG — HARD-BLOCK if not configured for this segment/prodshade/date.
    // §131.1 (2026-08-26): MTEST is exempt — lab samples have no conversion cost concept,
    // same "0-and-proceed" treatment INT already gets, rather than blocking the posting.
    const rawConversionRate = await resolveConversionRate(
      String(po.company_id), String(po.segment_code ?? ""), String(po.material_id), today,
    );
    if (rawConversionRate === null && po.po_type !== "MTEST") {
      return poErr(req, ctx, "PROD_PO_CONVERSION_RATE_MISSING", 422,
        "Conversion cost rate is not configured for this segment/prodshade as of the posting date. Set it in the Conversion Cost config before verifying (Section 104.8).");
    }
    const conversionRate = rawConversionRate ?? 0;
    let totalRmValue = 0;

    for (const line of lines) {
      const actualQty = Number(line.actual_qty ?? line.planned_qty ?? 0);
      if (actualQty <= 0) continue;

      const slocId = getIssueStorageLocationId(line);
      if (!slocId) {
        return poErr(req, ctx, "PROD_PO_SLOC_MISSING", 422, `Storage location missing for ${String((line.material as JsonRecord | null)?.pace_code ?? line.material_id)}`);
      }

      const movementMaterialId = toTrimmedString(line.actual_material_id) || String(line.material_id);
      const movementMaterial = (toTrimmedString(line.actual_material_id)
        ? line.actual_material
        : line.material) as JsonRecord | null;
      const baseUom = String(movementMaterial?.base_uom_code ?? line.uom_code ?? "KG");

      // §104.8: issue at the material's current cost (not 0) and accumulate the RM value
      // that rolls up into the SFG cost/KG below.
      const rmRate = rateMap.get(`${movementMaterialId}|${slocId}`) ?? 0;
      totalRmValue += actualQty * rmRate;

      // IDEMPOTENCY (CLAUDE.md 8D): this line already posted during an earlier attempt that
      // died before the handler finished. Without this guard a retry re-issues the same P261
      // AND overwrites stock_ledger_id below, orphaning the first posting so no later CORS
      // reversal could undo it — and reservation issued_qty would be added twice.
      //
      // ⚠️ Placed AFTER totalRmValue accumulates, deliberately. The RM value must be summed
      // over EVERY line regardless of whether it posts on this pass, because it feeds
      // sfgCostPerKg below. Skipping earlier would silently understate the SFG cost on any
      // retry. Everything past this point is posting + its two bookkeeping updates, so
      // `continue` here is safe.
      //
      // Safe against a legitimate re-run: Verify only accepts status FINAL, and a CORS
      // reversal ends at REVERSED (never back to FINAL), so a verified line is never meant
      // to post again. fetchOrderLines() selects stock_ledger_id on every path into this
      // handler, so the guard cannot silently no-op.
      if (toTrimmedString(line.stock_ledger_id)) continue;

      // Collected, not posted. Array order is still the posting order, and post_document
      // applies them in that order — DEPENDENT per §8B, since the negative-stock guard
      // depends on what came before. The line's own id is the line_ref, which is how
      // complete_process_po_verify writes the resulting ledger id back to this row.
      movements.push(toMovement({
        documentNumber: docNumber,
        documentDate: today,
        postingDate: today,
        movementTypeCode: "P261",
        companyId: po.company_id,
        storageLocationId: slocId,
        materialId: movementMaterialId,
        quantity: actualQty,
        baseUomCode: baseUom,
        unitValue: rmRate,
        stockTypeCode: "UNRESTRICTED",
        direction: "OUT",
        postedBy,
        batchNumber,
        matDoc: verifyMatDoc,
        referenceDocumentId: String(po.id),
      }, String(line.id)));

      // Reservation arithmetic is unchanged — still computed here, just applied inside
      // the transaction instead of in its own round trip.
      const reservation = reservationMap.get(String(line.id));
      if (reservation && RESERVATION_OPEN_STATUSES.includes(String(reservation.status ?? ""))) {
        const issuedQty = Number(reservation.issued_qty ?? 0) + actualQty;
        const requiredQty = Number(reservation.required_qty ?? 0);
        reservationUpdates.push({
          reservation_id: String(reservation.id),
          issued_qty: issuedQty,
          status: issuedQty >= requiredQty - EPSILON ? "FULLY_ISSUED" : "PARTIAL",
        });
      }
    }

    // §104.8: SFG cost/KG = RMC/KG + Conversion/KG. This is the value the SFG enters stock at.
    const sfgCostPerKg = verifiedQty > 0 ? (totalRmValue / verifiedQty) + conversionRate : conversionRate;

    const fgUom = await fetchProductionMaterialBaseUom(String(po.material_id));
    // Receipt into QUALITY_INSPECTION at the computed SFG cost (weighted-avg on IN).
    movements.push(toMovement({
      documentNumber: docNumber,
      documentDate: today,
      postingDate: today,
      movementTypeCode: "P101",
      companyId: po.company_id,
      storageLocationId: shopfloorSlocId,
      materialId: po.material_id,
      quantity: verifiedQty,
      baseUomCode: fgUom,
      unitValue: sfgCostPerKg,
      stockTypeCode: "QUALITY_INSPECTION",
      direction: "IN",
      postedBy,
      batchNumber,
      matDoc: verifyMatDoc,
      referenceDocumentId: String(po.id),
    }, "FG"));

    // §104 BUGFIX (2026-07-18): the QI→Unrestricted release used to post ONLY the IN leg to
    // UNRESTRICTED and never drained QUALITY_INSPECTION, so every verified batch left its full
    // qty phantom-stuck in QI (double-counted). The release is a transfer and needs BOTH legs
    // (the pattern Inward QA already uses): P321 OUT of QI, then P321 IN to Unrestricted. Net
    // QI = 0. On OUT unit_value is ignored for the snapshot (QI drains at its own rate); the IN
    // below folds the SFG cost into Unrestricted. The CORS reverse path adds the mirror leg
    // (P321 IN-QI restore) so it stays balanced.
    movements.push(toMovement({
      documentNumber: docNumber,
      documentDate: today,
      postingDate: today,
      movementTypeCode: "P321",
      companyId: po.company_id,
      storageLocationId: shopfloorSlocId,
      materialId: po.material_id,
      quantity: verifiedQty,
      baseUomCode: fgUom,
      unitValue: sfgCostPerKg,
      stockTypeCode: "QUALITY_INSPECTION",
      direction: "OUT",
      postedBy,
      batchNumber,
      matDoc: verifyMatDoc,
      referenceDocumentId: String(po.id),
    }, "QI_OUT"));

    movements.push(toMovement({
      documentNumber: docNumber,
      documentDate: today,
      postingDate: today,
      movementTypeCode: "P321",
      companyId: po.company_id,
      storageLocationId: shopfloorSlocId,
      materialId: po.material_id,
      quantity: verifiedQty,
      baseUomCode: fgUom,
      unitValue: sfgCostPerKg,
      stockTypeCode: "UNRESTRICTED",
      direction: "IN",
      postedBy,
      batchNumber,
      matDoc: verifyMatDoc,
      referenceDocumentId: String(po.id),
    }, "QI_RELEASE"));

    const strokeNumber = toTrimmedString((po.stroke as JsonRecord | null)?.stroke_number) || null;
    // §108.2 item 5 — MTS has no Approved/AP-Approved reco workflow at all (its real
    // costing is dispatch-triggered, formulation-based, quarterly — feasibility §108.4);
    // writing production-time reco rows here would just be dead, unused data. Skip the
    // reco doc number too, so MTS Verify never burns a RECO series number for nothing.
    const isMtsProcessOrder = po.po_type === "MTS";
    // §106 Phase 3: one Reco/Costing document (BELNR+GJAHR equivalent) for this Verify
    // costing event; every line row below shares it, tagged source_txn_type='PRODUCTION'.
    const recoRows: JsonRecord[] = [];
    if (!isMtsProcessOrder) {
      const recoDoc = await generateRecoDocNumber(String(po.company_id));
      recoRows.push(...lines.map((line) => ({
        company_id: po.company_id,
        po_number: po.po_number,
        batch_number: po.batch_number,
        po_type: po.po_type,
        prodshade_material_id: po.material_id,
        stroke_number: strokeNumber,
        machine_id: po.machine_id ?? null,
        segment_code: po.segment_code ?? null,
        batch_started_at: po.batch_started_at ?? null,
        verified_at: new Date().toISOString(),
        process_order_id: po.id,
        process_order_line_id: line.id,
        material_id: line.material_id,
        line_material_type: (line.material as JsonRecord | null)?.material_type === "INT" ? "INT" : "RM",
        dosage_pct: line.dosage_pct ?? null,
        actual_material_id: line.actual_material_id ?? null,
        storage_location_id: line.issue_sloc_id ?? null,
        standard_qty: line.planned_qty ?? null,
        actual_qty: Number(line.actual_qty ?? line.planned_qty ?? 0),
        approved_status: line.approved_status ?? "YES",
        ap_approved_qty: Number(line.ap_approved_qty ?? line.actual_qty ?? line.planned_qty ?? 0),
        variance_qty: Number(line.variance_qty ?? 0),
        is_formulation_line: line.is_formulation_line !== false,
        is_voided: false,
        // §106 Phase 3: this Verify is the costing event that produced these rows.
        reco_document_number: recoDoc.docNumber,
        reco_document_year: recoDoc.docYear,
        source_txn_type: "PRODUCTION",
        reference_document_number: String(po.po_number),
        reference_document_type: "PROC_PO",
        last_updated_at: new Date().toISOString(),
        last_updated_by: ctx.auth_user_id,
      })));
    }

    /* ---------------------------------------------------------------------
     * ONE transaction (CLAUDE.md 8D, feasibility §107.8).
     *
     * Everything above only COLLECTED — nothing has touched the database yet.
     * This single call posts all movements in order and then runs the registered
     * completion function (erp_production.complete_process_po_verify), which
     * writes the line ledger ids, the reservation issues, the reco rows and the
     * VERIFIED header — all inside the same transaction.
     *
     * Previously this was ~31 separate round trips, each its own commit, so a
     * failure part-way left stock half-issued with the order still at FINAL and a
     * retry re-posting whatever had already gone through. Now it is all-or-nothing.
     *
     * Note the arithmetic did not move: sfgCostPerKg, the reco rows and the
     * reservation quantities are still computed above exactly as before and are
     * handed over as a prepared payload. Only where they get persisted changed,
     * so §104 costing cannot drift because of this.
     * ------------------------------------------------------------------- */
    const postings = await postDocument({
      referenceDocumentType: "PROC_PO",
      referenceDocumentId: String(po.id),
      movements,
      postedBy,
      context: {
        header: {
          actual_qty: verifiedQty,
          verified_by: ctx.auth_user_id,
          last_updated_by: ctx.auth_user_id,
          has_unapproved_deviation: hasUnapprovedDeviation,
        },
        reservations: reservationUpdates,
        reco_rows: recoRows,
      },
    });

    return okResponse({
      id,
      status: "VERIFIED",
      batch_number: po.batch_number,
      verified_qty: verifiedQty,
      // Rebuilt from what the transaction actually wrote, rather than accumulated
      // as we went — the response now reports committed facts, not intentions.
      ledger_entries: postings.map((p) => ({
        line_id: ["FG", "QI_OUT", "QI_RELEASE"].includes(p.line_ref) ? null : p.line_ref,
        movement: p.line_ref === "FG" ? "P101" : p.line_ref === "QI_OUT" || p.line_ref === "QI_RELEASE" ? "P321" : "P261",
        direction: p.line_ref === "FG" || p.line_ref === "QI_RELEASE" ? "IN" : "OUT",
        stock_document_id: p.stock_document_id,
        stock_ledger_id: p.stock_ledger_id,
      })),
    }, ctx.request_id, req);
}

const RM_CORRECTION_MOVEMENT_TYPES = new Set(["P261", "P262"]);
const OUTPUT_CORRECTION_MOVEMENT_TYPES = new Set(["P101", "P102"]);

// POST /api/production/process-orders/:id/correct
// COR6-style post-Verify correction (locked 2026-08-12, corrected same day —
// business owner overrode the original sign-decides-direction design): the caller
// sends a positive QUANTITY plus an explicit `movement_type` the user picked from a
// dropdown (P261/P262 for RM+INT lines, P101/P102 for the output) — the handler
// never infers direction from a number's sign. Mirrors correctPackingOrderHandler's
// shape (same explicit-movement-type rule, same "original leg's own rate" costing
// rule, same append-only posting, no reservation involvement since Verify already
// closed those) adapted for Process PO's own line shape: `lines` corrects
// existing/new RM+INT input lines, `output_delta_qty`+`output_movement_type`
// (optional) corrects the SFG/INT output itself, which — unlike Packing PO's FG —
// is a header field on process_order, not its own line row. A brand-new line (no
// `id`) has no prior posting to reverse, so it must use P261 (increase).
export async function correctProcessOrderHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const id = getIdFromPath(req);
    if (!id) return poErr(req, ctx, "PROD_PO_ID_MISSING", 400, "ID required");

    const po = await fetchProcessOrder(id);
    if (!po) return poErr(req, ctx, "PROD_PO_NOT_FOUND", 404, "Not found");
    try {
      await assertCompanyScope(ctx, String(po.company_id ?? ""));
    } catch {
      return poErr(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }
    if (!(await canMaintainCompanyResource(ctx, String(po.company_id ?? ""), "PROD_PO_VERIFY", "APPROVE"))) {
      return poErr(req, ctx, "PROD_PO_COMPANY_ACCESS_DENIED", 403, "You do not have Verify/correction access for this company.");
    }
    if (po.status !== "VERIFIED") {
      return poErr(req, ctx, "PROD_PO_CORRECTION_STATUS_INVALID", 422, "Process PO must be VERIFIED to correct");
    }

    const body = await parseBody(req);
    const corrections = Array.isArray(body.lines) ? (body.lines as JsonRecord[]) : [];
    // Locked 2026-08-12 (corrected same day, business owner override): the user picks the
    // movement type themselves from a dropdown — the qty field is always a positive
    // magnitude, never a signed delta. "10 + P261" = issue 10 more; "10 + P262" = reverse
    // 10 back. Same rule for the output correction below (P101/P102).
    const outputMagnitude = Math.abs(Number(body.output_delta_qty ?? 0));
    const outputMovementType = toTrimmedString(body.output_movement_type);
    if (outputMagnitude > 0 && !OUTPUT_CORRECTION_MOVEMENT_TYPES.has(outputMovementType)) {
      return poErr(req, ctx, "PROD_PO_CORRECTION_MOVEMENT_TYPE_INVALID", 400, "output_movement_type must be P101 or P102");
    }
    if (corrections.length === 0 && outputMagnitude === 0) {
      return poErr(req, ctx, "PROD_PO_CORRECTION_INVALID", 400, "At least one line correction or an output correction is required");
    }

    const existingLines = await fetchOrderLines(id, toTrimmedString(po.stroke_master_id) || null);
    const lineMap = new Map(existingLines.map((line) => [String(line.id), line]));

    // Rates: existing lines/output reuse the ORIGINAL posting's own rate (§104.8 — a
    // decrease must reverse the exact value it removed; an increase adds at the same
    // per-KG cost the batch was already booked at). New lines have no prior posting to
    // reuse, so they rate at the CURRENT UNRESTRICTED rate, same as a fresh Verify line.
    const existingLedgerIds = [
      ...existingLines.map((line) => toTrimmedString(line.stock_ledger_id)),
      toTrimmedString(po.fg_stock_ledger_id),
    ];
    const ledgerRefByLedgerId = await resolveStockLedgerRefsByLedgerIds(existingLedgerIds);

    const newLineNeeds: Array<{ materialId: string; storageLocationId: string; qty: number }> = [];
    for (const correction of corrections) {
      if (toTrimmedString(correction.id)) continue;
      const materialId = toTrimmedString(correction.material_id);
      const slocId = toTrimmedString(correction.storage_location_id);
      const magnitude = Math.abs(Number(correction.delta_qty ?? 0));
      const movementType = toTrimmedString(correction.movement_type);
      if (!materialId) return poErr(req, ctx, "PROD_PO_CORRECTION_MATERIAL_REQUIRED", 400, "material_id required for a new correction line");
      if (!slocId) return poErr(req, ctx, "PROD_PO_CORRECTION_SLOC_REQUIRED", 400, "storage_location_id required for a new correction line");
      if (magnitude <= 0) return poErr(req, ctx, "PROD_PO_CORRECTION_INVALID", 400, "A new line must be added with a positive quantity");
      if (movementType !== "P261") return poErr(req, ctx, "PROD_PO_CORRECTION_INVALID", 400, "A new line has no prior posting to reverse — movement_type must be P261");
      newLineNeeds.push({ materialId, storageLocationId: slocId, qty: magnitude });
    }
    const rateMap = newLineNeeds.length > 0
      ? await fetchUnrestrictedRates(String(po.company_id), newLineNeeds.map((n) => ({ materialId: n.materialId, slocId: n.storageLocationId })))
      : new Map<string, number>();

    const materialMap = await getMaterialMapByIds(
      [
        ...existingLines.map((line) => toTrimmedString(line.actual_material_id) || String(line.material_id ?? "")),
        ...newLineNeeds.map((n) => n.materialId),
        String(po.material_id ?? ""),
      ],
      "[process_order.correctProcessOrder]",
      "PROD_PO_CORRECTION_FAILED",
      "id, base_uom_code, material_type",
    );

    const today = todayIso();
    const docNumber = String(po.po_number);
    const postedBy = ctx.auth_user_id;
    // §106: this COR6 correction is its own Material Document event; the Process PO
    // number is the reference — same pattern as Verify's own matDoc.
    const correctionMatDoc = await generateMaterialDocNumber(String(po.company_id));
    // §108.2 — MTS/INT/MTEST have no Approved/AP-Approved reco workflow at all (same
    // exemption PR11 Final already applies for these three po_types): a correction-time
    // reco row would just be dead, unused data for them.
    const skipReco = ["MTS", "INT"].includes(String(po.po_type ?? ""));
    const recoRows: JsonRecord[] = [];
    const postings: JsonRecord[] = [];
    let newLineDisplayOffset = 0;

    // DEPENDENT: every leg shares one brand-new Material Document number — the first
    // insert for it has nothing to lock yet, so parallel posts would race on the same
    // item_number. Post sequentially (same reasoning as correctPackingOrderHandler).
    for (const correction of corrections) {
      const lineId = toTrimmedString(correction.id);
      const magnitude = Math.abs(Number(correction.delta_qty ?? 0));
      if (magnitude === 0) continue;
      const movementType = toTrimmedString(correction.movement_type);
      if (!RM_CORRECTION_MOVEMENT_TYPES.has(movementType)) {
        return poErr(req, ctx, "PROD_PO_CORRECTION_MOVEMENT_TYPE_INVALID", 400, `movement_type must be P261 or P262 for line ${lineId || "new"}`);
      }
      const isIncrease = movementType === "P261";
      // Signed only for bookkeeping (actual_qty delta, reco variance) — the RPC always
      // gets a positive quantity; direction comes from the user's own movement_type pick.
      const delta = isIncrease ? magnitude : -magnitude;

      let materialId: string;
      let slocId: string | null;
      let baseUom: string;
      let rate: number;
      let reversalOfId: string | null = null;
      let existingLine: JsonRecord | null = null;

      if (lineId) {
        existingLine = lineMap.get(lineId) ?? null;
        if (!existingLine) return poErr(req, ctx, "PROD_PO_LINE_NOT_FOUND", 404, `Line ${lineId} not found on this Process PO`);
        materialId = toTrimmedString(existingLine.actual_material_id) || String(existingLine.material_id ?? "");
        slocId = getIssueStorageLocationId(existingLine);
        const mat = materialMap.get(materialId) ?? {};
        baseUom = (mat.base_uom_code ?? "KG") as string;
        const ledgerRef = ledgerRefByLedgerId.get(toTrimmedString(existingLine.stock_ledger_id)) ?? null;
        rate = ledgerRef?.rate ?? 0;
        if (!isIncrease) {
          reversalOfId = ledgerRef?.docId ?? null;
          if (!reversalOfId) return poErr(req, ctx, "PROD_PO_REVERSAL_SOURCE_NOT_FOUND", 422, `No original posting found for line ${lineId} to reverse`);
        }
      } else {
        materialId = toTrimmedString(correction.material_id);
        slocId = toTrimmedString(correction.storage_location_id);
        const mat = materialMap.get(materialId) ?? {};
        baseUom = (mat.base_uom_code ?? "KG") as string;
        rate = rateMap.get(`${materialId}|${slocId}`) ?? 0;
      }
      if (!slocId) return poErr(req, ctx, "PROD_PO_SLOC_MISSING", 422, `Storage location missing for correction line ${lineId || materialId}`);

      const posting = await postStockMovement({
        documentNumber: docNumber,
        documentDate: today,
        postingDate: today,
        movementTypeCode: movementType,
        companyId: po.company_id,
        storageLocationId: slocId,
        materialId,
        quantity: magnitude,
        baseUomCode: baseUom,
        unitValue: rate,
        stockTypeCode: "UNRESTRICTED",
        direction: isIncrease ? "OUT" : "IN",
        postedBy,
        reversalOfId,
        batchNumber: toTrimmedString(po.batch_number) || null,
        matDoc: correctionMatDoc,
        referenceDocumentId: String(po.id),
      });

      if (existingLine) {
        // Deliberately does NOT touch stock_ledger_id here (matches
        // correctPackingOrderHandler) — that column identifies the line's ORIGINAL
        // Verify-time posting, which every future correction's rate/reversal lookup
        // (ledgerRefByLedgerId, built above) still needs to resolve back to. This
        // correction's own posting is tracked only via the `postings` response array.
        const newActual = Number(existingLine.actual_qty ?? existingLine.planned_qty ?? 0) + delta;
        await serviceRoleClient.schema("erp_production").from("process_order_line")
          .update({ actual_qty: newActual }).eq("id", lineId as string);
      } else {
        // A brand-new line has no prior posting, so its own first correction posting
        // IS its "original" — store it, exactly like a normal Verify-created line would.
        const { data: insertedLine, error: insertErr } = await serviceRoleClient
          .schema("erp_production").from("process_order_line")
          .insert({
            process_order_id: id,
            material_id: materialId,
            planned_qty: 0,
            actual_qty: delta,
            uom_code: baseUom,
            issue_sloc_id: slocId,
            is_rm: true,
            display_order: 1000 + existingLines.length + newLineDisplayOffset++,
            is_formulation_line: false,
            stock_ledger_id: posting.stock_ledger_id,
          })
          .select("id").single();
        if (insertErr) {
          console.error("[process_order.correctProcessOrder] new line insert failed:", JSON.stringify(insertErr));
          throw new Error("PROD_PO_CORRECTION_FAILED");
        }
        existingLine = { id: (insertedLine as JsonRecord).id, material_id: materialId };
      }

      postings.push({ line_id: existingLine.id, movement: movementType, direction: isIncrease ? "OUT" : "IN", ...posting });

      if (!skipReco) {
        const approvedInput = toTrimmedString(correction.approved_status) || null;
        const apApprovedInput = parsePositiveNumber(correction.ap_approved_qty);
        // A correction delta has no Std of its own (it IS the deviation) — approval is
        // always mandatory here, never auto-YES (same rule correctPackingOrderHandler
        // already uses for its PM correction deltas).
        const approved = (approvedInput === "NO" || approvedInput === "PARTIAL") ? approvedInput : "YES";
        const apApproved = approved === "NO" ? 0 : approved === "PARTIAL" ? (apApprovedInput ?? 0) : delta;
        const variance = delta - apApproved;
        const mat = materialMap.get(materialId) ?? {};
        recoRows.push({
          company_id: po.company_id,
          po_number: po.po_number,
          batch_number: po.batch_number,
          po_type: po.po_type,
          prodshade_material_id: po.material_id,
          machine_id: po.machine_id ?? null,
          segment_code: po.segment_code ?? null,
          process_order_id: po.id,
          process_order_line_id: existingLine.id,
          material_id: materialId,
          line_material_type: mat.material_type === "INT" ? "INT" : "RM",
          standard_qty: 0,
          actual_qty: delta,
          approved_status: approved,
          ap_approved_qty: apApproved,
          variance_qty: variance,
          is_formulation_line: false,
          is_voided: false,
          source_txn_type: "COR6_CORRECTION",
          reference_document_number: String(po.po_number),
          reference_document_type: "PROC_PO",
          last_updated_at: new Date().toISOString(),
          last_updated_by: ctx.auth_user_id,
        });
      }
    }

    // Output (SFG/INT) correction — a header field on process_order, not its own line
    // row (unlike Packing PO's FG, which IS a packing_order_line). Posts straight to
    // UNRESTRICTED, mirroring where Verify's own P321 QI-release already lands it —
    // no QI leg here, the batch is long past that gate.
    if (outputMagnitude > 0) {
      const isIncrease = outputMovementType === "P101";
      const outputDelta = isIncrease ? outputMagnitude : -outputMagnitude;
      const shopfloorSlocId = await resolveOutputStorageLocationId(toTrimmedString(po.stroke_master_id) || null, toTrimmedString(po.po_type) || null);
      if (!shopfloorSlocId) return poErr(req, ctx, "PROD_PO_SHOPFLOOR_SLOC_MISSING", 422, "Output storage location not configured for this stroke/segment");
      const fgUom = await fetchProductionMaterialBaseUom(String(po.material_id));
      const fgLedgerRef = ledgerRefByLedgerId.get(toTrimmedString(po.fg_stock_ledger_id)) ?? null;
      let reversalOfId: string | null = null;
      if (!isIncrease) {
        reversalOfId = fgLedgerRef?.docId ?? null;
        if (!reversalOfId) return poErr(req, ctx, "PROD_PO_REVERSAL_SOURCE_NOT_FOUND", 422, "No original SFG/output posting found to reverse");
      }
      const posting = await postStockMovement({
        documentNumber: docNumber,
        documentDate: today,
        postingDate: today,
        movementTypeCode: outputMovementType,
        companyId: po.company_id,
        storageLocationId: shopfloorSlocId,
        materialId: po.material_id,
        quantity: outputMagnitude,
        baseUomCode: fgUom,
        unitValue: fgLedgerRef?.rate ?? 0,
        stockTypeCode: "UNRESTRICTED",
        direction: isIncrease ? "IN" : "OUT",
        postedBy,
        reversalOfId,
        batchNumber: toTrimmedString(po.batch_number) || null,
        matDoc: correctionMatDoc,
        referenceDocumentId: String(po.id),
      });
      postings.push({ line_id: "OUTPUT", movement: outputMovementType, direction: isIncrease ? "IN" : "OUT", ...posting });

      const newOutputQty = Number(po.actual_qty ?? 0) + outputDelta;
      await serviceRoleClient.schema("erp_production").from("process_order")
        .update({ actual_qty: newOutputQty, fg_stock_ledger_id: posting.stock_ledger_id, last_updated_at: new Date().toISOString(), last_updated_by: ctx.auth_user_id })
        .eq("id", id);
    }

    if (recoRows.length > 0) {
      const recoDoc = await generateRecoDocNumber(String(po.company_id));
      for (const row of recoRows) {
        row.reco_document_number = recoDoc.docNumber;
        row.reco_document_year = recoDoc.docYear;
      }
      const { error: recoErr } = await serviceRoleClient.schema("erp_production").from("process_order_line_reco").insert(recoRows);
      if (recoErr) {
        console.error("[process_order.correctProcessOrder] reco insert failed:", JSON.stringify(recoErr));
        throw new Error("PROD_PO_RECO_WRITE_FAILED");
      }
    }

    return okResponse({ id, corrections: postings }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PO_CORRECTION_FAILED";
    const status = ["PROD_PO_LINE_NOT_FOUND"].includes(code) ? 404 : code.includes("REQUIRED") || code.includes("INVALID") || code.includes("MISSING") || code.includes("NOT_FOUND") ? 422 : 500;
    return poErr(req, ctx, code, status, `Process PO correction failed: ${err instanceof Error ? err.message : ""}`);
  }
}

export async function reverseProcessOrderHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    // ACL-gated via route-acl-registry (PROD_REVERSAL:APPROVE) — no longer a
    // blanket Manager/SA rank check; department grants are actually enforced.
    const id = getIdFromPath(req);
    if (!id) return poErr(req, ctx, "PROD_PO_ID_MISSING", 400, "ID required");

    const po = await fetchProcessOrder(id);
    if (!po) return poErr(req, ctx, "PROD_PO_NOT_FOUND", 404, "Not found");
    try {
      await assertCompanyScope(ctx, String(po.company_id ?? ""));
    } catch {
      return poErr(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }
    if (!(await canMaintainCompanyResource(ctx, String(po.company_id ?? ""), "PROD_REVERSAL", "APPROVE"))) {
      return poErr(req, ctx, "PROD_PO_COMPANY_ACCESS_DENIED", 403, "You do not have reversal access for this company.");
    }
    if (po.status === "REVERSED") return poErr(req, ctx, "PROD_PO_ALREADY_REVERSED", 409, "Already reversed");

    const body = await parseBody(req);
    const reason = toTrimmedString(body.reason);
    if (!reason) {
      return poErr(req, ctx, "PROD_PO_REVERSE_REASON_REQUIRED", 400, "Reason required for CORS reversal");
    }

    const { count, error: packingErr } = await serviceRoleClient
      .schema("erp_production")
      .from("packing_order")
      .select("id", { count: "exact", head: true })
      .eq("process_order_id", id)
      .neq("status", "REVERSED") as { count?: number; error?: unknown };
    if (packingErr) {
      console.error("[process_order.reverse] packing-order count failed:", JSON.stringify(packingErr));
      throw new Error("PROD_PO_REVERSE_FAILED");
    }
    if ((count ?? 0) > 0) {
      return poErr(req, ctx, "PROD_PO_HAS_PACKING_ORDERS", 422, "Reverse all Packing Orders first");
    }

    const now = new Date().toISOString();
    const ledgerEntries: JsonRecord[] = [];
    const reversalBatchNumber = toTrimmedString(po.batch_number) || null;

    if (po.status === "VERIFIED") {
      const lines = await fetchOrderLines(id, toTrimmedString(po.stroke_master_id) || null);
      const { count: openingRecoCount, error: openingRecoErr } = await serviceRoleClient
        .schema("erp_production")
        .from("process_order_line_reco")
        .select("id", { count: "exact", head: true })
        .eq("process_order_id", id)
        .eq("source_txn_type", "OPENING") as { count?: number; error?: unknown };
      if (openingRecoErr) {
        console.error("[process_order.reverse] opening reco check failed:", JSON.stringify(openingRecoErr));
        throw new Error("PROD_PO_REVERSE_FAILED");
      }
      const isOpeningGenealogy = (openingRecoCount ?? 0) > 0;
      const today = todayIso();
      // §106: the CORS reversal is its own Material Document event (no more "-REV" suffix
      // hack) — all three reversal movements (P262 / P322 / P102) are items under it, and
      // the Process PO number is the reference.
      const revMatDoc = await generateMaterialDocNumber(String(po.company_id));
      const revDocNum = String(po.po_number);
      const reversalSourceLedgerIds = [
        ...lines.map((line) => toTrimmedString(line.stock_ledger_id)),
        toTrimmedString(po.qi_release_stock_ledger_id),
        toTrimmedString(po.fg_stock_ledger_id),
      ];
      const stockLedgerRefById = await resolveStockLedgerRefsByLedgerIds(reversalSourceLedgerIds);

      // DEPENDENT: each P262 reversal must follow the original issue lines one by one.
      for (const line of lines) {
        const actualQty = Number(line.actual_qty ?? 0);
        if (actualQty <= 0) continue;
        const slocId = getIssueStorageLocationId(line);
        if (!slocId) continue;

        const movementMaterialId = toTrimmedString(line.actual_material_id) || String(line.material_id);
        const movementMaterial = (toTrimmedString(line.actual_material_id)
          ? line.actual_material
          : line.material) as JsonRecord | null;
        const baseUom = String(movementMaterial?.base_uom_code ?? "KG");
        const lineRef = stockLedgerRefById.get(toTrimmedString(line.stock_ledger_id)) ?? null;
        if (!lineRef) {
          if (isOpeningGenealogy) continue;
          throw new Error("PROD_PO_REVERSAL_SOURCE_NOT_FOUND");
        }

        const posting = await postStockMovement({
          documentNumber: revDocNum,
          documentDate: today,
          postingDate: today,
          movementTypeCode: "P262",
          companyId: po.company_id,
          storageLocationId: slocId,
          materialId: movementMaterialId,
          quantity: actualQty,
          baseUomCode: baseUom,
          // §104.8: restore RM/PM at the original issue rate (an IN reversal at 0 would
          // dilute the material's weighted average toward zero).
          unitValue: lineRef.rate,
          stockTypeCode: "UNRESTRICTED",
          direction: "IN",
          postedBy: ctx.auth_user_id,
          reversalOfId: lineRef.docId,
          batchNumber: reversalBatchNumber,
          matDoc: revMatDoc,
          referenceDocumentId: String(po.id),
        });
        ledgerEntries.push({ line_id: line.id, movement: "P262", direction: "IN", ...posting });
      }

      const shopfloorSlocId = await resolveOutputStorageLocationId(toTrimmedString(po.stroke_master_id) || null, toTrimmedString(po.po_type) || null);
      const fgUom = await fetchProductionMaterialBaseUom(String(po.material_id));

      const qiReleaseRef = stockLedgerRefById.get(toTrimmedString(po.qi_release_stock_ledger_id)) ?? null;
      const fgReceiptRef = stockLedgerRefById.get(toTrimmedString(po.fg_stock_ledger_id)) ?? null;
      // §104.8: the SFG's own booked rate (RMC + Conversion), from its original P101/P321 legs.
      const sfgRate = fgReceiptRef?.rate ?? qiReleaseRef?.rate ?? 0;

      if (po.qi_release_stock_ledger_id && shopfloorSlocId) {
        if (!qiReleaseRef) throw new Error("PROD_PO_REVERSAL_SOURCE_NOT_FOUND");
        const p322Posting = await postStockMovement({
          documentNumber: revDocNum,
          documentDate: today,
          postingDate: today,
          movementTypeCode: "P322",
          companyId: po.company_id,
          storageLocationId: shopfloorSlocId,
          materialId: po.material_id,
          quantity: Number(po.actual_qty ?? 0),
          baseUomCode: fgUom,
          // OUT of UNRESTRICTED: snapshot consumes at the current rate (unit_value ignored),
          // but carry the SFG rate for ledger value symmetry with the original P321 release.
          unitValue: sfgRate,
          stockTypeCode: "UNRESTRICTED",
          direction: "OUT",
          postedBy: ctx.auth_user_id,
          reversalOfId: qiReleaseRef.docId,
          batchNumber: reversalBatchNumber,
          matDoc: revMatDoc,
          referenceDocumentId: String(po.id),
        });
        ledgerEntries.push({ movement: "P322", direction: "OUT", ...p322Posting });
      }

      // §104 BUGFIX mirror (2026-07-18): Verify now drains QI (P321 OUT-QI) so a verified
      // batch sits entirely in UNRESTRICTED with QI = 0. To keep the reverse balanced, restore
      // the batch into QI before the P102 OUT-of-QI below, so the P102 has stock to consume and
      // QI nets back to 0 (P321-IN-QI here + P102-OUT-QI cancel). Round-trip leg → no
      // reversalOfId. Guarded on qi_release_stock_ledger_id: only batches that went through the
      // (new) QI-drained release need this; older MTEST/INT-style receipts that never used QI
      // skip it and their P102 still comes straight from UNRESTRICTED (see stockTypeCode below).
      if (po.qi_release_stock_ledger_id && po.fg_stock_ledger_id && shopfloorSlocId) {
        const qiRestore = await postStockMovement({
          documentNumber: revDocNum,
          documentDate: today,
          postingDate: today,
          movementTypeCode: "P321",
          companyId: po.company_id,
          storageLocationId: shopfloorSlocId,
          materialId: po.material_id,
          quantity: Number(po.actual_qty ?? 0),
          baseUomCode: fgUom,
          // IN to QUALITY_INSPECTION: restore at the SFG's booked rate so the temporarily
          // re-inflated QI carries value (an IN at 0 would dilute QI toward zero); it nets
          // back to 0 with the P102 OUT-of-QI below.
          unitValue: sfgRate,
          stockTypeCode: "QUALITY_INSPECTION",
          direction: "IN",
          postedBy: ctx.auth_user_id,
          batchNumber: reversalBatchNumber,
          matDoc: revMatDoc,
          referenceDocumentId: String(po.id),
        });
        ledgerEntries.push({ movement: "P321", direction: "IN", ...qiRestore });
      }

      if (po.fg_stock_ledger_id && shopfloorSlocId) {
        if (!fgReceiptRef) throw new Error("PROD_PO_REVERSAL_SOURCE_NOT_FOUND");
        const p102Posting = await postStockMovement({
          documentNumber: revDocNum,
          documentDate: today,
          postingDate: today,
          movementTypeCode: "P102",
          companyId: po.company_id,
          storageLocationId: shopfloorSlocId,
          materialId: po.material_id,
          quantity: Number(po.actual_qty ?? 0),
          baseUomCode: fgUom,
          // OUT: snapshot consumes at the current rate (unit_value ignored); carry the SFG
          // rate for ledger value symmetry with the original P101 receipt.
          unitValue: sfgRate,
          stockTypeCode: po.qi_release_stock_ledger_id ? "QUALITY_INSPECTION" : "UNRESTRICTED",
          direction: "OUT",
          postedBy: ctx.auth_user_id,
          reversalOfId: fgReceiptRef.docId,
          batchNumber: reversalBatchNumber,
          matDoc: revMatDoc,
          referenceDocumentId: String(po.id),
        });
        ledgerEntries.push({ movement: "P102", direction: "OUT", ...p102Posting });
      }

      await cancelReservationsForProcessOrder(id, ctx.auth_user_id, now);

      const { error: recoErr } = await serviceRoleClient
        .schema("erp_production")
        .from("process_order_line_reco")
        .update({
          is_voided: true,
          voided_at: now,
          last_updated_at: now,
          last_updated_by: ctx.auth_user_id,
        })
        .eq("process_order_id", id)
        .eq("is_voided", false);
      if (recoErr) {
        console.error("[process_order.reverse] reco void failed:", JSON.stringify(recoErr));
        throw new Error("PROD_PO_REVERSE_FAILED");
      }
    } else if (["FINAL", "BATCH_STARTED", "QA_APPROVED", "STANDARD"].includes(String(po.status))) {
      await cancelReservationsForProcessOrder(id, ctx.auth_user_id, now);
    }

    const { error: poUpdateErr } = await serviceRoleClient
      .schema("erp_production")
      .from("process_order")
      .update({
        status: "REVERSED",
        reverse_reason: reason,
        reversed_by: ctx.auth_user_id,
        reversed_at: now,
        last_updated_at: now,
        last_updated_by: ctx.auth_user_id,
      })
      .eq("id", id);
    if (poUpdateErr) {
      console.error("[process_order.reverse] process-order update failed:", JSON.stringify(poUpdateErr));
      throw new Error("PROD_PO_REVERSE_FAILED");
    }

    const batchNumber = toTrimmedString(po.batch_number);
    if (batchNumber) {
      const batchType = toUpperTrimmedString(po.po_type);
      const prodshadeMaterialId = batchType === "MTS" ? String(po.material_id ?? "") : null;
      await upsertBatchNumberInstanceForProcessOrder({
        companyId: String(po.company_id),
        poType: batchType,
        prodshadeMaterialId,
        batchNumber,
        processOrderId: id,
        authUserId: ctx.auth_user_id,
        status: "VOIDED",
        voidedAt: now,
      });
    }

    return okResponse({ id, status: "REVERSED", ledger_entries: ledgerEntries }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PO_REVERSE_FAILED";
    return poErr(req, ctx, code, 500, `Reverse failed: ${err instanceof Error ? err.message : ""}`);
  }
}
