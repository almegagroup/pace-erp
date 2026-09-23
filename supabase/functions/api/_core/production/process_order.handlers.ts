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
  parsePositiveInt,
  getIdFromPath,
} from "./production.shared.ts";
import {
  activateReleasedBatchNumberInstance,
  bulkInsertBatchNumberInstances,
  findReleasedBatchNumberInstances,
  findDuplicateBatchNumbers,
  generateBatchNumber,
  isBatchSeriesAutoGenerate,
  resolveMtsBatchRangeNumbers,
  upsertBatchNumberInstanceForProcessOrder,
} from "./batch_series.handlers.ts";
import { generateGlobalDocNumber } from "./production.utils.ts";
import { fetchAllRows } from "../../_shared/fetchAllRows.ts";

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

// §136 (2026-09-04) — Urgent-only Verify posting date. Always Current date−1,
// automatic, no manual entry (business owner corrected 2026-09-04: no date
// input at Verify at all). Real execution still happens right now, in real
// chronological order; this is only a posting_date label — matching how
// dispatchBackfillPosting.ts's own Phase 1 already works, so WAR stays
// correct with no special ripple-recalculation.
function addDaysIso(input: string, days: number): string {
  const date = new Date(`${input}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// MTS Page 3 "Date" field (2026-09-17 lock) — declared physical-production
// date, current-3-days..current only, never future. Deliberately a separate,
// narrower window from manualDocumentDateWindow.ts's 3-CALENDAR-MONTH window
// (that one is for backdated documents generally; this is "which of the last
// few days did this actually run"). Informational only — Verify's own
// posting_date uses this value directly as a label, same pattern as the
// existing URGENT Current-1 label above; no derivation happens here.
const PRODUCTION_DATE_WINDOW_DAYS = 3;
const PRODUCTION_DATE_WINDOW_MESSAGE = "Date must be within the previous 3 days and cannot be in the future.";
function isProductionDateWithinWindow(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const today = todayIso();
  const lower = addDaysIso(today, -PRODUCTION_DATE_WINDOW_DAYS);
  return value >= lower && value <= today;
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
  keyForLine: (strokeLine: JsonRecord) => string = (strokeLine) => String(strokeLine.material_id ?? ""),
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

    const lineKey = keyForLine(strokeLine);
    if (lineKey) allowedMap.set(lineKey, Array.from(allowedIds));
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
      actual_material_id, dosage_pct, is_formulation_line, stroke_line_id,
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

// ---------------------------------------------------------------------------
// §138.12 — MTS Alternate-Group Auto-Derive (Page 4).
//
// Aggregates every machine-bucket (machine_id = a SPECIFIC machine, not NULL)
// machine_stock_log row into one running balance per material -- same
// derivation shape as location_transfer.handlers.ts's fetchUnassignedBuckets,
// just filtered to one machine instead of the shared Unassigned bucket. The
// §138.3 bucket boundary is structural here: this function never reads any
// row belonging to a different machine or to Unassigned.
// ---------------------------------------------------------------------------
export async function fetchMachineBucketBalances(
  companyId: string,
  storageLocationId: string,
  machineId: string | null,
  materialIds: string[],
): Promise<Map<string, number>> {
  const balances = new Map<string, number>();
  if (materialIds.length === 0) return balances;
  let rows: JsonRecord[];
  try {
    rows = await fetchAllRows<JsonRecord>((from, to) => {
      const query = serviceRoleClient
        .schema("erp_production")
        .from("machine_stock_log")
        .select("material_id, qty, direction")
        .eq("company_id", companyId)
        .eq("storage_location_id", storageLocationId)
        .in("material_id", materialIds);
      return machineId
        ? query.eq("machine_id", machineId).range(from, to)
        : query.is("machine_id", null).range(from, to);
    });
  } catch {
    throw new Error("PROD_PO_MACHINE_BUCKET_LOOKUP_FAILED");
  }
  for (const row of rows) {
    const materialId = toTrimmedString(row.material_id);
    if (!materialId) continue;
    const sign = toUpperTrimmedString(row.direction) === "OUT" ? -1 : 1;
    const qty = Number(row.qty ?? 0) * sign;
    balances.set(materialId, Number(((balances.get(materialId) ?? 0) + qty).toFixed(6)));
  }
  return balances;
}

// MTS Page 4 uses the same availability semantic as MTO/HPS/MTEST.  The
// machine (or Unassigned) bucket answers only "which physical shelf"; it
// does not bypass the ordinary open-reservation deduction for that material
// and storage location.  The caller may then allocate several formulation
// groups from the returned shared map without double-counting a bucket.
export async function fetchNetMachineBucketBalances(
  companyId: string,
  storageLocationId: string,
  machineId: string | null,
  materialIds: string[],
): Promise<Map<string, number>> {
  const balances = await fetchMachineBucketBalances(companyId, storageLocationId, machineId, materialIds);
  const ids = [...new Set(materialIds.filter(Boolean))];
  if (ids.length === 0) return balances;
  const { data, error } = await serviceRoleClient
    .schema("erp_production")
    .from("reservation_document")
    .select("material_id, balance_qty")
    .eq("company_id", companyId)
    .eq("storage_location_id", storageLocationId)
    .in("material_id", ids)
    .in("status", RESERVATION_OPEN_STATUSES);
  if (error) {
    console.error("[process_order.fetchNetMachineBucketBalances] reservation query failed:", JSON.stringify(error));
    throw new Error("PROD_PO_STOCK_CHECK_FAILED");
  }
  for (const row of (data ?? []) as JsonRecord[]) {
    const materialId = toTrimmedString(row.material_id);
    if (!materialId) continue;
    balances.set(materialId, Number(((balances.get(materialId) ?? 0) - Number(row.balance_qty ?? 0)).toFixed(6)));
  }
  return balances;
}

type MtsAutoDeriveRow = {
  stroke_line_id: string;
  stroke_line_material_id: string; // formulation/declared item — constant across a group's split rows
  actual_material_id: string; // real material this specific row draws from
  is_formulation_line: boolean; // true only on the first (Standard-carrying) row of the group
  dosage_pct: number | null;
  planned_qty: number; // Standard Qty — non-zero only on the first row
  actual_qty: number; // this row's own resolved qty
  available_qty: number; // this row's actual_material_id's own bucket/location balance (for display)
  variance_qty?: number; // Standard − confirmed-shortfall total, only set on the first row when the user explicitly accepted an under-qty save
};

type MtsAutoDeriveGroupResult = {
  stroke_line_id: string;
  stroke_line_material_id: string;
  auto_derive_applicable: boolean; // false = R001-style, non-machine-tracked, manual pick required
  storage_location_id: string;
  standard_qty: number;
  dosage_pct: number | null;
  rows: MtsAutoDeriveRow[];
  group_member_ids: string[]; // formulation item + registered alternates, for the manual-pick/override dropdown
  short: boolean; // whole group (formulation + alternates) insufficient vs standard_qty
  shortfall_qty: number;
};

// §138.12 algorithm: formulation item first (if its own bucket has stock),
// then group alternates smallest-available-first, each fully exhausted
// before moving to the next, until standardQty is met or the whole group is
// exhausted (hard block). Never reads Unassigned or another machine's bucket
// -- bucketBalances is expected to already be scoped that way by the caller.
export function computeMtsAutoDeriveRowsForGroup(params: {
  strokeLineId?: string;
  formulationMaterialId: string;
  dosagePct: number | null;
  standardQty: number;
  alternateMaterialIds: string[]; // group members excluding the formulation item itself
  bucketBalances: Map<string, number>;
}): { rows: MtsAutoDeriveRow[]; short: boolean; shortfallQty: number } {
  const { strokeLineId: requestedStrokeLineId, formulationMaterialId, dosagePct, standardQty, alternateMaterialIds, bucketBalances } = params;
  const strokeLineId = requestedStrokeLineId || formulationMaterialId;

  // Order: formulation item's own bucket first (regardless of size -- it's
  // the "correct" material, group is only a fallback), then alternates
  // smallest-available-first.
  const candidates = [
    formulationMaterialId,
    ...[...new Set(alternateMaterialIds)]
      .filter((id) => id !== formulationMaterialId)
      .sort((a, b) => (bucketBalances.get(a) ?? 0) - (bucketBalances.get(b) ?? 0)),
  ];

  const rows: MtsAutoDeriveRow[] = [];
  let remaining = standardQty;
  for (const materialId of candidates) {
    if (remaining <= EPSILON) break;
    const available = Math.max(0, bucketBalances.get(materialId) ?? 0);
    if (available <= EPSILON) continue;
    const draw = Math.min(available, remaining);
    rows.push({
      stroke_line_id: strokeLineId,
      stroke_line_material_id: formulationMaterialId,
      actual_material_id: materialId,
      is_formulation_line: rows.length === 0,
      dosage_pct: rows.length === 0 ? dosagePct : null,
      planned_qty: rows.length === 0 ? standardQty : 0,
      actual_qty: Number(draw.toFixed(6)),
      available_qty: Number(available.toFixed(6)),
    });
    remaining = Number((remaining - draw).toFixed(6));
  }

  const short = remaining > EPSILON;
  // A group that never found any stock at all (rows.length === 0) still
  // needs one row to carry the Standard Qty / hard-block detail -- reuses
  // the formulation item itself as a placeholder row (actual_qty 0).
  if (rows.length === 0) {
    rows.push({
      stroke_line_id: strokeLineId,
      stroke_line_material_id: formulationMaterialId,
      actual_material_id: formulationMaterialId,
      is_formulation_line: true,
      dosage_pct: dosagePct,
      planned_qty: standardQty,
      actual_qty: 0,
      available_qty: 0,
    });
  }

  return { rows, short, shortfallQty: short ? Number(remaining.toFixed(6)) : 0 };
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
  const approvedStatusRaw = toUpperTrimmedString(bodyLine.approved_status);

  // Business owner ask (2026-09-23): a line whose Actual happens to equal
  // Standard is no longer force-approved to YES -- the caller may still
  // explicitly choose NO/PARTIAL to bill AP less than what was physically
  // produced, decoupling the AP Reco layer from the physical-variance layer
  // (§104.7's two-layer Stock vs AP Reco model). Only auto-approve to YES
  // when the caller sends no explicit override at all -- this keeps the
  // original convenience (no decision needed for a line nobody touched)
  // without silently discarding an explicit PARTIAL/NO on a matching line.
  if (!approvedStatusRaw && qtysEffectivelyMatch(plannedQty, actualQty)) {
    return {
      approved_status: "YES",
      ap_approved_qty: actualQty,
      variance_qty: 0,
    };
  }

  const approvedStatus = approvedStatusRaw;
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
      // §138.17: MTS has no AP/Reco approval workflow. Split alternate rows
      // legitimately have Standard=0 with Actual>0, so the generic deviation
      // rule would otherwise reject a valid MTS Final/Verify payload merely
      // because its hidden Approved fields were not supplied.
      const approval = po.po_type === "MTS"
        ? { approved_status: "YES", ap_approved_qty: actualQty, variance_qty: 0 }
        : computeApprovalValues(req, ctx, plannedQty, actualQty, bodyLine);
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

  // Found live 2026-08-31 (CMP006, PROC_PO 9300000196 Finalize): summing raw
  // stock_ledger rows client-side silently truncated at PostgREST's default
  // 1000-row cap once a company's ledger history grew large enough -- a
  // material whose rows fell outside that window showed as "0 available"
  // even with hundreds of KG genuinely in stock (confirmed live via
  // diagnostic logging: ledgerRows count=1000 exactly). stock_snapshot
  // already maintains the current running balance per
  // (company, material, location, stock_type) as ONE row -- reading it
  // directly returns at most materialIds.length x locationIds.length rows,
  // nowhere near the cap, and is the same source of truth the WAR/costing
  // engine uses elsewhere (§104.6/104.8) instead of re-deriving it from history.
  const { data: snapshotRows, error: snapshotErr } = await serviceRoleClient
    .schema("erp_inventory")
    .from("stock_snapshot")
    .select("material_id, storage_location_id, quantity")
    .eq("company_id", companyId)
    .eq("stock_type_code", "UNRESTRICTED")
    .in("material_id", materialIds)
    .in("storage_location_id", locationIds);
  if (snapshotErr) {
    console.error("[process_order.checkStockAvailability] snapshot query failed:", JSON.stringify(snapshotErr));
    throw new Error("PROD_PO_STOCK_CHECK_FAILED");
  }

  const available = new Map<string, number>();
  for (const row of (snapshotRows ?? []) as JsonRecord[]) {
    const key = buildAvailabilityKey(String(row.material_id), String(row.storage_location_id));
    available.set(key, (available.get(key) ?? 0) + Number(row.quantity ?? 0));
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

  // Found live 2026-08-31 (CMP006, PROC_PO 9300000196 Finalize): summing raw
  // stock_ledger rows client-side silently truncated at PostgREST's default
  // 1000-row cap once a company's ledger history grew large enough -- a
  // material whose rows fell outside that window showed as "0 available"
  // even with hundreds of KG genuinely in stock (confirmed live via
  // diagnostic logging: ledgerRows count=1000 exactly). stock_snapshot
  // already maintains the current running balance per
  // (company, material, location, stock_type) as ONE row -- reading it
  // directly returns at most materialIds.length x locationIds.length rows,
  // nowhere near the cap, and is the same source of truth the WAR/costing
  // engine uses elsewhere (§104.6/104.8) instead of re-deriving it from history.
  const { data: snapshotRows, error: snapshotErr } = await serviceRoleClient
    .schema("erp_inventory")
    .from("stock_snapshot")
    .select("material_id, storage_location_id, quantity")
    .eq("company_id", companyId)
    .eq("stock_type_code", "UNRESTRICTED")
    .in("material_id", materialIds)
    .in("storage_location_id", locationIds);
  if (snapshotErr) {
    console.error("[process_order.computePhysicalAvailabilityRows] snapshot query failed:", JSON.stringify(snapshotErr));
    throw new Error("PROD_PO_STOCK_CHECK_FAILED");
  }

  const available = new Map<string, number>();
  for (const row of (snapshotRows ?? []) as JsonRecord[]) {
    const key = buildAvailabilityKey(String(row.material_id), String(row.storage_location_id));
    available.set(key, (available.get(key) ?? 0) + Number(row.quantity ?? 0));
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
        planned_qty, actual_qty, status, priority,
        qa_decided_by, qa_decided_at, manager_decided_by, manager_decided_at,
        batch_started_at, finalized_at, verified_at, created_by, created_at,
        mts_used_current_stroke, batch_number_from, batch_number_to, number_of_batches
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
        "id, pace_code, material_name, document_name, shade_code",
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
    const [materialMap, strokeResult, machineResult, shiftResult, companyResult] = await Promise.all([
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
            // default_storage_location_id needed so PR10 Edit (ProductionPOEditPage.jsx)
            // can filter its Machine dropdown by §138.1's mapping, same as Create.
            .select("id, stroke_number, description, status, default_storage_location_id")
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
      toTrimmedString(poRow.shift_id)
        ? serviceRoleClient
            .schema("erp_production")
            .from("shift_master")
            .select("id, shift_name")
            .eq("id", String(poRow.shift_id))
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      serviceRoleClient
        .schema("erp_master")
        .from("companies")
        .select("id, company_code, company_name")
        .eq("id", String(poRow.company_id))
        .maybeSingle(),
    ]);

    if (strokeResult.error) {
      console.error("[process_order.getProcessOrder] stroke query failed:", JSON.stringify(strokeResult.error));
      throw new Error("PROD_PO_FETCH_FAILED");
    }
    if (machineResult.error || shiftResult.error || companyResult.error) {
      console.error("[process_order.getProcessOrder] machine/shift/company query failed:", JSON.stringify(machineResult.error ?? shiftResult.error ?? companyResult.error));
      throw new Error("PROD_PO_FETCH_FAILED");
    }

    const lines = await fetchOrderLines(id, strokeMasterId);
    // A REVERSED parent's own children are ALL reversed by definition -- the
    // CORS report (ReversalPage.jsx) needs those still-linked lines to show
    // what was actually reversed, so only exclude REVERSED packing orders
    // when the parent itself is still active.
    let packingOrderQuery = serviceRoleClient
      .schema("erp_production")
      .from("packing_order")
      .select("id, po_number, status, planned_qty_kg, actual_qty_kg, batch_number_from, batch_number_to, pack_code_id, fill_qty_per_pack, num_packs, sku_qty, material_id")
      .eq("process_order_id", id);
    if (poRow.status !== "REVERSED") {
      packingOrderQuery = packingOrderQuery.neq("status", "REVERSED");
    }
    const { data: packOrders, error: packErr } = await packingOrderQuery;
    if (packErr) {
      console.error("[process_order.getProcessOrder] packing-order query failed:", JSON.stringify(packErr));
      throw new Error("PROD_PO_FETCH_FAILED");
    }

    let mtsReview: JsonRecord | null = null;
    let enrichedPackingOrders = (packOrders ?? []) as JsonRecord[];
    if (poRow.po_type === "MTS") {
      const packingOrderIds = enrichedPackingOrders.map((row) => String(row.id)).filter(Boolean);
      const [snapshotResult, planResult, lineResult, yieldResult] = await Promise.all([
        serviceRoleClient
          .schema("erp_production")
          .from("mts_creation_snapshot")
          .select("page4_material_plan, page5_packing_plan, page6_pm_plan, created_at, created_by")
          .eq("process_order_id", id)
          .maybeSingle(),
        serviceRoleClient
          .schema("erp_production")
          .from("mts_packing_plan_row")
          .select("id, packing_order_id, batch_number_from, batch_number_to, pack_code_id, outer_unit_per_batch, storage_location_id, display_order, status")
          .eq("process_order_id", id)
          .order("display_order", { ascending: true }),
        packingOrderIds.length > 0
          ? serviceRoleClient
              .schema("erp_production")
              .from("packing_order_line")
              .select("id, packing_order_id, line_type, material_id, actual_material_id, qty_per_pack, total_qty, actual_qty, issue_sloc_id, uom_code, movement_type_code, has_alternate, display_order, variance_qty")
              .in("packing_order_id", packingOrderIds)
              .order("display_order", { ascending: true })
          : Promise.resolve({ data: [], error: null }),
        serviceRoleClient
          .schema("erp_production")
          .from("mts_batch_yield_variance")
          .select("id, packing_order_id, packing_plan_row_id, batch_number, sku_material_id, expected_qty, declared_actual_qty, variance_qty, variance_type, uom_code, status")
          .eq("process_order_id", id)
          .order("batch_number", { ascending: true }),
      ]);
      if (snapshotResult.error || planResult.error || lineResult.error || yieldResult.error) {
        console.error("[process_order.getProcessOrder] MTS review query failed:", JSON.stringify(snapshotResult.error ?? planResult.error ?? lineResult.error ?? yieldResult.error));
        throw new Error("PROD_PO_FETCH_FAILED");
      }

      const packingLines = (lineResult.data ?? []) as JsonRecord[];
      const packingPlanRows = (planResult.data ?? []) as JsonRecord[];
      const packCodeIds = [...new Set([
        ...packingPlanRows.map((row) => toTrimmedString(row.pack_code_id)),
        ...enrichedPackingOrders.map((row) => toTrimmedString(row.pack_code_id)),
      ].filter(Boolean))];
      const locationIds = [...new Set([
        ...packingPlanRows.map((row) => toTrimmedString(row.storage_location_id)),
        ...packingLines.map((line) => toTrimmedString(line.issue_sloc_id)),
      ].filter(Boolean))];
      const [packingMaterialMap, packCodeResult, locationResult] = await Promise.all([
        getMaterialMapByIds(
          packingLines.flatMap((line) => [toTrimmedString(line.material_id), toTrimmedString(line.actual_material_id)]),
          "[process_order.getProcessOrder]",
          "PROD_PO_FETCH_FAILED",
          "id, pace_code, material_name, shade_code, base_uom_code",
        ),
        packCodeIds.length > 0
          ? serviceRoleClient.schema("erp_production").from("pack_code_master").select("id, pack_code, pack_name, pack_type").in("id", packCodeIds)
          : Promise.resolve({ data: [], error: null }),
        locationIds.length > 0
          ? serviceRoleClient.schema("erp_inventory").from("storage_location_master").select("id, code, name").in("id", locationIds)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (packCodeResult.error || locationResult.error) {
        console.error("[process_order.getProcessOrder] MTS review label lookup failed:", JSON.stringify(packCodeResult.error ?? locationResult.error));
        throw new Error("PROD_PO_FETCH_FAILED");
      }
      const packCodeMap = new Map(((packCodeResult.data ?? []) as JsonRecord[]).map((row) => [String(row.id), row]));
      const locationMap = new Map(((locationResult.data ?? []) as JsonRecord[]).map((row) => [String(row.id), row]));
      const linesByPackingOrder = new Map<string, JsonRecord[]>();
      for (const line of packingLines) {
        const packingOrderId = String(line.packing_order_id ?? "");
        const item = {
          ...line,
          material: packingMaterialMap.get(String(line.material_id ?? "")) ?? null,
          actual_material: packingMaterialMap.get(String(line.actual_material_id ?? "")) ?? null,
          issue_storage_location: locationMap.get(String(line.issue_sloc_id ?? "")) ?? null,
        };
        linesByPackingOrder.set(packingOrderId, [...(linesByPackingOrder.get(packingOrderId) ?? []), item]);
      }
      enrichedPackingOrders = enrichedPackingOrders.map((packingOrder) => ({
        ...packingOrder,
        pack_code: packCodeMap.get(String(packingOrder.pack_code_id ?? "")) ?? null,
        lines: linesByPackingOrder.get(String(packingOrder.id)) ?? [],
      }));
      mtsReview = {
        snapshot: snapshotResult.data ?? null,
        batch_yield_variances: (yieldResult.data ?? []).map((row) => ({
          ...row,
          sku_material: packingMaterialMap.get(String((row as JsonRecord).sku_material_id ?? "")) ?? null,
        })),
        packing_plan_rows: packingPlanRows.map((row) => ({
          ...row,
          pack_code: packCodeMap.get(String(row.pack_code_id ?? "")) ?? null,
          storage_location: locationMap.get(String(row.storage_location_id ?? "")) ?? null,
        })),
      };
    }

    return okResponse({
      data: {
        ...poRow,
        material: materialMap.get(String(poRow.material_id ?? "")) ?? null,
        stroke: strokeResult.data ?? null,
        machine: machineResult.data ?? null,
        shift: shiftResult.data ?? null,
        company: companyResult.data ?? null,
        lines,
        packing_orders: enrichedPackingOrders,
        mts_review: mtsReview,
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
    const plannedStartDate = toTrimmedString(body.planned_start_date) || null;
    const notes = toTrimmedString(body.notes);
    const lineOverrideMap = buildLineOverrideMap(body.line_location_overrides);
    // §136 follow-up (2026-09-08) — MTEST has no separate QA_APPROVED step to set
    // Priority at (§131.1: QA is the only actor, Standard creation IS the approval),
    // so for MTEST only, Priority is captured right here at creation instead. Every
    // other po_type keeps setting it later at qaApproveProcessOrderHandler, unchanged.
    const priorityInput = poType === "MTEST" ? (toUpperTrimmedString(body.priority) || "NORMAL") : null;

    // MTS Page 3 (2026-09-17 lock) — Production Date, Shift, Batch Range and
    // Batch Size (per-batch qty, Prodshade's own base UoM) are all captured
    // right here at Create, not at a later "Start Batch" click like MTO/HPS/INT.
    // planned_qty for MTS is always derived (number_of_batches × batch_size),
    // never trusted directly from the body.
    const isMtsCreate = poType === "MTS";
    const productionDate = isMtsCreate ? (toTrimmedString(body.production_date) || null) : null;
    const shiftId = isMtsCreate ? (toTrimmedString(body.shift_id) || null) : null;
    const batchStartSerial = isMtsCreate ? parsePositiveInt(body.batch_start_serial) : null;
    const numberOfBatches = isMtsCreate ? parsePositiveInt(body.number_of_batches) : null;
    const batchSize = isMtsCreate ? parsePositiveNumber(body.batch_size) : null;
    const plannedQty = isMtsCreate
      ? (numberOfBatches && batchSize ? numberOfBatches * batchSize : null)
      : parsePositiveNumber(body.planned_qty ?? body.planned_qty_kg);
    // Set below (server-side, from mts_current_stroke) once the chosen stroke is
    // fetched and validated — never trust a client-sent flag for this.
    let mtsUsedCurrentStroke: boolean | null = null;

    if (!companyId || !VALID_PO_TYPES.has(poType) || !VALID_SEGMENTS.has(segmentCode) || !materialId || !plannedQty) {
      return poErr(req, ctx, "PROD_PO_INVALID", 400, "company_id, po_type, segment_code, material_id, planned_qty required");
    }
    // MTS has no Page-3 durable-create endpoint.  The current UI keeps Pages
    // 1–5 in browser state and Page 6 calls create_mts_documents_atomic once;
    // keep this backend guard as well so a stale browser bundle or direct API
    // call cannot recreate the legacy header-first flow.
    if (isMtsCreate) {
      return poErr(req, ctx, "PROD_MTS_PAGE6_ATOMIC_CREATE_REQUIRED", 422, "MTS Process Orders are created only after Page 6. Complete the Page 1–6 flow and use the atomic create action.");
    }
    if (isMtsCreate && (!productionDate || !shiftId || !batchStartSerial || !numberOfBatches || !batchSize)) {
      return poErr(req, ctx, "PROD_PO_MTS_FIELDS_REQUIRED", 400, "production_date, shift_id, batch_start_serial, number_of_batches, batch_size required for MTS");
    }
    if (productionDate && !isProductionDateWithinWindow(productionDate)) {
      return poErr(req, ctx, "PROD_PO_PRODUCTION_DATE_OUTSIDE_ALLOWED_WINDOW", 400, PRODUCTION_DATE_WINDOW_MESSAGE);
    }
    if (priorityInput && !["NORMAL", "URGENT"].includes(priorityInput)) {
      return poErr(req, ctx, "PROD_PO_PRIORITY_INVALID", 400, "priority must be NORMAL or URGENT");
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
        .select("status, company_id, prodshade_material_id, material_type, conversion_factor, stroke_number")
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
      // MTS Current-vs-Non-Current Stroke policy (2026-09-17 lock) — server-side
      // truth, never trusted from the client. Current Stroke = Policy 1 (skips
      // QA approval, no Start Batch — finalize straight from STANDARD). Any
      // other stroke = Policy 2 (classic Standard -> QA Approved -> Final ->
      // Verify, same as MTO/HPS, just without a Start Batch step either).
      if (isMtsCreate) {
        const { data: currentStrokeRow, error: currentStrokeErr } = await serviceRoleClient
          .schema("erp_production")
          .from("mts_current_stroke")
          .select("stroke_number")
          .eq("company_id", companyId)
          .eq("prodshade_material_id", materialId)
          .maybeSingle();
        if (currentStrokeErr) {
          console.error("[process_order.createProcessOrder] mts_current_stroke lookup failed:", JSON.stringify(currentStrokeErr));
          throw new Error("PROD_PO_CREATE_FAILED");
        }
        const currentStrokeNumber = toTrimmedString((currentStrokeRow as JsonRecord | null)?.stroke_number);
        mtsUsedCurrentStroke = Boolean(currentStrokeNumber) && currentStrokeNumber === toTrimmedString(strokeRow.stroke_number);
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
        // MTS Page 3 declares a whole Batch Range (Number of Batches × Batch
        // Size) in one PO -- the machine capacity limit is per single physical
        // batch/pour, so it must check batchSize alone here, never the range's
        // total. Every other po_type is still one PO = one batch, unchanged.
        const capacityCheckQty = isMtsCreate ? (batchSize as number) : plannedQty;
        if (capacityCheckQty > maxPlannedQty + 0.000001) {
          return poErr(req, ctx, "PROD_PO_MACHINE_CAPACITY_EXCEEDED", 422, `Batch quantity cannot exceed ${maxPlannedQty.toFixed(3)} KG (110% of selected machine capacity)`);
        }
      }
    }

    // §138.12/§138.14 (2026-09-18 fix, found live via a real Page 3 click-
    // through): this up-front fast-fail check was never guarded for MTS,
    // even though the later prepopulation block was. It checks each
    // formulation line's OWN default_storage_location_id (R001 or S001)
    // against generic location-level UNRESTRICTED stock -- no group/alternate
    // substitution, no machine-bucket awareness -- so it always 422'd MTS
    // Create with PROD_PO_INSUFFICIENT_STOCK before Page 4 (the real,
    // machine-bucket-aware, group-alternate-aware check) ever got a chance to
    // run. MTS has no lines at Create time at all now (see the later,
    // already-guarded prepopulation block) so there is nothing here to check.
    if (strokeId && !isMtsCreate) {
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

    // MTS Page 3 — resolve the declared Batch Range into concrete batch numbers
    // and re-check for collisions server-side (the frontend's own live check via
    // mts-batch-range-check is advisory only; a second tab/request could race it).
    let mtsBatchNumbers: string[] = [];
    let mtsBatchNumberFrom: string | null = null;
    let mtsBatchNumberTo: string | null = null;
    if (isMtsCreate) {
      const rangeResult = await resolveMtsBatchRangeNumbers(companyId, materialId, batchStartSerial as number, numberOfBatches as number);
      if ("errorCode" in rangeResult) {
        return poErr(req, ctx, rangeResult.errorCode, rangeResult.status, rangeResult.message);
      }
      const duplicates = await findDuplicateBatchNumbers(companyId, rangeResult.numbers);
      if (duplicates.length > 0) {
        return poErr(req, ctx, "PROD_PO_BATCH_RANGE_DUPLICATE", 409, `Batch number(s) already active: ${duplicates.join(", ")}`);
      }
      mtsBatchNumbers = rangeResult.numbers;
      mtsBatchNumberFrom = rangeResult.numbers[0];
      mtsBatchNumberTo = rangeResult.numbers[rangeResult.numbers.length - 1];
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
        ...(priorityInput ? { priority: priorityInput } : {}),
        ...(isMtsCreate ? {
          production_date: productionDate,
          shift_id: shiftId,
          batch_number_from: mtsBatchNumberFrom,
          batch_number_to: mtsBatchNumberTo,
          number_of_batches: numberOfBatches,
          // Mirrors the range's start so existing display/reversal code that
          // already reads process_order.batch_number needs no branching.
          batch_number: mtsBatchNumberFrom,
          mts_used_current_stroke: mtsUsedCurrentStroke,
        } : {}),
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

    if (isMtsCreate && mtsBatchNumbers.length > 0) {
      // 2026-09-18 fix: one atomic bulk INSERT (not N separate upserts) so a
      // collision on any single batch number fails the WHOLE range instead
      // of leaving it half-inserted — see bulkInsertBatchNumberInstances's
      // own comment for the race this closes. On the rare loss (someone else
      // grabbed a colliding batch number in the gap between our earlier
      // advisory check and this insert), the process_order row we just
      // created is invalid (its declared range was never actually reserved)
      // and must be compensated away — no lines exist yet at this point in
      // the flow, so deleting the PO row alone is enough.
      const bulkResult = await bulkInsertBatchNumberInstances({
        companyId,
        poType: "MTS",
        prodshadeMaterialId: materialId,
        batchNumbers: mtsBatchNumbers,
        processOrderId: poId,
        authUserId: ctx.auth_user_id,
      });
      if (!bulkResult.ok) {
        const { error: rollbackErr } = await serviceRoleClient
          .schema("erp_production")
          .from("process_order")
          .delete()
          .eq("id", poId);
        if (rollbackErr) {
          console.error("[process_order.createProcessOrder] compensating rollback failed:", JSON.stringify(rollbackErr));
        }
        return poErr(req, ctx, "PROD_PO_BATCH_RANGE_RACE_LOST", 409, "Someone else just used a batch number in this range. Please re-check the range and try again.");
      }
    }
    const insertedLines: JsonRecord[] = [];

    // §138.12/§138.14 (2026-09-18): MTS never gets the naive 1:1
    // formulation-material line here — its RM lines only exist once Page 4's
    // auto-derive (machine-bucket-aware, possibly multi-row per formulation
    // item) has run, via saveMtsMaterialPlanHandler below. Creating a
    // placeholder 1:1 line here would (a) ignore the machine bucket entirely,
    // reserving/checking against the stroke's declared location as a whole
    // instead of the specific machine's own sub-bucket, and (b) leave a
    // stray line behind if Page 4 later needs a different row count.
    if (strokeId && !isMtsCreate) {
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

    const manualLines = isMtsCreate ? [] : (Array.isArray(body.lines) ? (body.lines as JsonRecord[]) : []);
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

// ---------------------------------------------------------------------------
// §138.12/§138.14/§138.15 — MTS Page 4: RM auto-derive material plan.
//
// GET returns a computed preview (machine-bucket-aware for machine-tracked
// stroke lines, real §83.5 location-level check for R001 lines) WITHOUT
// writing anything. POST persists it. Both share the same computation
// (`buildMtsMaterialPlanGroupsForOrder`) so the preview a user reviews on
// Page 4 is byte-for-byte what gets validated/saved -- there is no second,
// divergent code path.
// ---------------------------------------------------------------------------

type MtsPlanGroup = {
  stroke_line_id: string;
  stroke_line_material_id: string;
  auto_derive_applicable: boolean;
  storage_location_id: string;
  dosage_pct: number | null;
  standard_qty: number;
  rows: MtsAutoDeriveRow[];
  group_member_ids: string[];
  short: boolean;
  shortfall_qty: number;
};

async function fetchMtsPoAndStrokeLines(id: string): Promise<{
  po: JsonRecord;
  strokeLines: JsonRecord[];
  machineStorageLocationId: string | null;
  strokeShopFloorLocationId: string | null;
}> {
  const po = await fetchProcessOrder(id);
  if (!po) throw new Error("PROD_PO_NOT_FOUND");
  if (po.po_type !== "MTS") throw new Error("PROD_PO_MTS_PLAN_WRONG_TYPE");

  const strokeMasterId = toTrimmedString(po.stroke_master_id);
  if (!strokeMasterId) throw new Error("PROD_PO_MTS_PLAN_STROKE_MISSING");

  const { data: strokeLines, error: strokeLineErr } = await serviceRoleClient
    .schema("erp_production")
    .from("stroke_line")
    .select("id, material_id, alternate_material_id, material_group_id, dosage_pct, display_order, default_storage_location_id")
    .eq("stroke_master_id", strokeMasterId)
    .order("display_order");
  if (strokeLineErr) {
    console.error("[process_order.mtsMaterialPlan] stroke-line query failed:", JSON.stringify(strokeLineErr));
    throw new Error("PROD_PO_MTS_PLAN_FAILED");
  }

  const machineId = toTrimmedString(po.machine_id);
  let machineStorageLocationId: string | null = null;
  if (machineId) {
    const { data: machineRow, error: machineErr } = await serviceRoleClient
      .schema("erp_master")
      .from("machine_master")
      .select("storage_location_id")
      .eq("id", machineId)
      .maybeSingle();
    if (machineErr) {
      console.error("[process_order.mtsMaterialPlan] machine query failed:", JSON.stringify(machineErr));
      throw new Error("PROD_PO_MTS_PLAN_FAILED");
    }
    machineStorageLocationId = toTrimmedString((machineRow as JsonRecord | null)?.storage_location_id) || null;
  }

  const { data: strokeRow, error: strokeErr } = await serviceRoleClient
    .schema("erp_production")
    .from("stroke_master")
    .select("default_storage_location_id")
    .eq("id", strokeMasterId)
    .maybeSingle();
  if (strokeErr) {
    console.error("[process_order.mtsMaterialPlan] stroke location query failed:", JSON.stringify(strokeErr));
    throw new Error("PROD_PO_MTS_PLAN_FAILED");
  }
  const strokeShopFloorLocationId = toTrimmedString((strokeRow as JsonRecord | null)?.default_storage_location_id) || null;

  return { po, strokeLines: (strokeLines ?? []) as JsonRecord[], machineStorageLocationId, strokeShopFloorLocationId };
}

async function resolveMtsPlanCompanyAndAuth(
  req: Request,
  ctx: ProdHandlerContext,
  action: "VIEW" | "WRITE",
): Promise<{ po: JsonRecord } | { errorResponse: Response }> {
  const id = getIdFromPath(req);
  if (!id) return { errorResponse: poErr(req, ctx, "PROD_PO_ID_MISSING", 400, "ID required") };
  const po = await fetchProcessOrder(id);
  if (!po) return { errorResponse: poErr(req, ctx, "PROD_PO_NOT_FOUND", 404, "Not found") };
  try {
    await assertCompanyScope(ctx, String(po.company_id ?? ""));
  } catch {
    return { errorResponse: poErr(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.") };
  }
  if (po.po_type !== "MTS") {
    return { errorResponse: poErr(req, ctx, "PROD_PO_MTS_PLAN_WRONG_TYPE", 422, "Material plan is only for MTS Process Orders") };
  }
  if (!(await canMaintainCompanyResource(ctx, String(po.company_id ?? ""), "PROD_PO_CREATE", action))) {
    return { errorResponse: poErr(req, ctx, "PROD_PO_COMPANY_ACCESS_DENIED", 403, "You do not have access for this company.") };
  }
  if (po.status !== "STANDARD") {
    return { errorResponse: poErr(req, ctx, "PROD_PO_STATUS_INVALID", 422, "Material plan can only be reviewed/saved while at STANDARD") };
  }
  return { po };
}

// Header block for Page 4 -- Prodshade/Description/Stroke/Machine/Batch
// range + Per-Batch and Total Qty (§138.15: "both must show, per-batch alone
// looks like a mismatch against the total").
async function buildMtsPlanHeader(po: JsonRecord): Promise<JsonRecord> {
  const numberOfBatches = Number(po.number_of_batches ?? 0);
  const totalQty = Number(po.planned_qty ?? 0);
  const batchSize = numberOfBatches > 0 ? Number((totalQty / numberOfBatches).toFixed(6)) : totalQty;

  const materialMap = await getMaterialMapByIds(
    [String(po.material_id ?? "")], "[process_order.mtsMaterialPlan]", "PROD_PO_MTS_PLAN_FAILED", "id, pace_code, material_name, document_name",
  );
  const prodshade = materialMap.get(String(po.material_id ?? "")) ?? null;

  let strokeNumber: string | null = null;
  const strokeMasterId = toTrimmedString(po.stroke_master_id);
  if (strokeMasterId) {
    const { data: strokeRow } = await serviceRoleClient
      .schema("erp_production").from("stroke_master")
      .select("stroke_number").eq("id", strokeMasterId).maybeSingle();
    strokeNumber = toTrimmedString((strokeRow as JsonRecord | null)?.stroke_number) || null;
  }

  let machineLabel: string | null = null;
  const machineId = toTrimmedString(po.machine_id);
  if (machineId) {
    const { data: machineRow } = await serviceRoleClient
      .schema("erp_master").from("machine_master")
      .select("machine_code, machine_name").eq("id", machineId).maybeSingle();
    const m = machineRow as JsonRecord | null;
    machineLabel = m ? [toTrimmedString(m.machine_code), toTrimmedString(m.machine_name)].filter(Boolean).join(" - ") || null : null;
  }

  return {
    po_number: po.po_number,
    status: po.status,
    mts_used_current_stroke: po.mts_used_current_stroke === true,
    prodshade_pace_code: toTrimmedString(prodshade?.pace_code),
    prodshade_material_name: toTrimmedString(prodshade?.material_name),
    prodshade_description: toTrimmedString(prodshade?.document_name),
    stroke_number: strokeNumber,
    machine_label: machineLabel,
    batch_number_from: po.batch_number_from ?? null,
    batch_number_to: po.batch_number_to ?? null,
    number_of_batches: numberOfBatches,
    batch_size: batchSize,
    total_qty: totalQty,
  };
}

export async function getMtsMaterialPlanHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const auth = await resolveMtsPlanCompanyAndAuth(req, ctx, "VIEW");
    if ("errorResponse" in auth) return auth.errorResponse;
    const po = auth.po;
    const id = String(po.id);
    const header = await buildMtsPlanHeader(po);

    const existingLines = await fetchOrderLines(id, toTrimmedString(po.stroke_master_id) || null);
    if (existingLines.length > 0) {
      // Already saved once -- rebuild the same group shape from what is
      // actually persisted, so revisiting Page 4 shows real state, not a
      // fresh recompute that could disagree with it.
      const byStrokeLine = new Map<string, JsonRecord[]>();
      for (const line of existingLines) {
        // Do not merge two declared Stroke Lines merely because they share a
        // material. Stroke 0064, for example, legitimately uses Dolomite at
        // two different dosages. Old records predate stroke_line_id, so keep
        // their legacy fallback rather than making a destructive guess.
        const key = toTrimmedString(line.stroke_line_id) || `legacy:${String(line.material_id)}:${String(line.display_order)}`;
        const list = byStrokeLine.get(key) ?? [];
        list.push(line);
        byStrokeLine.set(key, list);
      }
      const groups: MtsPlanGroup[] = [];
      for (const [strokeLineId, lines] of byStrokeLine.entries()) {
        const firstLine = lines.find((l) => l.is_formulation_line !== false) ?? lines[0];
        const formulationMaterialId = String(firstLine.material_id);
        groups.push({
          stroke_line_id: strokeLineId,
          stroke_line_material_id: formulationMaterialId,
          auto_derive_applicable: true,
          storage_location_id: toTrimmedString(firstLine.issue_sloc_id) || "",
          dosage_pct: firstLine.dosage_pct === null || firstLine.dosage_pct === undefined ? null : Number(firstLine.dosage_pct),
          standard_qty: Number(firstLine.planned_qty ?? 0),
          rows: lines.map((l) => ({
            stroke_line_id: strokeLineId,
            stroke_line_material_id: formulationMaterialId,
            actual_material_id: toTrimmedString(l.actual_material_id) || formulationMaterialId,
            is_formulation_line: l.is_formulation_line !== false,
            dosage_pct: l.dosage_pct === null || l.dosage_pct === undefined ? null : Number(l.dosage_pct),
            planned_qty: Number(l.planned_qty ?? 0),
            actual_qty: Number(l.actual_qty ?? 0),
            available_qty: 0,
          })),
          group_member_ids: [],
          short: false,
          shortfall_qty: 0,
        });
      }
      const savedMaterialIds = new Set<string>();
      for (const group of groups) {
        savedMaterialIds.add(group.stroke_line_material_id);
        for (const row of group.rows) savedMaterialIds.add(row.actual_material_id);
      }
      const savedMaterialMap = await getMaterialMapByIds(
        [...savedMaterialIds], "[process_order.mtsMaterialPlan]", "PROD_PO_MTS_PLAN_FAILED", "id, pace_code, material_name, base_uom_code, material_type",
      );
      const savedSlocIds = new Set(groups.map((g) => g.storage_location_id).filter(Boolean));
      const savedSlocMap = await getStorageLocationMapByIds([...savedSlocIds], "[process_order.mtsMaterialPlan]", "PROD_PO_MTS_PLAN_FAILED");
      return okResponse({
        saved: true,
        header,
        groups,
        materials: Object.fromEntries([...savedMaterialMap.entries()]),
        storage_locations: Object.fromEntries([...savedSlocMap.entries()]),
      }, ctx.request_id, req);
    }

    const { strokeLines, machineStorageLocationId, strokeShopFloorLocationId } = await fetchMtsPoAndStrokeLines(id);
    const machineId = toTrimmedString(po.machine_id);
    const groups = await buildMtsMaterialPlanGroupsForOrder(
      String(po.company_id), strokeLines, machineStorageLocationId, strokeShopFloorLocationId, machineId, Number(po.planned_qty ?? 0),
    );

    const materialIds = new Set<string>();
    for (const group of groups) {
      materialIds.add(group.stroke_line_material_id);
      for (const row of group.rows) materialIds.add(row.actual_material_id);
      for (const memberId of group.group_member_ids) materialIds.add(memberId);
    }
    const materialMap = await getMaterialMapByIds(
      [...materialIds], "[process_order.mtsMaterialPlan]", "PROD_PO_MTS_PLAN_FAILED", "id, pace_code, material_name, base_uom_code, material_type",
    );
    const slocIds = new Set(groups.map((g) => g.storage_location_id));
    const slocMap = await getStorageLocationMapByIds([...slocIds], "[process_order.mtsMaterialPlan]", "PROD_PO_MTS_PLAN_FAILED");

    return okResponse({
      saved: false,
      header,
      groups,
      materials: Object.fromEntries([...materialMap.entries()].map(([k, v]) => [k, v])),
      storage_locations: Object.fromEntries([...slocMap.entries()].map(([k, v]) => [k, v])),
    }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PO_MTS_PLAN_FAILED";
    return poErr(req, ctx, code, code === "PROD_PO_NOT_FOUND" ? 404 : 500, "Failed to load material plan");
  }
}

// Thin wrapper so buildMtsMaterialPlanGroups (which needs the real machine_id
// for the bucket read) can stay a pure function of its inputs.
export async function buildMtsMaterialPlanGroupsForOrder(
  companyId: string,
  strokeLines: JsonRecord[],
  machineStorageLocationId: string | null,
  strokeShopFloorLocationId: string | null,
  machineId: string,
  totalPlannedQty: number,
): Promise<MtsPlanGroup[]> {
  if (strokeLines.length === 0) return [];
  const allowedAlternateMap = await buildAllowedAlternateIdsByStrokeLines(
    strokeLines, "[process_order.mtsMaterialPlan]", "PROD_PO_MTS_PLAN_FAILED",
    (line) => toTrimmedString(line.id) || String(line.material_id ?? ""),
  );
  const normalMachineTrackedLines = machineStorageLocationId
    ? strokeLines.filter((line) => toTrimmedString(line.default_storage_location_id) === machineStorageLocationId)
    : [];
  // §138.4: selecting an MTS machine at another shop-floor location is an
  // explicit exception. The selected location's Unassigned bucket supplies
  // the shop-floor stroke lines; bulk/R001 lines remain ordinary manual picks.
  const isForeignMachine = Boolean(
    machineStorageLocationId && strokeShopFloorLocationId && machineStorageLocationId !== strokeShopFloorLocationId,
  );
  const machineTrackedLines = isForeignMachine
    ? strokeLines.filter((line) => toTrimmedString(line.default_storage_location_id) === strokeShopFloorLocationId)
    : normalMachineTrackedLines;
  const manualPickLines = strokeLines.filter((line) => !machineTrackedLines.includes(line));

  const machineCandidateIds = new Set<string>();
  for (const line of machineTrackedLines) {
    machineCandidateIds.add(String(line.material_id));
    for (const altId of allowedAlternateMap.get(String(line.id)) ?? []) machineCandidateIds.add(altId);
  }
  const bucketBalances = (machineStorageLocationId && machineId)
    ? await fetchNetMachineBucketBalances(companyId, machineStorageLocationId, isForeignMachine ? null : machineId, [...machineCandidateIds])
    : new Map<string, number>();

  const groups: MtsPlanGroup[] = [];
  for (const line of machineTrackedLines) {
    const strokeLineId = String(line.id);
    const formulationMaterialId = String(line.material_id);
    const hasDosage = line.dosage_pct !== null && line.dosage_pct !== undefined;
    const dosagePct = Number(line.dosage_pct ?? 0);
    const standardQty = Number(((dosagePct / 100) * totalPlannedQty).toFixed(6));
    const alternateIds = allowedAlternateMap.get(strokeLineId) ?? [];
    const { rows, short, shortfallQty } = computeMtsAutoDeriveRowsForGroup({
      strokeLineId,
      formulationMaterialId,
      dosagePct: hasDosage ? dosagePct : null,
      standardQty,
      alternateMaterialIds: alternateIds,
      bucketBalances,
    });
    // A machine bucket is one physical pool.  Subsequent formulation groups
    // must only see what this group did not already allocate from it.
    for (const row of rows) {
      if (row.actual_qty > EPSILON) {
        bucketBalances.set(
          row.actual_material_id,
          Number(((bucketBalances.get(row.actual_material_id) ?? 0) - row.actual_qty).toFixed(6)),
        );
      }
    }
    groups.push({
      stroke_line_id: strokeLineId,
      stroke_line_material_id: formulationMaterialId,
      auto_derive_applicable: true,
      storage_location_id: isForeignMachine ? String(machineStorageLocationId) : String(line.default_storage_location_id),
      dosage_pct: hasDosage ? dosagePct : null,
      standard_qty: standardQty,
      rows,
      group_member_ids: [formulationMaterialId, ...alternateIds],
      short,
      shortfall_qty: shortfallQty,
    });
  }

  if (manualPickLines.length > 0) {
    const needed = new Map<string, AvailabilityNeed>();
    for (const line of manualPickLines) {
      const strokeLineId = String(line.id);
      const formulationMaterialId = String(line.material_id);
      const locationId = String(line.default_storage_location_id);
      const candidateIds = [formulationMaterialId, ...(allowedAlternateMap.get(strokeLineId) ?? [])];
      for (const candidateId of candidateIds) {
        // computeAvailabilityRows deliberately ignores zero-quantity entries.
        // Page 4 needs the live balance for every manual-pick choice, not a
        // requested quantity at preview time, so use a harmless positive probe.
        needed.set(buildAvailabilityKey(candidateId, locationId), { materialId: candidateId, storageLocationId: locationId, qty: 1 });
      }
    }
    const availabilityRows = needed.size > 0 ? await computeAvailabilityRows(companyId, needed) : [];
    const availabilityByKey = new Map(availabilityRows.map((row) => [buildAvailabilityKey(row.material_id, row.storage_location_id), row.available_qty]));

    for (const line of manualPickLines) {
      const strokeLineId = String(line.id);
      const formulationMaterialId = String(line.material_id);
      const hasDosage = line.dosage_pct !== null && line.dosage_pct !== undefined;
      const dosagePct = Number(line.dosage_pct ?? 0);
      const standardQty = Number(((dosagePct / 100) * totalPlannedQty).toFixed(6));
      const locationId = String(line.default_storage_location_id);
      const alternateIds = allowedAlternateMap.get(strokeLineId) ?? [];
      const candidateIds = [formulationMaterialId, ...alternateIds];
      groups.push({
        stroke_line_id: strokeLineId,
        stroke_line_material_id: formulationMaterialId,
        auto_derive_applicable: false,
        storage_location_id: locationId,
        dosage_pct: hasDosage ? dosagePct : null,
        standard_qty: standardQty,
        rows: candidateIds.map((candidateId) => ({
          stroke_line_id: strokeLineId,
          stroke_line_material_id: formulationMaterialId,
          actual_material_id: candidateId,
          is_formulation_line: candidateId === formulationMaterialId,
          dosage_pct: candidateId === formulationMaterialId ? (hasDosage ? dosagePct : null) : null,
          planned_qty: candidateId === formulationMaterialId ? standardQty : 0,
          actual_qty: 0,
          available_qty: availabilityByKey.get(buildAvailabilityKey(candidateId, locationId)) ?? 0,
        })),
        group_member_ids: candidateIds,
        short: (availabilityByKey.get(buildAvailabilityKey(formulationMaterialId, locationId)) ?? 0) < standardQty - EPSILON
          && alternateIds.every((altId) => (availabilityByKey.get(buildAvailabilityKey(altId, locationId)) ?? 0) < standardQty - EPSILON),
        shortfall_qty: 0,
      });
    }
  }

  return groups;
}

export async function saveMtsMaterialPlanHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const auth = await resolveMtsPlanCompanyAndAuth(req, ctx, "WRITE");
    if ("errorResponse" in auth) return auth.errorResponse;
    const po = auth.po;
    const id = String(po.id);
    const companyId = String(po.company_id);

    const existingLines = await fetchOrderLines(id, toTrimmedString(po.stroke_master_id) || null);
    if (existingLines.length > 0) {
      // v1 scope (2026-09-18): re-save/redo is not supported yet -- once
      // Page 4 has been saved once, further changes happen the normal way
      // (edit/correct at a later stage). Avoids having to also tear down
      // and re-create reservations here.
      return poErr(req, ctx, "PROD_PO_MTS_PLAN_ALREADY_SAVED", 409, "Material plan already saved for this Process Order");
    }

    const { strokeLines, machineStorageLocationId, strokeShopFloorLocationId } = await fetchMtsPoAndStrokeLines(id);
    if (strokeLines.length === 0) {
      return poErr(req, ctx, "PROD_PO_MTS_PLAN_NO_STROKE_LINES", 422, "This stroke has no RM lines configured");
    }
    const machineId = toTrimmedString(po.machine_id);
    const totalPlannedQty = Number(po.planned_qty ?? 0);
    const isEditable = po.mts_used_current_stroke === true; // §138.12 stage/editability table

    const serverGroups = await buildMtsMaterialPlanGroupsForOrder(
      companyId, strokeLines, machineStorageLocationId, strokeShopFloorLocationId, machineId, totalPlannedQty,
    );

    const body = await parseBody(req);
    const bodyGroupsByStrokeLine = new Map<string, JsonRecord>();
    for (const entry of (Array.isArray(body.groups) ? body.groups : []) as JsonRecord[]) {
      const key = toTrimmedString(entry.stroke_line_id);
      if (key) bodyGroupsByStrokeLine.set(key, entry);
    }

    const shortGroupLabels: string[] = [];
    const finalRows: Array<{
      stroke_line_id: string;
      stroke_line_material_id: string;
      actual_material_id: string;
      is_formulation_line: boolean;
      dosage_pct: number | null;
      planned_qty: number;
      actual_qty: number;
      storage_location_id: string;
      variance_qty?: number;
    }> = [];

    for (const group of serverGroups) {
      if (group.auto_derive_applicable) {
        // Policy 1 (Current Stroke) is fully editable at Standard; Policy 2
        // is read-only here (edit moves to Final/Verify per §138.12's stage
        // table) -- either way, an override is only ever a same-group
        // material swap layered on the server's own freshly-computed rows,
        // never an arbitrary client-invented row set.
        const override = isEditable ? bodyGroupsByStrokeLine.get(group.stroke_line_id) : null;
        const overrideRows = override && Array.isArray(override.rows) ? (override.rows as JsonRecord[]) : null;

        let rows = group.rows;
        if (overrideRows && overrideRows.length > 0) {
          const allowedIds = new Set(group.group_member_ids);
          const seen = new Set<string>();
          let sumQty = 0;
          const mapped: MtsAutoDeriveRow[] = [];
          for (const [index, r] of overrideRows.entries()) {
            const actualMaterialId = toTrimmedString(r.actual_material_id);
            if (!actualMaterialId || !allowedIds.has(actualMaterialId)) {
              return poErr(req, ctx, "PROD_PO_MTS_PLAN_MATERIAL_NOT_IN_GROUP", 422, "actual_material_id must be the formulation item or a registered alternate for this line");
            }
            if (seen.has(actualMaterialId)) {
              return poErr(req, ctx, "PROD_PO_MTS_PLAN_DUPLICATE_MATERIAL", 422, "The same material cannot be selected twice within one formulation line");
            }
            seen.add(actualMaterialId);
            const qty = Number(parseNonNegativeNumber(r.actual_qty) ?? 0);
            sumQty = Number((sumQty + qty).toFixed(6));
            mapped.push({
              stroke_line_id: group.stroke_line_id,
              stroke_line_material_id: group.stroke_line_material_id,
              actual_material_id: actualMaterialId,
              is_formulation_line: index === 0,
              dosage_pct: index === 0 ? group.dosage_pct : null,
              planned_qty: index === 0 ? group.standard_qty : 0,
              actual_qty: qty,
              available_qty: 0,
            });
          }
          // §138.12 refinement (2026-09-18): over-Standard stays a hard block
          // (never allowed); under-Standard is allowed ONLY when the client
          // sends an explicit confirmed_shortfall flag for this group (the
          // frontend's own "you are taking less than required, do you agree?"
          // modal) -- an unconfirmed under-total is still rejected, just with
          // a distinct code so the frontend knows to show that modal rather
          // than treating it as a plain validation error.
          if (sumQty > group.standard_qty + EPSILON) {
            return poErr(req, ctx, "PROD_PO_MTS_PLAN_QTY_MISMATCH", 422, `Row quantities for ${group.stroke_line_material_id} exceed the Standard Qty`);
          }
          if (sumQty < group.standard_qty - EPSILON && override?.confirmed_shortfall !== true) {
            return poErr(req, ctx, "PROD_PO_MTS_PLAN_SHORTFALL_NOT_CONFIRMED", 422, `Row quantities for ${group.stroke_line_material_id} are below the Standard Qty and have not been confirmed`);
          }
          // Record the confirmed shortfall (if any) on the group's own first
          // row so it stays visible/auditable after save -- variance_qty is
          // an existing, general-purpose column, not repurposed from another
          // meaning (process_order_line_reco's own variance_qty is a
          // different, Verify-time concept; this is Standard-time only).
          if (mapped.length > 0) {
            mapped[0].planned_qty = group.standard_qty;
            mapped[0].variance_qty = Number((group.standard_qty - sumQty).toFixed(6));
          }
          rows = mapped;
        }

        if (group.short) shortGroupLabels.push(group.stroke_line_material_id);
        for (const row of rows) {
          finalRows.push({ ...row, stroke_line_id: group.stroke_line_id, storage_location_id: group.storage_location_id });
        }
      } else {
        // R001-style: client MUST supply exactly one manual pick.
        const override = bodyGroupsByStrokeLine.get(group.stroke_line_id);
        const chosenMaterialId = toTrimmedString(override?.actual_material_id);
        if (!chosenMaterialId || !group.group_member_ids.includes(chosenMaterialId)) {
          return poErr(req, ctx, "PROD_PO_MTS_PLAN_MATERIAL_REQUIRED", 422, `An Actual Material must be selected for ${group.stroke_line_material_id}`);
        }
        const chosenRow = group.rows.find((r) => r.actual_material_id === chosenMaterialId);
        const available = chosenRow?.available_qty ?? 0;
        if (available < group.standard_qty - EPSILON) {
          shortGroupLabels.push(group.stroke_line_material_id);
        }
        finalRows.push({
          stroke_line_id: group.stroke_line_id,
          stroke_line_material_id: group.stroke_line_material_id,
          actual_material_id: chosenMaterialId,
          is_formulation_line: true,
          dosage_pct: group.dosage_pct,
          planned_qty: group.standard_qty,
          actual_qty: group.standard_qty,
          storage_location_id: group.storage_location_id,
        });
      }
    }

    // Validate the completed plan as one allocation, rather than validating
    // each group independently against the same physical stock.  A material
    // can be an allowed alternate for more than one formulation line.
    const autoStrokeLineIds = new Set(
      serverGroups.filter((group) => group.auto_derive_applicable).map((group) => group.stroke_line_id),
    );
    const machineNeeds = new Map<string, number>();
    const manualNeeds = new Map<string, AvailabilityNeed>();
    const labelsByNeedKey = new Map<string, string[]>();
    for (const row of finalRows) {
      if (row.actual_qty <= EPSILON) continue;
      if (autoStrokeLineIds.has(row.stroke_line_id)) {
        machineNeeds.set(row.actual_material_id, Number(((machineNeeds.get(row.actual_material_id) ?? 0) + row.actual_qty).toFixed(6)));
      } else {
        const key = buildAvailabilityKey(row.actual_material_id, row.storage_location_id);
        const current = manualNeeds.get(key);
        manualNeeds.set(key, {
          materialId: row.actual_material_id,
          storageLocationId: row.storage_location_id,
          qty: Number(((current?.qty ?? 0) + row.actual_qty).toFixed(6)),
        });
        labelsByNeedKey.set(key, [...(labelsByNeedKey.get(key) ?? []), row.stroke_line_material_id]);
      }
    }
    if (machineNeeds.size > 0) {
      const useUnassignedBucket = Boolean(
        machineStorageLocationId && strokeShopFloorLocationId && machineStorageLocationId !== strokeShopFloorLocationId,
      );
      const freshBalances = machineStorageLocationId && machineId
        ? await fetchMachineBucketBalances(companyId, machineStorageLocationId, useUnassignedBucket ? null : machineId, [...machineNeeds.keys()])
        : new Map<string, number>();
      for (const [materialId, qty] of machineNeeds.entries()) {
        if (qty > Math.max(0, freshBalances.get(materialId) ?? 0) + EPSILON) {
          for (const row of finalRows.filter((r) => r.actual_material_id === materialId && autoStrokeLineIds.has(r.stroke_line_id))) {
            shortGroupLabels.push(row.stroke_line_material_id);
          }
        }
      }
    }
    if (manualNeeds.size > 0) {
      const availabilityRows = await computeAvailabilityRows(companyId, manualNeeds);
      for (const row of availabilityRows) {
        if (row.short) shortGroupLabels.push(...(labelsByNeedKey.get(buildAvailabilityKey(row.material_id, row.storage_location_id)) ?? []));
      }
    }

    if (shortGroupLabels.length > 0) {
      const detail = await formatMaterialLabels([...new Set(shortGroupLabels)]);
      return poErr(req, ctx, "PROD_PO_INSUFFICIENT_STOCK", 422, `Insufficient stock (formulation + alternates combined) for: ${detail}`);
    }

    const lineRows = finalRows.map((row, index) => ({
      process_order_id: id,
      stroke_line_id: row.stroke_line_id,
      material_id: row.stroke_line_material_id,
      actual_material_id: row.actual_material_id === row.stroke_line_material_id ? null : row.actual_material_id,
      planned_qty: row.planned_qty,
      actual_qty: row.actual_qty,
      uom_code: "KG",
      issue_sloc_id: row.storage_location_id,
      is_rm: true,
      display_order: index,
      dosage_pct: row.dosage_pct,
      is_formulation_line: row.is_formulation_line,
      // §138.12: AP-Approved defaults to Yes for every row, including
      // auto-derived split rows (business owner, 2026-09-18).
      approved_status: "YES",
      ap_approved_qty: row.actual_qty,
      // Confirmed-shortfall audit trail (2026-09-18 refinement) -- non-zero
      // only on a group's first row, only when the user explicitly accepted
      // an under-Standard save via the confirm modal.
      variance_qty: row.variance_qty ?? null,
    }));

    const atomicLines = lineRows.map((line) => ({ ...line, company_id: companyId }));
    const { data: linesCreated, error: saveErr } = await serviceRoleClient
      .schema("erp_production")
      .rpc("save_mts_material_plan_atomic", {
        p_process_order_id: id,
        p_actor_id: ctx.auth_user_id,
        p_required_by_date: toTrimmedString(po.production_date) || null,
        p_lines: atomicLines,
      });
    if (saveErr) {
      console.error("[process_order.saveMtsMaterialPlan] atomic save failed:", JSON.stringify(saveErr));
      throw new Error("PROD_PO_MTS_PLAN_SAVE_FAILED");
    }

    return createdOkResponse({ id, lines_created: Number(linesCreated ?? lineRows.length) }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PO_MTS_PLAN_SAVE_FAILED";
    return poErr(req, ctx, code, code === "PROD_PO_NOT_FOUND" ? 404 : 500, "Failed to save material plan");
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
    if (po.po_type === "MTS") {
      return poErr(req, ctx, "PROD_PO_MTS_EDIT_NOT_APPLICABLE", 422, "MTS Process POs cannot be edited. Reject at QA Approval for a non-current stroke, or reject at Verify once the PO is Verify-ready.");
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
    // MTS Policy 1 (Current Stroke) skips the extra QA Approval review: Page 6
    // creates the parent directly in FINAL, ready for the common Verify step.
    if (po.po_type === "MTS" && po.mts_used_current_stroke === true) {
      return poErr(req, ctx, "PROD_PO_QA_NOT_APPLICABLE", 422, "MTS Process Orders using the Current Stroke skip QA approval — they are ready for Verify after Page 6");
    }

    const lines = await fetchOrderLines(id, toTrimmedString(po.stroke_master_id) || null);
    if (lines.length === 0) {
      return poErr(req, ctx, "PROD_PO_NO_LINES", 422, "Cannot approve without RM lines");
    }

    // MTS Policy 2 (non-current stroke): Pages 1-6 are editable for the
    // operator, then QA signs off that immutable, Page-6-created plan.  There
    // is deliberately no separate Production Final screen afterwards.  QA
    // approval moves the parent straight to FINAL, making it eligible for the
    // common MTS Verify workspace.  Child PMTS orders remain STANDARD until
    // that one Verify-and-post action finalizes them together.
    if (po.po_type === "MTS") {
      const [snapshotResult, packingResult] = await Promise.all([
        serviceRoleClient
          .schema("erp_production")
          .from("mts_creation_snapshot")
          .select("process_order_id")
          .eq("process_order_id", id)
          .maybeSingle(),
        serviceRoleClient
          .schema("erp_production")
          .from("packing_order")
          .select("id, status, po_type")
          .eq("process_order_id", id),
      ]);
      if (snapshotResult.error || packingResult.error) {
        console.error("[process_order.qaApproveProcessOrder] MTS review lookup failed:", JSON.stringify(snapshotResult.error ?? packingResult.error));
        throw new Error("PROD_MTS_QA_APPROVE_FAILED");
      }
      const children = (packingResult.data ?? []) as JsonRecord[];
      if (!snapshotResult.data || children.length === 0 || children.some((child) => child.po_type !== "PMTS" || child.status !== "STANDARD")) {
        return poErr(req, ctx, "PROD_MTS_QA_APPROVE_STATE_INVALID", 422, "MTS approval requires its original Page-6 snapshot and untouched linked PMTS Packing POs");
      }

      const now = new Date().toISOString();
      const { data: updated, error } = await serviceRoleClient
        .schema("erp_production")
        .from("process_order")
        .update({
          status: "FINAL",
          priority: "NORMAL",
          qa_decided_by: ctx.auth_user_id,
          qa_decided_at: now,
          last_updated_at: now,
          last_updated_by: ctx.auth_user_id,
        })
        .eq("id", id)
        .eq("status", "STANDARD")
        .select("id")
        .maybeSingle();
      if (error) {
        console.error("[process_order.qaApproveProcessOrder] MTS update failed:", JSON.stringify(error));
        throw new Error("PROD_MTS_QA_APPROVE_FAILED");
      }
      if (!updated) {
        return poErr(req, ctx, "PROD_MTS_QA_APPROVE_STATE_INVALID", 422, "MTS Process PO changed while QA was reviewing it; reload the queue");
      }
      return okResponse({ id, status: "FINAL", priority: "NORMAL" }, ctx.request_id, req);
    }

    // §136 (2026-09-04) — QA sets Priority here (Normal default, Urgent
    // opt-in). Urgent routes through a new Manager Approval gate before
    // Start Batch (see managerApproveProcessOrderHandler/startBatchHandler)
    // and later unlocks the urgent_posting_date override at Verify.
    const body = await parseBody(req);
    const priority = toUpperTrimmedString(body.priority) || "NORMAL";
    if (!["NORMAL", "URGENT"].includes(priority)) {
      return poErr(req, ctx, "PROD_PO_PRIORITY_INVALID", 400, "priority must be NORMAL or URGENT");
    }

    const now = new Date().toISOString();
    const { error } = await serviceRoleClient
      .schema("erp_production")
      .from("process_order")
      .update({
        status: "QA_APPROVED",
        priority,
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

    return okResponse({ id, status: "QA_APPROVED", priority }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PO_QA_APPROVE_FAILED";
    return poErr(req, ctx, code, 500, "QA approve failed");
  }
}

// §136 (2026-09-04) — Urgent-only gate between QA_APPROVED and Start Batch.
// Gated by role-level ACL capability (CAP_QA_PLANTHEAD/CAP_QA_TIER_L3MGR,
// same shape as IN13's Block->Unrestricted maker-checker) — NOT by work
// context, since Plant Head (L3_MANAGER) frequently has no QUALITY work
// context assigned (verified live, prod, CMP003 + CMP006) but does carry
// these capabilities directly on the role. Same person who QA-approved can
// also Manager-approve, if they hold L2/L3 rank themselves — no distinct-
// person requirement (business owner's explicit choice).
export async function managerApproveProcessOrderHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    const id = getIdFromPath(req);
    if (!id) return poErr(req, ctx, "PROD_PO_ID_MISSING", 400, "ID required");

    const po = await fetchProcessOrder(id);
    if (!po) return poErr(req, ctx, "PROD_PO_NOT_FOUND", 404, "Not found");
    try {
      await assertCompanyScope(ctx, String(po.company_id ?? ""));
    } catch {
      return poErr(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }
    if (!(await canMaintainCompanyResource(ctx, String(po.company_id ?? ""), "PROD_QA_QUEUE", "MANAGER_APPROVE"))) {
      return poErr(req, ctx, "PROD_PO_COMPANY_ACCESS_DENIED", 403, "You do not have Manager Approval access for this company.");
    }
    if (po.priority !== "URGENT") {
      return poErr(req, ctx, "PROD_PO_MANAGER_APPROVAL_NOT_APPLICABLE", 422, "Manager Approval only applies to Urgent Process Orders.");
    }
    // §136 follow-up (2026-09-08): MTEST never passes through QA_APPROVED (§131.1) —
    // its Priority is set at creation instead (createProcessOrderHandler), so an Urgent
    // MTEST PO is still at STANDARD when it reaches Manager Approval, not QA_APPROVED.
    const requiredStatus = po.po_type === "MTEST" ? "STANDARD" : "QA_APPROVED";
    if (po.status !== requiredStatus) {
      return poErr(req, ctx, "PROD_PO_STATUS_INVALID", 422, `Expected ${requiredStatus}, got ${po.status}`);
    }

    const now = new Date().toISOString();
    const { error } = await serviceRoleClient
      .schema("erp_production")
      .from("process_order")
      .update({
        status: "MANAGER_APPROVED",
        manager_decided_by: ctx.auth_user_id,
        manager_decided_at: now,
        last_updated_at: now,
        last_updated_by: ctx.auth_user_id,
      })
      .eq("id", id);
    if (error) {
      console.error("[process_order.managerApproveProcessOrder] update failed:", JSON.stringify(error));
      throw new Error("PROD_PO_MANAGER_APPROVE_FAILED");
    }

    return okResponse({ id, status: "MANAGER_APPROVED" }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PO_MANAGER_APPROVE_FAILED";
    return poErr(req, ctx, code, 500, "Manager approve failed");
  }
}

// §136 follow-up (2026-09-08) — Manager Reject, the symmetric counterpart to Manager
// Approve. Business owner directive: same decision as QA Reject (CANCELLED, open
// reservations released) — just captured under manager_rejection_reason/
// manager_decided_by instead of QA's own fields, so the audit trail can tell a QA
// quality rejection apart from a Manager's own business/urgency call. Same access
// gate as Manager Approve (PROD_QA_QUEUE:MANAGER_APPROVE) — it is the other half of
// the same decision, not a QA action.
export async function managerRejectProcessOrderHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    const id = getIdFromPath(req);
    if (!id) return poErr(req, ctx, "PROD_PO_ID_MISSING", 400, "ID required");

    const po = await fetchProcessOrder(id);
    if (!po) return poErr(req, ctx, "PROD_PO_NOT_FOUND", 404, "Not found");
    try {
      await assertCompanyScope(ctx, String(po.company_id ?? ""));
    } catch {
      return poErr(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }
    if (!(await canMaintainCompanyResource(ctx, String(po.company_id ?? ""), "PROD_QA_QUEUE", "MANAGER_APPROVE"))) {
      return poErr(req, ctx, "PROD_PO_COMPANY_ACCESS_DENIED", 403, "You do not have Manager Approval access for this company.");
    }
    if (po.priority !== "URGENT") {
      return poErr(req, ctx, "PROD_PO_MANAGER_APPROVAL_NOT_APPLICABLE", 422, "Manager Reject only applies to Urgent Process Orders.");
    }
    const requiredStatus = po.po_type === "MTEST" ? "STANDARD" : "QA_APPROVED";
    if (po.status !== requiredStatus) {
      return poErr(req, ctx, "PROD_PO_STATUS_INVALID", 422, `Expected ${requiredStatus}, got ${po.status}`);
    }

    const body = await parseBody(req);
    const reason = toTrimmedString(body.reason);
    if (!reason) {
      return poErr(req, ctx, "PROD_MANAGER_REJECT_REASON_MISSING", 400, "reason required");
    }

    const now = new Date().toISOString();
    const { error } = await serviceRoleClient
      .schema("erp_production")
      .from("process_order")
      .update({
        status: "CANCELLED",
        manager_rejection_reason: reason,
        manager_decided_by: ctx.auth_user_id,
        manager_decided_at: now,
        prune_reason: reason,
        pruned_by: ctx.auth_user_id,
        pruned_at: now,
        last_updated_at: now,
        last_updated_by: ctx.auth_user_id,
      })
      .eq("id", id);
    if (error) {
      console.error("[process_order.managerRejectProcessOrder] update failed:", JSON.stringify(error));
      throw new Error("PROD_PO_MANAGER_REJECT_FAILED");
    }

    await cancelOpenReservationsForProcessOrder(id, ctx.auth_user_id, now);

    return okResponse({ id, status: "CANCELLED" }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PO_MANAGER_REJECT_FAILED";
    return poErr(req, ctx, code, 500, "Manager reject failed");
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
    // MTS Policy 1 (Current Stroke) — same as QA Approve, this order never had a
    // QA-approval checkpoint to reject at.
    if (po.po_type === "MTS" && po.mts_used_current_stroke === true) {
      return poErr(req, ctx, "PROD_PO_QA_NOT_APPLICABLE", 422, "MTS Process Orders using the Current Stroke skip QA approval — use Reverse instead of QA Reject");
    }

    const body = await parseBody(req);
    const reason = toTrimmedString(body.reason);
    if (!reason) {
      return poErr(req, ctx, "PROD_QA_REJECT_REASON_MISSING", 400, "reason required");
    }

    // MTS Page 6 creates the parent, every linked PMTS Packing PO, every
    // reservation, and the temporary batch claim as one unit.  Its QA-reject
    // path must unwind that same unit; asking QA to cancel children separately
    // would leave a half-rejected MTS session and keep stock/range blocked.
    if (po.po_type === "MTS") {
      const { error: rejectErr } = await serviceRoleClient
        .schema("erp_production")
        .rpc("reject_mts_documents_atomic", {
          p_process_order_id: id,
          p_actor_id: ctx.auth_user_id,
          p_reason: reason,
        });
      if (rejectErr) {
        console.error("[process_order.qaRejectProcessOrder] MTS atomic reject failed:", JSON.stringify(rejectErr));
        const message = String((rejectErr as { message?: string }).message ?? "");
        if (message.includes("PROD_MTS_")) return poErr(req, ctx, message.split(":" )[0], 422, "MTS QA reject could not safely cancel its linked documents");
        throw new Error("PROD_PO_QA_REJECT_FAILED");
      }
      return okResponse({ id, status: "CANCELLED" }, ctx.request_id, req);
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

    // MTS Page 3 (2026-09-17 lock) — Start Batch no longer exists for MTS at all.
    // The batch range is declared and its batch_number_instance rows go ACTIVE
    // at Create itself (createProcessOrderHandler), not at a later click. An MTS
    // PO reaches Verify from Page 6 (current stroke) or QA Approval (non-current
    // stroke). Fail loud instead of letting this stale route silently regenerate
    // a second, conflicting batch number.
    if (po.po_type === "MTS") {
      return poErr(req, ctx, "PROD_PO_START_BATCH_NOT_APPLICABLE", 422, "MTS Process Orders do not use Start Batch — Page 6 controls the batch plan and then leads to Verify.");
    }

    // §136 (2026-09-04): an URGENT MTO/HPS PO must clear Manager Approval first —
    // MANAGER_APPROVED replaces QA_APPROVED as the required status for it specifically.
    // §136 follow-up (2026-09-08): MTEST also has no QA_APPROVED step (§131.1 — QA is the
    // only actor, Standard creation IS the approval), but an URGENT MTEST PO still needs
    // Manager Approval before Start Batch, same as URGENT MTO/HPS — the required status
    // just starts from STANDARD instead of QA_APPROVED, since MTEST never passes through it.
    const requiredStatus = po.po_type === "MTEST"
      ? (po.priority === "URGENT" ? "MANAGER_APPROVED" : "STANDARD")
      : (po.priority === "URGENT" ? "MANAGER_APPROVED" : "QA_APPROVED");
    if (po.status !== requiredStatus) {
      return poErr(req, ctx, "PROD_PO_STATUS_INVALID", 422, `Must be ${requiredStatus} to start batch`);
    }

    const batchTypeMap: Record<string, string> = {
      MTO: "MTO",
      HPS: "HPS",
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
      // MTS-only: SA can mark a Prodshade's batch series manual-entry-only
      // (unchecked "auto-generate" on SA Batch Series) for a production line
      // where the batch number is decided by hand (e.g. a pre-printed
      // pack-size run) rather than sequentially assigned. This screen has no
      // manual-entry input yet -- fail loud instead of silently ignoring the
      // setting and auto-generating anyway.
      if (batchType === "MTS" && !(await isBatchSeriesAutoGenerate(companyId, batchType, prodshadeId))) {
        return poErr(req, ctx, "PROD_PO_MANUAL_BATCH_NUMBER_REQUIRED", 422, "This Prodshade's batch series is manual-entry-only -- Start Batch cannot auto-generate a number for it yet");
      }
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
    // MTS has no standalone Production Final screen.  Current-stroke MTS
    // reaches FINAL at Page 6; non-current MTS reaches FINAL when QA approves
    // its Page-6 plan.  Both continue directly to common QA Verify.
    if (po.po_type === "MTS") {
      return poErr(req, ctx, "PROD_PO_MTS_FINAL_NOT_APPLICABLE", 422, "MTS Process Orders move directly from Page 6 or QA Approval to Verify");
    }
    // Locked 2026-08-12: INT skips QA and Start Batch entirely (no batch number, per
    // §83.5) so it finalizes directly from STANDARD. MTO/HPS/MTEST still need
    // BATCH_STARTED (reached via Start Batch — MTEST skips the QA_APPROVED gate before
    // that per §131.1, but still needs BATCH_STARTED to reach Final). MTEST does NOT use
    // the postsAtFinal/INT branch below (its posting shape — RM+PM+SFG+QI-release+reco —
    // is nothing like INT's simple RM-only output) — instead, after the generic FINAL
    // write further down runs, MTEST calls runProcessOrderVerify() directly (see the
    // po.po_type === "MTEST" branch right after that write) so Final absorbs Verify in
    // one request, same posting logic verifyProcessOrderHandler uses for MTO/HPS/MTS.
    // MTS does not have a standalone Production Final step. It reaches FINAL at
    // Page 6 for a current stroke, or after the non-current QA Approval review,
    // then proceeds to its own Verify action.
    const requiredStatus = po.po_type === "INT"
      ? "STANDARD"
      : po.po_type === "MTS"
        ? (po.mts_used_current_stroke === true ? "STANDARD" : "QA_APPROVED")
        : "BATCH_STARTED";
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
    // MTS is deliberately not a variation of the normal Process-PO Verify
    // workflow. Its Page-6-created PMTS children supply the SKU output; posting
    // the generic path would incorrectly receive the prodshade as SFG and would
    // also make the MTS formulation editable. Keep this branch ahead of the
    // generic line-update routine so neither of those things can happen.
    if (po.po_type === "MTS") {
      return await runMtsProcessOrderVerify(req, ctx, po, id, body);
    }
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

const MTS_VERIFY_CHECK_CODES = [
  "PRODSHADE_DESCRIPTION",
  "STROKE",
  "MACHINE",
  "DATE_SHIFT",
  "BATCH_SIZE_COUNT",
  "BATCH_RANGE",
  "PLANNED_OUTPUT",
  "STORAGE_LOCATION",
  "PACKING_DECLARATION",
  "GAIN_LOSS",
] as const;

function mtsBatchSort(left: string, right: string): number {
  const leftMatch = left.match(/^(.*?)(\d+)$/);
  const rightMatch = right.match(/^(.*?)(\d+)$/);
  if (leftMatch && rightMatch && leftMatch[1] === rightMatch[1]) {
    return Number(leftMatch[2]) - Number(rightMatch[2]);
  }
  return left.localeCompare(right, undefined, { numeric: true });
}

function mtsQty(value: unknown): number {
  const quantity = Number(value ?? 0);
  return Number.isFinite(quantity) ? Number(quantity.toFixed(6)) : 0;
}

// §138 (2026-09-22, business owner): MTS Verify's RM/PM consumption must post one
// stock_ledger movement PER BATCH (its own batch_number), not one blended lump sum --
// stock_snapshot stays blended either way (matches MTO/HPS never splitting the snapshot
// by batch, §8D), only the ledger gains per-batch genealogy. Splits `totalQty`
// proportionally by each key's `weight` (a batch's own declared output share); the last
// weighted entry absorbs the rounding remainder so the split always sums back to exactly
// `totalQty`, never drifting from what was actually confirmed/entered.
function splitProportional(totalQty: number, weights: Array<{ key: string; weight: number }>): Array<{ key: string; qty: number }> {
  const positiveWeights = weights.filter((w) => w.weight > EPSILON);
  if (totalQty <= EPSILON || positiveWeights.length === 0) return [];
  const totalWeight = positiveWeights.reduce((sum, w) => sum + w.weight, 0);
  const result: Array<{ key: string; qty: number }> = [];
  let allocated = 0;
  positiveWeights.forEach((w, idx) => {
    const isLast = idx === positiveWeights.length - 1;
    const qty = isLast ? mtsQty(totalQty - allocated) : mtsQty(totalQty * (w.weight / totalWeight));
    if (!isLast) allocated = mtsQty(allocated + qty);
    if (qty > EPSILON) result.push({ key: w.key, qty });
  });
  return result;
}

async function computeMtsVerifyAvailabilityRows(
  companyId: string,
  needed: Map<string, AvailabilityNeed>,
  processOrderId: string,
  packingOrderIds: string[],
): Promise<AvailabilityRow[]> {
  const needs = Array.from(needed.values()).filter((item) => item.materialId && item.storageLocationId && item.qty > 0);
  if (needs.length === 0) return [];
  const materialIds = [...new Set(needs.map((item) => item.materialId))];
  const locationIds = [...new Set(needs.map((item) => item.storageLocationId))];
  const [snapshotResult, reservationResult] = await Promise.all([
    serviceRoleClient.schema("erp_inventory").from("stock_snapshot")
      .select("material_id, storage_location_id, quantity")
      .eq("company_id", companyId).eq("stock_type_code", "UNRESTRICTED")
      .in("material_id", materialIds).in("storage_location_id", locationIds),
    serviceRoleClient.schema("erp_production").from("reservation_document")
      .select("material_id, storage_location_id, balance_qty, source_type, source_id")
      .eq("company_id", companyId)
      .in("material_id", materialIds).in("storage_location_id", locationIds)
      .in("status", RESERVATION_OPEN_STATUSES),
  ]);
  if (snapshotResult.error || reservationResult.error) throw new Error("PROD_PO_STOCK_CHECK_FAILED");
  const available = new Map<string, number>();
  for (const row of (snapshotResult.data ?? []) as JsonRecord[]) {
    const key = buildAvailabilityKey(String(row.material_id), String(row.storage_location_id));
    available.set(key, (available.get(key) ?? 0) + Number(row.quantity ?? 0));
  }
  const ownPackingIds = new Set(packingOrderIds);
  for (const row of (reservationResult.data ?? []) as JsonRecord[]) {
    const isOwnProcessReservation = String(row.source_type) === "PROCESS_PO" && String(row.source_id) === processOrderId;
    const isOwnPackingReservation = String(row.source_type) === "PACKING_PO" && ownPackingIds.has(String(row.source_id));
    if (isOwnProcessReservation || isOwnPackingReservation) continue;
    const key = buildAvailabilityKey(String(row.material_id), String(row.storage_location_id));
    available.set(key, (available.get(key) ?? 0) - Number(row.balance_qty ?? 0));
  }
  return needs.map((item) => {
    const availableQty = Math.max(0, available.get(buildAvailabilityKey(item.materialId, item.storageLocationId)) ?? 0);
    return {
      material_id: item.materialId,
      storage_location_id: item.storageLocationId,
      needed_qty: item.qty,
      available_qty: availableQty,
      short: availableQty < item.qty - EPSILON,
    };
  });
}

async function runMtsProcessOrderVerify(
  req: Request,
  ctx: ProdHandlerContext,
  po: JsonRecord,
  id: string,
  body: JsonRecord,
): Promise<Response> {
  const action = toUpperTrimmedString(body.mts_action);
  if (action === "REJECT") {
    const reason = toTrimmedString(body.reason);
    if (!reason) return poErr(req, ctx, "PROD_MTS_REJECT_REASON_REQUIRED", 400, "A rejection reason is required.");
    const { error } = await serviceRoleClient.schema("erp_production").rpc("reject_mts_documents_atomic", {
      p_process_order_id: id,
      p_actor_id: ctx.auth_user_id,
      p_reason: reason,
    });
    if (error) {
      console.error("[process_order.runMtsProcessOrderVerify] reject failed:", JSON.stringify(error));
      throw new Error("PROD_MTS_REJECT_FAILED");
    }
    return okResponse({ id, status: "CANCELLED", action: "REJECTED_AND_RELEASED" }, ctx.request_id, req);
  }
  if (action !== "APPROVE") {
    return poErr(req, ctx, "PROD_MTS_VERIFY_ACTION_REQUIRED", 400, "Choose Approve or Reject for this MTS Process PO.");
  }

  const submittedChecks = Array.isArray(body.checklist) ? body.checklist.map((item) => toUpperTrimmedString(item)).filter(Boolean) : [];
  const checks = [...new Set(submittedChecks)];
  const missingChecks = MTS_VERIFY_CHECK_CODES.filter((code) => !checks.includes(code));
  if (missingChecks.length > 0) {
    return poErr(req, ctx, "PROD_MTS_VERIFY_CHECKLIST_INCOMPLETE", 422, "Complete every MTS QA checklist item before approving.");
  }
  if (checks.some((code) => !MTS_VERIFY_CHECK_CODES.includes(code as typeof MTS_VERIFY_CHECK_CODES[number]))) {
    return poErr(req, ctx, "PROD_MTS_VERIFY_CHECKLIST_INVALID", 400, "The MTS QA checklist contains an unsupported item.");
  }

  const strokeMasterId = toTrimmedString(po.stroke_master_id) || null;
  const [processLines, packingResult, yieldResult] = await Promise.all([
    fetchOrderLines(id, strokeMasterId),
    serviceRoleClient.schema("erp_production").from("packing_order")
      .select("id, po_number, status, material_id, fill_qty_per_pack, planned_qty_kg, actual_qty_kg, batch_number_from, batch_number_to")
      .eq("process_order_id", id).neq("status", "CANCELLED").neq("status", "REVERSED"),
    serviceRoleClient.schema("erp_production").from("mts_batch_yield_variance")
      .select("id, packing_order_id, packing_plan_row_id, batch_number, sku_material_id, expected_qty, declared_actual_qty, variance_qty, variance_type, uom_code, status")
      .eq("process_order_id", id),
  ]);
  if (packingResult.error || yieldResult.error) throw new Error("PROD_MTS_VERIFY_FETCH_FAILED");
  const packingOrders = (packingResult.data ?? []) as JsonRecord[];
  const yields = (yieldResult.data ?? []) as JsonRecord[];
  if (packingOrders.length === 0 || yields.length !== Number(po.number_of_batches ?? 0)) {
    return poErr(req, ctx, "PROD_MTS_VERIFY_DOCUMENTS_INCOMPLETE", 422, "MTS packing declarations are incomplete. Reject this MTS Process PO and create it again.");
  }
  if (packingOrders.some((order) => String(order.status) !== "STANDARD") || yields.some((item) => String(item.status) !== "PENDING")) {
    return poErr(req, ctx, "PROD_MTS_VERIFY_STATUS_INVALID", 422, "This MTS Process PO is no longer pending QA verification.");
  }
  const packingOrderIds = packingOrders.map((order) => String(order.id));
  const { data: packingLineData, error: packingLineError } = await serviceRoleClient
    .schema("erp_production").from("packing_order_line")
    .select("id, packing_order_id, line_type, material_id, actual_material_id, qty_per_pack, total_qty, actual_qty, issue_sloc_id, uom_code, stock_ledger_id, variance_qty")
    .in("packing_order_id", packingOrderIds).order("display_order", { ascending: true });
  if (packingLineError) throw new Error("PROD_MTS_VERIFY_FETCH_FAILED");
  const packingLines = (packingLineData ?? []) as JsonRecord[];

  // §138 (2026-09-21): Page 4/6's RM/PM total may have been saved with a
  // confirmed deviation from the formula's own Standard Qty (either
  // direction). That confirmation happened well before Verify, possibly by
  // a different person -- QA must see and re-confirm it one last time here,
  // right before the irreversible stock posting. Never gates or classifies
  // the deviation (no approved_status/AP-approved concept for MTS), purely
  // a final "are you sure" before Approve commits.
  const rmDeviations = processLines
    .filter((line) => Math.abs(mtsQty(line.variance_qty)) > EPSILON)
    .map((line) => ({ material_id: toTrimmedString(line.actual_material_id) || String(line.material_id), variance_qty: mtsQty(line.variance_qty) }));
  const pmDeviations = packingLines
    .filter((line) => String(line.line_type) === "PM" && Math.abs(mtsQty(line.variance_qty)) > EPSILON)
    .map((line) => ({ material_id: toTrimmedString(line.actual_material_id) || String(line.material_id), variance_qty: mtsQty(line.variance_qty) }));
  const allDeviations = [...rmDeviations, ...pmDeviations];
  if (allDeviations.length > 0 && body.confirmed_deviation !== true) {
    // The frontend already has po.lines/po.packing_orders[].lines (with
    // variance_qty) from its own GET, so it builds and shows the detailed
    // warning modal itself before ever calling Approve -- this is a
    // server-side backstop (never trust the client), not the primary way
    // the operator learns which materials deviated.
    return poErr(req, ctx, "PROD_MTS_VERIFY_DEVIATION_NOT_CONFIRMED", 422, "One or more RM/PM lines deviate from the formula's Standard Qty. Confirm before posting.");
  }
  const materialIds = [
    ...processLines.flatMap((line) => [toTrimmedString(line.material_id), toTrimmedString(line.actual_material_id)]),
    ...packingLines.flatMap((line) => [toTrimmedString(line.material_id), toTrimmedString(line.actual_material_id)]),
    ...packingOrders.map((order) => toTrimmedString(order.material_id)),
  ].filter(Boolean);
  const materialMap = await getMaterialMapByIds(materialIds, "[process_order.runMtsProcessOrderVerify]", "PROD_MTS_VERIFY_FETCH_FAILED", "id, base_uom_code, material_type");
  const linesByPackingOrder = new Map<string, JsonRecord[]>();
  for (const line of packingLines) {
    const orderId = String(line.packing_order_id);
    linesByPackingOrder.set(orderId, [...(linesByPackingOrder.get(orderId) ?? []), line]);
  }
  const yieldsByPackingOrder = new Map<string, JsonRecord[]>();
  for (const yieldRow of yields) {
    const orderId = String(yieldRow.packing_order_id);
    yieldsByPackingOrder.set(orderId, [...(yieldsByPackingOrder.get(orderId) ?? []), yieldRow]);
  }
  for (const [packingOrderId, orderYields] of yieldsByPackingOrder) {
    const order = packingOrders.find((item) => String(item.id) === packingOrderId);
    if (!order || orderYields.length === 0 || orderYields.some((item) => String(item.sku_material_id) !== String(order.material_id))) {
      return poErr(req, ctx, "PROD_MTS_VERIFY_YIELD_INVALID", 422, "MTS batch output does not match its Packing PO declaration.");
    }
  }

  const expectedTotal = yields.reduce((sum, item) => sum + mtsQty(item.expected_qty), 0);
  const declaredTotal = yields.reduce((sum, item) => sum + mtsQty(item.declared_actual_qty), 0);
  if (expectedTotal <= EPSILON || declaredTotal <= EPSILON) {
    return poErr(req, ctx, "PROD_MTS_VERIFY_OUTPUT_INVALID", 422, "Declared MTS SKU output must be greater than zero.");
  }

  const pmActualQtyByLine = new Map<string, number>();
  const packingActualQtyById = new Map<string, number>();
  for (const order of packingOrders) {
    const orderId = String(order.id);
    const fillQty = mtsQty(order.fill_qty_per_pack);
    if (fillQty <= EPSILON) return poErr(req, ctx, "PROD_MTS_VERIFY_PACK_FILL_INVALID", 422, "A linked MTS Packing PO has no valid fill quantity.");
    const orderYields = yieldsByPackingOrder.get(orderId) ?? [];
    const orderActualQty = orderYields.reduce((sum, item) => sum + mtsQty(item.declared_actual_qty), 0);
    packingActualQtyById.set(orderId, orderActualQty);
    const actualPacks = orderActualQty / fillQty;
    for (const line of linesByPackingOrder.get(orderId) ?? []) {
      if (String(line.line_type) === "PM") pmActualQtyByLine.set(String(line.id), mtsQty(mtsQty(line.qty_per_pack) * actualPacks));
    }
  }

  const needs = new Map<string, AvailabilityNeed>();
  const addNeed = (materialId: string, storageLocationId: string, quantity: number) => {
    if (!materialId || !storageLocationId || quantity <= EPSILON) return;
    const key = buildAvailabilityKey(materialId, storageLocationId);
    const previous = needs.get(key);
    needs.set(key, { materialId, storageLocationId, qty: (previous?.qty ?? 0) + quantity });
  };
  for (const line of processLines) addNeed(toTrimmedString(line.actual_material_id) || String(line.material_id ?? ""), toTrimmedString(line.issue_sloc_id), mtsQty(line.actual_qty ?? line.planned_qty));
  for (const line of packingLines) {
    if (String(line.line_type) !== "PM") continue;
    addNeed(toTrimmedString(line.actual_material_id) || String(line.material_id ?? ""), toTrimmedString(line.issue_sloc_id), pmActualQtyByLine.get(String(line.id)) ?? 0);
  }
  const shortages = (await computeMtsVerifyAvailabilityRows(String(po.company_id), needs, id, packingOrderIds)).filter((item) => item.short);
  if (shortages.length > 0) {
    return poErr(req, ctx, "PROD_MTS_INSUFFICIENT_STOCK", 422, `Insufficient unrestricted stock for MTS Verify: ${await formatShortageDetail(shortages)}`);
  }

  const requestedHolds = Array.isArray(body.holds) ? body.holds as JsonRecord[] : [];
  const remainingPacksByBatch = new Map<string, number>();
  const holdAllocations: JsonRecord[] = [];
  for (const yieldRow of yields) {
    const order = packingOrders.find((item) => String(item.id) === String(yieldRow.packing_order_id));
    const fillQty = mtsQty(order?.fill_qty_per_pack);
    remainingPacksByBatch.set(String(yieldRow.id), fillQty > EPSILON ? mtsQty(mtsQty(yieldRow.declared_actual_qty) / fillQty) : 0);
  }
  for (const requestedHold of requestedHolds) {
    const orderId = toTrimmedString(requestedHold.packing_order_id);
    const fromBatch = toTrimmedString(requestedHold.batch_number_from);
    const toBatch = toTrimmedString(requestedHold.batch_number_to);
    const targetStockType = toUpperTrimmedString(requestedHold.target_stock_type);
    const requestedPacks = mtsQty(requestedHold.qty_packs);
    if (!orderId || !fromBatch || !toBatch || requestedPacks <= EPSILON) {
      return poErr(req, ctx, "PROD_MTS_HOLD_INPUT_INVALID", 422, "Every MTS QA hold needs a Packing PO, batch range, stock status, and positive bag quantity.");
    }
    if (!["QUALITY_INSPECTION", "BLOCKED"].includes(targetStockType)) {
      return poErr(req, ctx, "PROD_MTS_HOLD_STATUS_INVALID", 422, "MTS QA hold status must be Quality Inspection or Blocked.");
    }
    const order = packingOrders.find((item) => String(item.id) === orderId);
    if (!order) return poErr(req, ctx, "PROD_MTS_HOLD_PACKING_PO_INVALID", 422, "The selected MTS QA hold Packing PO does not belong to this Process PO.");
    const orderedYields = [...(yieldsByPackingOrder.get(orderId) ?? [])].sort((left, right) => mtsBatchSort(String(left.batch_number), String(right.batch_number)));
    const fromIndex = orderedYields.findIndex((item) => String(item.batch_number) === fromBatch);
    const toIndex = orderedYields.findIndex((item) => String(item.batch_number) === toBatch);
    if (fromIndex < 0 || toIndex < fromIndex) return poErr(req, ctx, "PROD_MTS_HOLD_RANGE_INVALID", 422, "MTS QA hold batch range is not valid for its selected Packing PO.");
    let leftToAllocate = requestedPacks;
    for (const yieldRow of orderedYields.slice(fromIndex, toIndex + 1)) {
      if (leftToAllocate <= EPSILON) break;
      const availablePacks = remainingPacksByBatch.get(String(yieldRow.id)) ?? 0;
      const allocatedPacks = Math.min(availablePacks, leftToAllocate);
      if (allocatedPacks <= EPSILON) continue;
      remainingPacksByBatch.set(String(yieldRow.id), mtsQty(availablePacks - allocatedPacks));
      leftToAllocate = mtsQty(leftToAllocate - allocatedPacks);
      holdAllocations.push({
        packing_order_id: orderId,
        yield_id: String(yieldRow.id),
        batch_number_from: fromBatch,
        batch_number_to: toBatch,
        batch_number: String(yieldRow.batch_number),
        sku_material_id: String(yieldRow.sku_material_id),
        target_stock_type: targetStockType,
        declared_pack_qty: mtsQty(mtsQty(yieldRow.declared_actual_qty) / mtsQty(order.fill_qty_per_pack)),
        held_pack_qty: allocatedPacks,
        qty_kg: mtsQty(allocatedPacks * mtsQty(order.fill_qty_per_pack)),
      });
    }
    if (leftToAllocate > EPSILON) return poErr(req, ctx, "PROD_MTS_HOLD_EXCEEDS_DECLARATION", 422, "MTS QA hold bags cannot exceed the declared SKU output for the selected batch range.");
  }

  const today = todayIso();
  const docNumber = String(po.po_number);
  const matDoc = await generateMaterialDocNumber(String(po.company_id));
  const rateMap = await fetchUnrestrictedRates(String(po.company_id), Array.from(needs.values()).map((item) => ({ materialId: item.materialId, slocId: item.storageLocationId })));
  const conversionRate = await resolveConversionRate(String(po.company_id), String(po.segment_code ?? ""), String(po.material_id), today);
  if (conversionRate === null) return poErr(req, ctx, "PROD_PO_CONVERSION_RATE_MISSING", 422, "Conversion cost rate is not configured for this segment/prodshade as of the posting date.");

  // §138 (2026-09-22): batch-ordered yields, used to distribute RM (whole Process PO
  // range, weighted by every batch's own declared output) and PM (its own Packing PO's
  // batches only) actual consumption per batch at posting time -- see splitProportional.
  const orderedYields = [...yields].sort((a, b) => mtsBatchSort(String(a.batch_number), String(b.batch_number)));
  const yieldsByPackingOrderSorted = new Map<string, JsonRecord[]>();
  for (const [orderId, orderYields] of yieldsByPackingOrder) {
    yieldsByPackingOrderSorted.set(orderId, [...orderYields].sort((a, b) => mtsBatchSort(String(a.batch_number), String(b.batch_number))));
  }
  const rmBatchWeights = orderedYields.map((y) => ({ key: String(y.batch_number), weight: mtsQty(y.declared_actual_qty) }));

  const movements: MovementSpec[] = [];
  const reservationUpdates: JsonRecord[] = [];
  const machineStockLogRows: JsonRecord[] = [];
  const processLinePostings: JsonRecord[] = [];
  const packingLineUpdates: JsonRecord[] = [];
  let totalInputValue = 0;
  const reservationMap = await fetchReservationRowsBySourceLineIds([...processLines.map((line) => String(line.id)), ...packingLines.map((line) => String(line.id))]);
  let machineStorageLocationId: string | null = null;
  if (toTrimmedString(po.machine_id)) {
    const { data: machineData, error: machineError } = await serviceRoleClient.schema("erp_master").from("machine_master")
      .select("storage_location_id").eq("id", String(po.machine_id)).maybeSingle();
    if (machineError) throw new Error("PROD_PO_MACHINE_BUCKET_LOOKUP_FAILED");
    machineStorageLocationId = toTrimmedString((machineData as JsonRecord | null)?.storage_location_id) || null;
  }
  // §138.4: an exception ("Select all MTS machines") consumption must log as an
  // Unassigned-bucket OUT, not a real machine-bucket OUT -- Page 4's own
  // availability check (buildMtsMaterialPlanGroupsForOrder/saveMtsMaterialPlanHandler)
  // already reads it that way (isForeignMachine/useUnassignedBucket -> machine_id
  // filter null), but this Verify-time writer previously tagged every RM line with
  // po.machine_id regardless, which would falsely deplete that machine's real bucket
  // at a location it was never actually allotted stock in. Recompute the same
  // foreign-machine check here from the stroke's own declared location.
  let isForeignMachineConsumption = false;
  if (machineStorageLocationId) {
    const { data: strokeRow, error: strokeErr } = await serviceRoleClient.schema("erp_production").from("stroke_master")
      .select("default_storage_location_id").eq("id", String(po.stroke_master_id)).maybeSingle();
    if (strokeErr) throw new Error("PROD_PO_MACHINE_BUCKET_LOOKUP_FAILED");
    const strokeShopFloorLocationId = toTrimmedString((strokeRow as JsonRecord | null)?.default_storage_location_id) || null;
    isForeignMachineConsumption = Boolean(strokeShopFloorLocationId && machineStorageLocationId !== strokeShopFloorLocationId);
  }
  const addReservationUpdate = (lineId: string, actualQty: number) => {
    const reservation = reservationMap.get(lineId);
    if (!reservation || !RESERVATION_OPEN_STATUSES.includes(String(reservation.status))) return;
    reservationUpdates.push({ reservation_id: String(reservation.id), issued_qty: actualQty, status: "FULLY_ISSUED" });
  };
  for (const line of processLines) {
    const actualQty = mtsQty(line.actual_qty ?? line.planned_qty);
    if (actualQty <= EPSILON) continue;
    const materialId = toTrimmedString(line.actual_material_id) || String(line.material_id);
    const slocId = toTrimmedString(line.issue_sloc_id);
    const rate = rateMap.get(`${materialId}|${slocId}`) ?? 0;
    totalInputValue += actualQty * rate;
    // §138 (2026-09-22): one P261 per batch, its own batch_number, proportional to that
    // batch's own share of the whole Process PO's declared output -- was previously one
    // blended lump-sum posting with batch_number: null. process_order_line only has one
    // stock_ledger_id column, so only the first batch's posting is registered as the
    // line's idempotency/reversal reference (safe: all batches share the same rate above,
    // computed once per material+location, not per batch).
    const perBatch = splitProportional(actualQty, rmBatchWeights);
    const lineRefs: string[] = [];
    for (const { key: batchNumber, qty } of perBatch) {
      const lineRef = `MTS_RM:${String(line.id)}:${batchNumber}`;
      lineRefs.push(lineRef);
      movements.push(toMovement({ documentNumber: docNumber, documentDate: today, postingDate: today, movementTypeCode: "P261", companyId: po.company_id, storageLocationId: slocId, materialId, quantity: qty, baseUomCode: String((materialMap.get(materialId) ?? {}).base_uom_code ?? line.uom_code ?? "KG"), unitValue: rate, stockTypeCode: "UNRESTRICTED", direction: "OUT", postedBy: ctx.auth_user_id, batchNumber, matDoc, referenceDocumentId: id }, lineRef));
    }
    processLinePostings.push({ process_order_line_id: String(line.id), line_ref: lineRefs[0] ?? null });
    addReservationUpdate(String(line.id), actualQty);
    if (machineStorageLocationId && machineStorageLocationId === slocId) machineStockLogRows.push({ company_id: po.company_id, storage_location_id: slocId, material_id: materialId, machine_id: isForeignMachineConsumption ? null : po.machine_id, batch_number: null, qty: actualQty, direction: "OUT", source_type: "CONSUMPTION", reference_document_type: "PROCESS_PO", reference_document_id: id, created_by: ctx.auth_user_id });
  }
  for (const line of packingLines) {
    const lineType = String(line.line_type);
    if (lineType === "FG") continue; // handled in its own per-batch loop below
    const actualQty = lineType === "PM" ? (pmActualQtyByLine.get(String(line.id)) ?? 0) : 0;
    if (lineType !== "PM") {
      packingLineUpdates.push({ packing_order_line_id: String(line.id), line_ref: null, actual_qty: actualQty });
      continue;
    }
    if (actualQty <= EPSILON) {
      packingLineUpdates.push({ packing_order_line_id: String(line.id), line_ref: null, actual_qty: actualQty });
      continue;
    }
    const materialId = toTrimmedString(line.actual_material_id) || String(line.material_id);
    const slocId = toTrimmedString(line.issue_sloc_id);
    const rate = rateMap.get(`${materialId}|${slocId}`) ?? 0;
    totalInputValue += actualQty * rate;
    // §138 (2026-09-22): one P261 per batch WITHIN this line's own Packing PO (a Page-5
    // row/Packing PO may cover only a sub-range of the Process PO's batches), proportional
    // to each batch's own declared output share -- same rationale as the RM loop above.
    const orderYields = yieldsByPackingOrderSorted.get(String(line.packing_order_id)) ?? [];
    const pmBatchWeights = orderYields.map((y) => ({ key: String(y.batch_number), weight: mtsQty(y.declared_actual_qty) }));
    const perBatch = splitProportional(actualQty, pmBatchWeights);
    const lineRefs: string[] = [];
    for (const { key: batchNumber, qty } of perBatch) {
      const lineRef = `MTS_PM:${String(line.id)}:${batchNumber}`;
      lineRefs.push(lineRef);
      movements.push(toMovement({ documentNumber: docNumber, documentDate: today, postingDate: today, movementTypeCode: "P261", companyId: po.company_id, storageLocationId: slocId, materialId, quantity: qty, baseUomCode: String((materialMap.get(materialId) ?? {}).base_uom_code ?? line.uom_code ?? "KG"), unitValue: rate, stockTypeCode: "UNRESTRICTED", direction: "OUT", postedBy: ctx.auth_user_id, batchNumber, matDoc, referenceDocumentId: id }, lineRef));
    }
    packingLineUpdates.push({ packing_order_line_id: String(line.id), line_ref: lineRefs[0] ?? null, actual_qty: actualQty });
    addReservationUpdate(String(line.id), actualQty);
  }
  const skuUnitValue = declaredTotal > EPSILON ? (totalInputValue / declaredTotal) + Number(conversionRate) : Number(conversionRate);
  // §138 (2026-09-22): one P101 per batch (per yield row), its own batch_number, instead
  // of one blended lump-sum per Packing PO -- FG/SKU already has exact per-batch qty via
  // `yields`, no proportional split needed here, just post each batch's own declared_actual_qty.
  for (const order of packingOrders) {
    const orderId = String(order.id);
    const orderYields = yieldsByPackingOrderSorted.get(orderId) ?? [];
    const fgLine = (linesByPackingOrder.get(orderId) ?? []).find((line) => String(line.line_type) === "FG");
    if (orderYields.length === 0) {
      if (fgLine) packingLineUpdates.push({ packing_order_line_id: String(fgLine.id), line_ref: null, actual_qty: 0 });
      continue;
    }
    const outputSlocId = toTrimmedString(fgLine?.issue_sloc_id);
    if (!outputSlocId) return poErr(req, ctx, "PROD_MTS_SKU_SLOC_MISSING", 422, "A linked MTS SKU Packing PO has no output storage location.");
    const skuMaterialId = String(order.material_id);
    const lineRefs: string[] = [];
    for (const yieldRow of orderYields) {
      const outputQty = mtsQty(yieldRow.declared_actual_qty);
      if (outputQty <= EPSILON) continue;
      const batchNumber = String(yieldRow.batch_number);
      const lineRef = `MTS_SKU:${String(fgLine?.id ?? order.id)}:${batchNumber}`;
      lineRefs.push(lineRef);
      movements.push(toMovement({ documentNumber: docNumber, documentDate: today, postingDate: today, movementTypeCode: "P101", companyId: po.company_id, storageLocationId: outputSlocId, materialId: skuMaterialId, quantity: outputQty, baseUomCode: String((materialMap.get(skuMaterialId) ?? {}).base_uom_code ?? "KG"), unitValue: skuUnitValue, stockTypeCode: "UNRESTRICTED", direction: "IN", postedBy: ctx.auth_user_id, batchNumber, matDoc, referenceDocumentId: id }, lineRef));
    }
    if (fgLine) packingLineUpdates.push({ packing_order_line_id: String(fgLine.id), line_ref: lineRefs[0] ?? null, actual_qty: packingActualQtyById.get(orderId) ?? 0 });
  }
  // §138 (2026-09-22): grouping key now includes batch_number, so a QA hold posting stays
  // tied to the specific batch it was held from -- holdAllocations is already per-batch
  // (built off each yield row above), this just stops merging different batches' holds
  // into one blended posting the way the pre-2026-09-22 grouping did.
  const statusPostingGroups = new Map<string, JsonRecord>();
  for (const allocation of holdAllocations) {
    const order = packingOrders.find((item) => String(item.id) === String(allocation.packing_order_id));
    const fgLine = (linesByPackingOrder.get(String(allocation.packing_order_id)) ?? []).find((line) => String(line.line_type) === "FG");
    const storageLocationId = toTrimmedString(fgLine?.issue_sloc_id);
    const batchNumber = String(allocation.batch_number);
    const key = `${allocation.sku_material_id}|${storageLocationId}|${allocation.target_stock_type}|${batchNumber}`;
    const group = statusPostingGroups.get(key) ?? { material_id: allocation.sku_material_id, storage_location_id: storageLocationId, target_stock_type: allocation.target_stock_type, batch_number: batchNumber, quantity: 0, uom_code: "KG", packing_order_id: order?.id ?? null };
    group.quantity = mtsQty(Number(group.quantity) + Number(allocation.qty_kg));
    statusPostingGroups.set(key, group);
  }
  const statusPostings: JsonRecord[] = [];
  let statusIndex = 0;
  for (const group of statusPostingGroups.values()) {
    const movementTypeCode = group.target_stock_type === "QUALITY_INSPECTION" ? "P322" : "P344";
    const outRef = `MTS_HOLD_OUT:${statusIndex}`;
    const inRef = `MTS_HOLD_IN:${statusIndex}`;
    const batchNumber = String(group.batch_number);
    movements.push(toMovement({ documentNumber: docNumber, documentDate: today, postingDate: today, movementTypeCode, companyId: po.company_id, storageLocationId: group.storage_location_id, materialId: group.material_id, quantity: group.quantity, baseUomCode: group.uom_code, unitValue: skuUnitValue, stockTypeCode: "UNRESTRICTED", direction: "OUT", postedBy: ctx.auth_user_id, batchNumber, matDoc, referenceDocumentId: id }, outRef));
    movements.push(toMovement({ documentNumber: docNumber, documentDate: today, postingDate: today, movementTypeCode, companyId: po.company_id, storageLocationId: group.storage_location_id, materialId: group.material_id, quantity: group.quantity, baseUomCode: group.uom_code, unitValue: skuUnitValue, stockTypeCode: group.target_stock_type, direction: "IN", postedBy: ctx.auth_user_id, batchNumber, matDoc, referenceDocumentId: id }, inRef));
    statusPostings.push({ ...group, movement_type_code: movementTypeCode, out_ref: outRef, in_ref: inRef });
    statusIndex += 1;
  }

  // §138 MTS reco decision (business owner, 2026-09-21): AC10's dispatch-driven
  // AP Reco derivation never depends on MTS's actual RM/PM consumption -- only
  // dispatch qty + formulation + costing-vs-WAR rate difference. MTS Verify
  // therefore never writes process_order_line_reco/packing_order_line_reco;
  // MTO/HPS/MTEST's own reco-writing logic below (runProcessOrderVerify) is
  // untouched.
  const postings = await postDocument({
    referenceDocumentType: "PROC_PO",
    referenceDocumentId: id,
    movements,
    postedBy: ctx.auth_user_id,
    context: {
      header: { actual_qty: declaredTotal, verified_by: ctx.auth_user_id, last_updated_by: ctx.auth_user_id, has_unapproved_deviation: false },
      reservations: reservationUpdates,
      machine_stock_log_rows: machineStockLogRows,
      mts_verify: {
        checks: checks.map((code) => ({ check_code: code })),
        yield_ids: yields.map((item) => String(item.id)),
        packing_orders: packingOrders.map((item) => ({ packing_order_id: String(item.id), actual_qty_kg: packingActualQtyById.get(String(item.id)) ?? 0 })),
        process_line_postings: processLinePostings,
        packing_line_updates: packingLineUpdates,
        hold_allocations: holdAllocations,
        status_postings: statusPostings,
      },
    },
  });
  return okResponse({ id, status: "VERIFIED", verified_qty: declaredTotal, ledger_entries: postings, message: "MTS QA verification and stock posting completed." }, ctx.request_id, req);
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

    // §136 (2026-09-04) — URGENT priority posts at Current date−1 automatically,
    // no manual entry. Everything else (documentDate/postingDate throughout this
    // function, conversion-rate resolution) reads this same `today` value.
    const realToday = todayIso();
    const today = po.priority === "URGENT" ? addDaysIso(realToday, -1) : realToday;
    const docNumber = String(po.po_number);
    const postedBy = ctx.auth_user_id;
    const batchNumber = toTrimmedString(po.batch_number) || null;
    // Collected here, posted once at the end via post_document — nothing below
    // touches the database until that single transactional call.
    const movements: MovementSpec[] = [];
    const reservationUpdates: Array<{ reservation_id: string; issued_qty: number; status: string }> = [];
    const machineStockLogRows: JsonRecord[] = [];
    const reservationMap = await fetchReservationRowsBySourceLineIds(lines.map((line) => String(line.id)));

    // MTS bucket attribution must move with the real P261 issue. A normal
    // machine consumes its own bucket; §138.4 foreign-machine override
    // consumes the selected location's Unassigned bucket. R001/manual lines
    // are deliberately absent from this side-table.
    let mtsMachineStorageLocationId: string | null = null;
    let mtsConsumptionMachineId: string | null = null;
    if (po.po_type === "MTS" && toTrimmedString(po.machine_id)) {
      const { data: machineRow, error: machineErr } = await serviceRoleClient
        .schema("erp_master").from("machine_master")
        .select("storage_location_id").eq("id", String(po.machine_id)).maybeSingle();
      if (machineErr) throw new Error("PROD_PO_MACHINE_BUCKET_LOOKUP_FAILED");
      mtsMachineStorageLocationId = toTrimmedString((machineRow as JsonRecord | null)?.storage_location_id) || null;
      mtsConsumptionMachineId = mtsMachineStorageLocationId === shopfloorSlocId ? String(po.machine_id) : null;
    }

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

      if (mtsMachineStorageLocationId && slocId === mtsMachineStorageLocationId) {
        machineStockLogRows.push({
          company_id: po.company_id,
          storage_location_id: slocId,
          material_id: movementMaterialId,
          machine_id: mtsConsumptionMachineId,
          batch_number: batchNumber,
          qty: actualQty,
          direction: "OUT",
          source_type: "CONSUMPTION",
          reference_document_type: "PROCESS_PO",
          reference_document_id: po.id,
          created_by: ctx.auth_user_id,
        });
      }

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

    // §135.9 (2026-09-10 fix): `po` is fetched via fetchProcessOrder()'s `select("*")` --
    // no `stroke` relation embed -- so `po.stroke` was always undefined here and this
    // line always wrote NULL, for every real PRODUCTION-origin reco row ever written
    // (verified live: 2619 of 2619 PRODUCTION rows had stroke_number=NULL, while
    // OPENING/PARTIAL_REVERSAL rows -- which each do their own explicit stroke_master
    // lookup -- were correctly populated). Explicit lookup instead, matching the
    // pattern already used elsewhere in this codebase (packing_order.handlers.ts,
    // sfg_qa.handlers.ts) for the same cross-schema (erp_production) relation.
    const strokeMasterId = toTrimmedString(po.stroke_master_id) || null;
    let strokeNumber: string | null = null;
    if (strokeMasterId) {
      const { data: strokeRow, error: strokeLookupError } = await serviceRoleClient
        .schema("erp_production").from("stroke_master")
        .select("stroke_number").eq("id", strokeMasterId).maybeSingle();
      if (strokeLookupError) throw new Error("PROD_PO_VERIFY_STROKE_LOOKUP_FAILED");
      strokeNumber = toTrimmedString((strokeRow as JsonRecord | null)?.stroke_number) || null;
    }
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
          urgent_posting_date: po.priority === "URGENT" ? today : null,
        },
        reservations: reservationUpdates,
        reco_rows: recoRows,
        machine_stock_log_rows: machineStockLogRows,
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
    // §138 lock (2026-09-21, business owner): MTS never gets a COR6-style post-Verify
    // correction/item-add — the frontend already never exposes this UI for po_type
    // MTS (MtsVerifyWorkspace takes over rendering unconditionally and shows only a
    // static blocked message once status leaves FINAL), but this handler itself had no
    // matching guard, so a direct API call could still slip an MTS Process PO through.
    // Mirrors correctPackingOrderHandler's own isMtsControlledPackingOrder() block on
    // the Packing PO side.
    if (String(po.po_type ?? "") === "MTS") {
      return poErr(req, ctx, "PROD_PO_MTS_CORRECTION_NOT_ALLOWED", 422, "MTS Process POs do not support post-Verify correction or item addition.");
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

// P322/P344 are the only two movement types an MTS Verify hold ever posts
// (Unrestricted->QA / Unrestricted->Blocked); their registered reverses in
// movement_type_master are P321/P343 (confirmed live 2026-09-21).
const MTS_HOLD_REVERSAL_MOVEMENT: Record<string, string> = { P322: "P321", P344: "P343" };

// §138 CORS (2026-09-21, business owner design lock): full reversal of a
// VERIFIED MTS Process PO. Unlike non-MTS CORS (reverseProcessOrderHandler
// below), this cascades every connected PMTS Packing PO's PM+FG postings in
// ONE atomic action -- there is no per-Packing-PO reversal step to do first
// (PMTS children are already blocked from any standalone write, see
// isMtsControlledPackingOrder() in packing_order.handlers.ts).
//
// Movement order matters: any qty an MTS Verify QA hold moved into
// QUALITY_INSPECTION/BLOCKED is reversed BEFORE the FG/SKU receipt itself,
// so the FG reversal can always draw its full declared qty from a single
// UNRESTRICTED balance rather than needing to split across stock types.
//
// Batch range release (ALL members, including USED) and every REVERSED
// status write happen inside complete_process_po_verify's own mts_reverse
// branch, in the SAME transaction post_document() opens for the movements
// below (§8D) -- never as a separate follow-up call.
async function reverseMtsProcessOrderHandler(
  req: Request,
  ctx: ProdHandlerContext,
  po: JsonRecord,
  id: string,
  reason: string,
): Promise<Response> {
  const processLines = await fetchOrderLines(id, toTrimmedString(po.stroke_master_id) || null);

  const { data: packingOrdersData, error: packingOrdersErr } = await serviceRoleClient
    .schema("erp_production").from("packing_order")
    .select("id").eq("process_order_id", id);
  if (packingOrdersErr) {
    console.error("[process_order.reverseMtsProcessOrder] packing-order lookup failed:", JSON.stringify(packingOrdersErr));
    throw new Error("PROD_MTS_REVERSE_PACKING_LOOKUP_FAILED");
  }
  const packingOrderIds = ((packingOrdersData ?? []) as JsonRecord[]).map((row) => String(row.id));

  let packingLines: JsonRecord[] = [];
  if (packingOrderIds.length > 0) {
    const { data: lineRows, error: lineErr } = await serviceRoleClient
      .schema("erp_production").from("packing_order_line")
      .select("id, packing_order_id, line_type, material_id, actual_material_id, actual_qty, issue_sloc_id, stock_ledger_id")
      .in("packing_order_id", packingOrderIds)
      .in("line_type", ["PM", "FG"]);
    if (lineErr) {
      console.error("[process_order.reverseMtsProcessOrder] packing-line lookup failed:", JSON.stringify(lineErr));
      throw new Error("PROD_MTS_REVERSE_PACKING_LINE_LOOKUP_FAILED");
    }
    packingLines = (lineRows ?? []) as JsonRecord[];
  }

  const { data: holdPostingsData, error: holdErr } = await serviceRoleClient
    .schema("erp_inventory").from("stock_status_change_posting")
    .select("id, material_id, storage_location_id, from_stock_type, to_stock_type, movement_type_code, quantity, uom_code")
    .eq("reference_document_type", "PROC_PO")
    .eq("reference_document_id", id)
    .eq("status", "POSTED");
  if (holdErr) {
    console.error("[process_order.reverseMtsProcessOrder] hold-posting lookup failed:", JSON.stringify(holdErr));
    throw new Error("PROD_MTS_REVERSE_HOLD_LOOKUP_FAILED");
  }
  const holdPostings = (holdPostingsData ?? []) as JsonRecord[];

  const materialMap = await getMaterialMapByIds(
    [
      ...processLines.map((line) => toTrimmedString(line.actual_material_id) || String(line.material_id ?? "")),
      ...packingLines.map((line) => toTrimmedString(line.actual_material_id) || String(line.material_id ?? "")),
      ...holdPostings.map((hold) => String(hold.material_id ?? "")),
    ],
    "[process_order.reverseMtsProcessOrder]", "PROD_MTS_REVERSE_FAILED", "id, base_uom_code",
  );
  const ledgerRefById = await resolveStockLedgerRefsByLedgerIds([
    ...processLines.map((line) => toTrimmedString(line.stock_ledger_id)),
    ...packingLines.map((line) => toTrimmedString(line.stock_ledger_id)),
  ]);
  const holdRateMap = await fetchUnrestrictedRates(
    String(po.company_id),
    holdPostings.map((hold) => ({ materialId: String(hold.material_id), slocId: String(hold.storage_location_id) })),
  );

  const today = todayIso();
  const docNumber = String(po.po_number);
  const revMatDoc = await generateMaterialDocNumber(String(po.company_id));
  const movements: MovementSpec[] = [];

  for (const line of processLines) {
    const qty = Number(line.actual_qty ?? 0);
    if (qty <= 0) continue;
    const slocId = getIssueStorageLocationId(line);
    if (!slocId) continue;
    const materialId = toTrimmedString(line.actual_material_id) || String(line.material_id);
    const ledgerRef = ledgerRefById.get(toTrimmedString(line.stock_ledger_id)) ?? null;
    if (!ledgerRef) throw new Error("PROD_MTS_REVERSE_SOURCE_NOT_FOUND");
    const baseUom = String(materialMap.get(materialId)?.base_uom_code ?? "KG");
    movements.push(toMovement({
      documentNumber: docNumber, documentDate: today, postingDate: today,
      movementTypeCode: "P262", companyId: po.company_id, storageLocationId: slocId,
      materialId, quantity: qty, baseUomCode: baseUom, unitValue: ledgerRef.rate,
      stockTypeCode: "UNRESTRICTED", direction: "IN", postedBy: ctx.auth_user_id,
      reversalOfId: ledgerRef.docId, batchNumber: null, matDoc: revMatDoc, referenceDocumentId: id,
    }, `MTS_REV_RM:${String(line.id)}`));
  }

  for (const line of packingLines) {
    if (String(line.line_type) !== "PM") continue;
    const qty = Number(line.actual_qty ?? 0);
    if (qty <= 0) continue;
    const slocId = toTrimmedString(line.issue_sloc_id);
    if (!slocId) continue;
    const materialId = toTrimmedString(line.actual_material_id) || String(line.material_id);
    const ledgerRef = ledgerRefById.get(toTrimmedString(line.stock_ledger_id)) ?? null;
    if (!ledgerRef) throw new Error("PROD_MTS_REVERSE_SOURCE_NOT_FOUND");
    const baseUom = String(materialMap.get(materialId)?.base_uom_code ?? "KG");
    movements.push(toMovement({
      documentNumber: docNumber, documentDate: today, postingDate: today,
      movementTypeCode: "P262", companyId: po.company_id, storageLocationId: slocId,
      materialId, quantity: qty, baseUomCode: baseUom, unitValue: ledgerRef.rate,
      stockTypeCode: "UNRESTRICTED", direction: "IN", postedBy: ctx.auth_user_id,
      reversalOfId: ledgerRef.docId, batchNumber: null, matDoc: revMatDoc, referenceDocumentId: id,
    }, `MTS_REV_PM:${String(line.id)}`));
  }

  const holdReversals: JsonRecord[] = [];
  holdPostings.forEach((hold, index) => {
    const originalMovementType = toTrimmedString(hold.movement_type_code);
    const reversalMovementType = MTS_HOLD_REVERSAL_MOVEMENT[originalMovementType];
    if (!reversalMovementType) throw new Error("PROD_MTS_REVERSE_HOLD_MOVEMENT_TYPE_UNKNOWN");
    const materialId = String(hold.material_id);
    const slocId = String(hold.storage_location_id);
    const qty = Number(hold.quantity ?? 0);
    const baseUom = String(materialMap.get(materialId)?.base_uom_code ?? toTrimmedString(hold.uom_code) ?? "KG");
    const rate = holdRateMap.get(`${materialId}|${slocId}`) ?? 0;
    const outRef = `MTS_REV_HOLD_OUT:${index}`;
    const inRef = `MTS_REV_HOLD_IN:${index}`;
    movements.push(toMovement({
      documentNumber: docNumber, documentDate: today, postingDate: today,
      movementTypeCode: reversalMovementType, companyId: po.company_id, storageLocationId: slocId,
      materialId, quantity: qty, baseUomCode: baseUom, unitValue: rate,
      stockTypeCode: String(hold.to_stock_type), direction: "OUT", postedBy: ctx.auth_user_id,
      batchNumber: null, matDoc: revMatDoc, referenceDocumentId: id,
    }, outRef));
    movements.push(toMovement({
      documentNumber: docNumber, documentDate: today, postingDate: today,
      movementTypeCode: reversalMovementType, companyId: po.company_id, storageLocationId: slocId,
      materialId, quantity: qty, baseUomCode: baseUom, unitValue: rate,
      stockTypeCode: String(hold.from_stock_type), direction: "IN", postedBy: ctx.auth_user_id,
      batchNumber: null, matDoc: revMatDoc, referenceDocumentId: id,
    }, inRef));
    holdReversals.push({
      original_posting_id: String(hold.id), out_ref: outRef, in_ref: inRef,
      reversal_movement_type_code: reversalMovementType,
    });
  });

  // FG/SKU reversal runs AFTER the hold reversals above, so any qty this
  // Process PO's own hold moved to QI/Blocked is already back in
  // UNRESTRICTED by the time this draws the line's full declared qty.
  for (const line of packingLines) {
    if (String(line.line_type) !== "FG") continue;
    const qty = Number(line.actual_qty ?? 0);
    if (qty <= 0) continue;
    const slocId = toTrimmedString(line.issue_sloc_id);
    if (!slocId) continue;
    const materialId = toTrimmedString(line.actual_material_id) || String(line.material_id);
    const ledgerRef = ledgerRefById.get(toTrimmedString(line.stock_ledger_id)) ?? null;
    if (!ledgerRef) throw new Error("PROD_MTS_REVERSE_SOURCE_NOT_FOUND");
    const baseUom = String(materialMap.get(materialId)?.base_uom_code ?? "KG");
    movements.push(toMovement({
      documentNumber: docNumber, documentDate: today, postingDate: today,
      movementTypeCode: "P102", companyId: po.company_id, storageLocationId: slocId,
      materialId, quantity: qty, baseUomCode: baseUom, unitValue: ledgerRef.rate,
      stockTypeCode: "UNRESTRICTED", direction: "OUT", postedBy: ctx.auth_user_id,
      reversalOfId: ledgerRef.docId, batchNumber: null, matDoc: revMatDoc, referenceDocumentId: id,
    }, `MTS_REV_FG:${String(line.id)}`));
  }

  if (movements.length === 0) {
    return poErr(req, ctx, "PROD_MTS_REVERSE_NOTHING_TO_REVERSE", 422, "No postings were found to reverse for this MTS Process PO.");
  }

  await cancelReservationsForProcessOrder(id, ctx.auth_user_id, new Date().toISOString());

  const postings = await postDocument({
    referenceDocumentType: "PROC_PO",
    referenceDocumentId: id,
    movements,
    postedBy: ctx.auth_user_id,
    context: {
      mts_reverse: { reason, actor_id: ctx.auth_user_id, hold_reversals: holdReversals },
    },
  });

  return okResponse({ id, status: "REVERSED", ledger_entries: postings }, ctx.request_id, req);
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

    // §138 CORS lock (2026-09-21, business owner): MTS is not a variation of
    // the generic per-document reversal flow below -- giving CORS on the
    // parent Process PO must itself cascade-reverse every connected PMTS
    // Packing PO in one atomic action, never require each child reversed
    // separately first (the "Reverse all Packing Orders first" gate right
    // below does not apply to MTS at all). Only a VERIFIED MTS batch has
    // anything posted to reverse; STANDARD/FINAL-stage cancellation is QA
    // Reject's job (qaRejectProcessOrderHandler), not CORS.
    if (po.po_type === "MTS") {
      if (po.status !== "VERIFIED") {
        return poErr(req, ctx, "PROD_MTS_REVERSE_STATUS_INVALID", 422, "Only a VERIFIED MTS Process PO can be reversed here. Use QA Reject for an unverified MTS batch.");
      }
      return await reverseMtsProcessOrderHandler(req, ctx, po, id, reason);
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

    // po_type is never MTS here -- MTS dispatches to reverseMtsProcessOrder
    // Handler (its own batch-range release) before this function's body runs.
    const batchType = toUpperTrimmedString(po.po_type);
    const batchNumber = toTrimmedString(po.batch_number);
    if (batchNumber) {
      await upsertBatchNumberInstanceForProcessOrder({
        companyId: String(po.company_id),
        poType: batchType,
        prodshadeMaterialId: null,
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
