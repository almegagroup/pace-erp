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
import { generateMaterialDocNumber, generateRecoDocNumber } from "../../_shared/materialDocument.ts";
import type { MaterialDocumentRef } from "../../_shared/materialDocument.ts";
import { resolveUserDisplayNames } from "../../_shared/resolveUserDisplayNames.ts";
import { okResponse, errorResponse } from "../response.ts";
import type { ProdHandlerContext } from "./production.shared.ts";
import {
  assertManagerOrSARole,
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
  return new Date().toISOString().slice(0, 10);
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
    .select("id, company_id, machine_code, machine_name, active")
    .eq("id", machineId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) {
    console.error("[process_order.fetchMachine] query failed:", JSON.stringify(error));
    throw new Error("PROD_PO_MACHINE_INVALID");
  }
  return (data as JsonRecord | null) ?? null;
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

async function resetReservationsForProcessOrder(id: string, userId: string, now: string): Promise<void> {
  const { error } = await serviceRoleClient
    .schema("erp_production")
    .from("reservation_document")
    .update({
      issued_qty: 0,
      status: "OPEN",
      last_updated_by: userId,
      last_updated_at: now,
    })
    .eq("source_type", "PROCESS_PO")
    .eq("source_id", id)
    .in("status", RESERVATION_ACTIVE_STATUSES);
  if (error) {
    console.error("[process_order.resetReservationsForProcessOrder] update failed:", JSON.stringify(error));
    throw new Error("PROD_PO_RESERVATION_UPDATE_FAILED");
  }
}

async function resolveOutputStorageLocationId(strokeMasterId: string | null): Promise<string | null> {
  if (!strokeMasterId) return null;
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
    throw new Error(`PROD_STOCK_POST_FAILED: ${params.movementTypeCode} ${params.direction}`);
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

async function computePhysicalAvailabilityRows(
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
    .select("material_id, storage_location_id, balance_qty")
    .eq("company_id", companyId)
    .in("material_id", materialIds)
    .in("storage_location_id", locationIds)
    .in("status", RESERVATION_OPEN_STATUSES);
  if (reservationErr) {
    console.error("[process_order.computePhysicalAvailabilityRows] reservation query failed:", JSON.stringify(reservationErr));
    throw new Error("PROD_PO_STOCK_CHECK_FAILED");
  }

  for (const row of (reservationRows ?? []) as JsonRecord[]) {
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

function formatShortageDetail(shortages: AvailabilityRow[]): string {
  return shortages
    .map((row) => `${row.material_id.slice(0, 8)} @ ${row.storage_location_id.slice(0, 8)} (need ${row.needed_qty.toFixed(3)}, have ${row.available_qty.toFixed(3)})`)
    .join("; ");
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
    const outputStorageLocationId = toTrimmedString(body.output_storage_location_id) || null;
    const notes = toTrimmedString(body.notes);
    const lineOverrideMap = buildLineOverrideMap(body.line_location_overrides);

    if (!companyId || !VALID_PO_TYPES.has(poType) || !VALID_SEGMENTS.has(segmentCode) || !materialId || !plannedQty) {
      return poErr(req, ctx, "PROD_PO_INVALID", 400, "company_id, po_type, segment_code, material_id, planned_qty required");
    }

    const machineValidation = await validateRequiredMachine(req, ctx, companyId, poType, machineId);
    if (machineValidation) return machineValidation;

    if (poType !== "MTEST" && !strokeId) {
      return poErr(req, ctx, "PROD_PO_STROKE_REQUIRED", 400, "stroke_master_id required for non-MTEST orders");
    }

    if (strokeId) {
      const { data: stroke, error: strokeErr } = await serviceRoleClient
        .schema("erp_production")
        .from("stroke_master")
        .select("status")
        .eq("id", strokeId)
        .maybeSingle();
      if (strokeErr) {
        console.error("[process_order.createProcessOrder] stroke query failed:", JSON.stringify(strokeErr));
        throw new Error("PROD_PO_CREATE_FAILED");
      }
      if (!stroke || (stroke as JsonRecord).status !== "APPROVED") {
        return poErr(req, ctx, "PROD_PO_STROKE_NOT_APPROVED", 422, "Stroke master must be APPROVED");
      }
    }

    if (strokeId && poType !== "MTEST") {
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
          const detail = short
            .map((row) => `${row.material_id.slice(0, 8)} @ ${row.storage_location_id.slice(0, 8)} (need ${row.needed_qty.toFixed(3)}, have ${row.available_qty.toFixed(3)})`)
            .join("; ");
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

    if (strokeId && poType !== "MTEST") {
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
            planned_qty: Number(((Number(strokeLine.dosage_pct ?? 0) / 100) * plannedQty).toFixed(4)),
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
    if (poType === "MTEST") {
      if (!outputStorageLocationId) {
        return poErr(req, ctx, "PROD_PO_SLOC_MISSING", 400, "Storage location required for MTEST - segment config is not used for this type");
      }
      const missingLineLocation = manualLines.some((line) => !toTrimmedString(line.storage_location_id));
      if (missingLineLocation) {
        return poErr(req, ctx, "PROD_PO_SLOC_MISSING", 400, "Storage location required for MTEST - segment config is not used for this type");
      }
    }
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

    if (poType === "MTEST") {
      // MTEST is not batch-managed (locked 2026-07-14) — no batch series entry,
      // no batch_number_instance row; its Packing PO (PTEST) draws SFG
      // generically, so nothing downstream ever needs this batch identity.
      const lines = await fetchOrderLines(poId, null);
      const postedBy = ctx.auth_user_id;
      const today = todayIso();
      const ledgerEntries: JsonRecord[] = [];

      // §106: MTEST is a single-action event — one Material Document covers its RM issues
      // and its FG receipt; the Process PO number is the reference.
      const mtestMatDoc = await generateMaterialDocNumber(companyId);

      for (const line of lines) {
        const issueQty = Number(line.planned_qty ?? 0);
        if (issueQty <= 0) continue;
        const slocId = getIssueStorageLocationId(line);
        if (!slocId) {
          return poErr(req, ctx, "PROD_PO_SLOC_MISSING", 400, "Storage location required for MTEST - segment config is not used for this type");
        }
        const baseUom = String((line.material as JsonRecord | null)?.base_uom_code ?? line.uom_code ?? "KG");
        const posting = await postStockMovement({
          documentNumber: poNumber,
          documentDate: today,
          postingDate: today,
          movementTypeCode: "P261",
          companyId,
          storageLocationId: slocId,
          materialId: line.material_id,
          quantity: issueQty,
          baseUomCode: baseUom,
          unitValue: 0,
          stockTypeCode: "UNRESTRICTED",
          direction: "OUT",
          postedBy,
          matDoc: mtestMatDoc,
          referenceDocumentId: poId,
        });

        const { error: lineUpdateErr } = await serviceRoleClient
          .schema("erp_production")
          .from("process_order_line")
          .update({
            actual_qty: issueQty,
            stock_ledger_id: posting.stock_ledger_id,
          })
          .eq("id", line.id as string);
        if (lineUpdateErr) {
          console.error("[process_order.createProcessOrder] mtest line update failed:", JSON.stringify(lineUpdateErr));
          throw new Error("PROD_PO_CREATE_FAILED");
        }
        ledgerEntries.push({ line_id: line.id, movement: "P261", direction: "OUT", ...posting });
      }

      const fgUom = await fetchProductionMaterialBaseUom(materialId);
      const fgPosting = await postStockMovement({
        documentNumber: poNumber,
        documentDate: today,
        postingDate: today,
        movementTypeCode: "P101",
        companyId,
        storageLocationId: outputStorageLocationId,
        materialId,
        quantity: plannedQty,
        baseUomCode: fgUom,
        unitValue: 0,
        stockTypeCode: "UNRESTRICTED",
        direction: "IN",
        postedBy,
        matDoc: mtestMatDoc,
        referenceDocumentId: poId,
      });

      const verifiedAt = new Date().toISOString();
      const { error: poUpdateErr } = await serviceRoleClient
        .schema("erp_production")
        .from("process_order")
        .update({
          status: "VERIFIED",
          actual_qty: plannedQty,
          fg_stock_ledger_id: fgPosting.stock_ledger_id,
          verified_at: verifiedAt,
          verified_by: ctx.auth_user_id,
          last_updated_at: verifiedAt,
          last_updated_by: ctx.auth_user_id,
        })
        .eq("id", poId);
      if (poUpdateErr) {
        console.error("[process_order.createProcessOrder] mtest po update failed:", JSON.stringify(poUpdateErr));
        throw new Error("PROD_PO_CREATE_FAILED");
      }

      return createdOkResponse({
        id: poId,
        po_number: poNumber,
        status: "VERIFIED",
        batch_number: null,
        ledger_entries: [...ledgerEntries, { movement: "P101", direction: "IN", ...fgPosting }],
      }, ctx.request_id, req);
    }

    if (insertedLines.length > 0) {
      const reservationRows = insertedLines.map((line) => ({
        source_type: "PROCESS_PO",
        source_id: poId,
        source_line_id: line.id,
        company_id: companyId,
        material_id: toTrimmedString(line.actual_material_id) || line.material_id,
        storage_location_id: line.issue_sloc_id ?? null,
        required_qty: line.planned_qty,
        uom_code: toTrimmedString(line.uom_code) || "KG",
        required_by_date: plannedStartDate,
        status: "OPEN",
        created_by: ctx.auth_user_id,
        created_at: now,
        last_updated_by: ctx.auth_user_id,
        last_updated_at: now,
      }));
      const { error: reservationErr } = await serviceRoleClient
        .schema("erp_production")
        .from("reservation_document")
        .insert(reservationRows);
      if (reservationErr) {
        console.error("[process_order.createProcessOrder] reservation insert failed:", JSON.stringify(reservationErr));
        throw new Error("PROD_PO_CREATE_FAILED");
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
    assertManagerOrSARole(ctx);
    const id = getIdFromPath(req);
    if (!id) return poErr(req, ctx, "PROD_PO_ID_MISSING", 400, "ID required");

    const po = await fetchProcessOrder(id);
    if (!po) return poErr(req, ctx, "PROD_PO_NOT_FOUND", 404, "Not found");
    if (po.status !== "STANDARD") {
      return poErr(req, ctx, "PROD_PO_STATUS_INVALID", 422, `Expected STANDARD, got ${po.status}`);
    }

    const lines = await fetchOrderLines(id, toTrimmedString(po.stroke_master_id) || null);
    if (lines.length === 0 && po.po_type !== "MTEST") {
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
    assertManagerOrSARole(ctx);
    const id = getIdFromPath(req);
    if (!id) return poErr(req, ctx, "PROD_PO_ID_MISSING", 400, "ID required");

    const po = await fetchProcessOrder(id);
    if (!po) return poErr(req, ctx, "PROD_PO_NOT_FOUND", 404, "Not found");
    if (po.status !== "STANDARD") {
      return poErr(req, ctx, "PROD_PO_STATUS_INVALID", 422, `Expected STANDARD, got ${po.status}`);
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

    const requiredStatus = po.po_type === "MTS" ? "STANDARD" : "QA_APPROVED";
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
        ? Number((((Number(line.dosage_pct ?? 0) / 100) * targetPlannedQty)).toFixed(4))
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
      const detail = short
        .map((row) => `${row.material_id.slice(0, 8)} @ ${row.storage_location_id.slice(0, 8)} (need ${row.needed_qty.toFixed(3)}, have ${row.available_qty.toFixed(3)})`)
        .join("; ");
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

export async function completeIntProcessOrderHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const id = getIdFromPath(req);
    if (!id) return poErr(req, ctx, "PROD_PO_ID_MISSING", 400, "ID required");

    const po = await fetchProcessOrder(id);
    if (!po) return poErr(req, ctx, "PROD_PO_NOT_FOUND", 404, "Not found");
    if (po.po_type !== "INT") {
      return poErr(req, ctx, "PROD_PO_NOT_INT", 422, "Only INT orders can use complete-int");
    }
    if (po.status !== "STANDARD") {
      return poErr(req, ctx, "PROD_PO_INT_COMPLETE_STATUS_INVALID", 422, "INT complete allowed only at STANDARD");
    }

    const body = await parseBody(req);
    const actualOutputQty = parsePositiveNumber(body.actual_output_qty);
    if (!actualOutputQty) {
      return poErr(req, ctx, "PROD_PO_ACTUAL_QTY_REQUIRED", 400, "actual_output_qty required");
    }

    const lines = await fetchOrderLines(id, toTrimmedString(po.stroke_master_id) || null);
    const lineOverrideMap = new Map(
      (Array.isArray(body.lines) ? body.lines : [])
        .map((line) => line as JsonRecord)
        .filter((line) => toTrimmedString(line.id))
        .map((line) => [toTrimmedString(line.id), parseNonNegativeNumber(line.actual_qty)]),
    );

    const shopfloorSlocId = await resolveOutputStorageLocationId(toTrimmedString(po.stroke_master_id) || null);
    if (!shopfloorSlocId) {
      return poErr(req, ctx, "PROD_PO_SHOPFLOOR_SLOC_MISSING", 422, "Output storage location not configured for this stroke/segment");
    }

    const today = todayIso();
    const docNumber = String(po.po_number);
    const postedBy = ctx.auth_user_id;
    const reservationMap = await fetchReservationRowsBySourceLineIds(lines.map((line) => String(line.id)));
    const ledgerEntries: JsonRecord[] = [];

    // §106: one Material Document for this INT completion event (RM issues + output receipt);
    // the Process PO number is the reference.
    const intMatDoc = await generateMaterialDocNumber(String(po.company_id));

    // §104.8 (INT valuation, LOCKED 2026-07-18): in-house INT costs what its RM cost —
    // Σ(RM issue qty × that RM's rate) ÷ output qty. Pre-fetch every RM line's current
    // UNRESTRICTED rate so the P261 issues post at real value and roll up into the INT output.
    // Purchased INT keeps its own GRN rate; the two sources blend in stock_snapshot's weighted
    // average, which is the correct combined cost an MTO batch should consume at.
    const intRateMap = await fetchUnrestrictedRates(
      String(po.company_id),
      lines.map((line) => ({
        materialId: toTrimmedString(line.actual_material_id) || String(line.material_id),
        slocId: String(getIssueStorageLocationId(line) ?? ""),
      })),
    );
    let totalIntRmValue = 0;

    for (const line of lines) {
      const actualQty = lineOverrideMap.has(String(line.id))
        ? Number(lineOverrideMap.get(String(line.id)) ?? 0)
        : Number(line.planned_qty ?? 0);
      const slocId = getIssueStorageLocationId(line);
      if (!slocId) {
        return poErr(req, ctx, "PROD_PO_SLOC_MISSING", 422, `Storage location missing for ${line.material_id}`);
      }
      const movementMaterialId = toTrimmedString(line.actual_material_id) || String(line.material_id);
      const baseUom = String(
        ((toTrimmedString(line.actual_material_id)
          ? line.actual_material
          : line.material) as JsonRecord | null)?.base_uom_code ?? line.uom_code ?? "KG",
      );

      const { error: lineActualErr } = await serviceRoleClient
        .schema("erp_production")
        .from("process_order_line")
        .update({ actual_qty: actualQty })
        .eq("id", line.id as string)
        .eq("process_order_id", id);
      if (lineActualErr) {
        console.error("[process_order.completeInt] line actual update failed:", JSON.stringify(lineActualErr));
        throw new Error("PROD_PO_VERIFY_FAILED");
      }

      // §104.8: issue at the RM's real cost and accumulate it — this sum IS the INT's value.
      const intRmRate = intRateMap.get(`${movementMaterialId}|${slocId}`) ?? 0;
      totalIntRmValue += actualQty * intRmRate;

      const posting = await postStockMovement({
        documentNumber: docNumber,
        documentDate: today,
        postingDate: today,
        movementTypeCode: "P261",
        companyId: po.company_id,
        storageLocationId: slocId,
        materialId: movementMaterialId,
        quantity: actualQty,
        baseUomCode: baseUom,
        unitValue: intRmRate,
        stockTypeCode: "UNRESTRICTED",
        direction: "OUT",
        postedBy,
        matDoc: intMatDoc,
        referenceDocumentId: String(po.id),
      });

      const { error: lineLedgerErr } = await serviceRoleClient
        .schema("erp_production")
        .from("process_order_line")
        .update({ stock_ledger_id: posting.stock_ledger_id })
        .eq("id", line.id as string);
      if (lineLedgerErr) {
        console.error("[process_order.completeInt] line ledger update failed:", JSON.stringify(lineLedgerErr));
        throw new Error("PROD_PO_VERIFY_FAILED");
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
          console.error("[process_order.completeInt] reservation update failed:", JSON.stringify(reservationErr));
          throw new Error("PROD_PO_VERIFY_FAILED");
        }
      }

      ledgerEntries.push({ line_id: line.id, movement: "P261", direction: "OUT", ...posting });
    }

    const fgUom = await fetchProductionMaterialBaseUom(String(po.material_id));

    // §104.8 (LOCKED 2026-07-18): INT conversion cost is OPTIONAL and data-driven — INT resolves the
    // SAME conversion_cost_config as SFG, but a missing rate means 0-and-proceed, NOT a hard block
    // (contrast verifyProcessOrderHandler's PROD_PO_CONVERSION_RATE_MISSING). Rationale: SFG
    // conversion is known to exist so a missing rate is a config error; INT conversion does not
    // exist today, so absent legitimately means zero. If a future INT ever needs one, the business
    // adds a dated row on the AC04 page (segment INT, optional per-material override) — no code
    // change, no migration, no deploy.
    const intConversionRate = (await resolveConversionRate(
      String(po.company_id), String(po.segment_code ?? ""), String(po.material_id), today,
    )) ?? 0;
    const intCostPerKg = actualOutputQty > 0
      ? (totalIntRmValue / actualOutputQty) + intConversionRate
      : intConversionRate;

    const fgPosting = await postStockMovement({
      documentNumber: docNumber,
      documentDate: today,
      postingDate: today,
      movementTypeCode: "P101",
      companyId: po.company_id,
      storageLocationId: shopfloorSlocId,
      materialId: po.material_id,
      quantity: actualOutputQty,
      baseUomCode: fgUom,
      unitValue: intCostPerKg,
      stockTypeCode: "UNRESTRICTED",
      direction: "IN",
      postedBy,
      matDoc: intMatDoc,
      referenceDocumentId: String(po.id),
    });

    const now = new Date().toISOString();
    const { error: poUpdateErr } = await serviceRoleClient
      .schema("erp_production")
      .from("process_order")
      .update({
        status: "VERIFIED",
        actual_qty: actualOutputQty,
        fg_stock_ledger_id: fgPosting.stock_ledger_id,
        verified_at: now,
        verified_by: ctx.auth_user_id,
        last_updated_at: now,
        last_updated_by: ctx.auth_user_id,
      })
      .eq("id", id);
    if (poUpdateErr) {
      console.error("[process_order.completeInt] process-order update failed:", JSON.stringify(poUpdateErr));
      throw new Error("PROD_PO_VERIFY_FAILED");
    }

    return okResponse({
      id,
      status: "VERIFIED",
      verified_qty: actualOutputQty,
      ledger_entries: [...ledgerEntries, { movement: "P101", direction: "IN", ...fgPosting }],
    }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PO_VERIFY_FAILED";
    return poErr(req, ctx, code, 500, "INT completion failed");
  }
}

export async function finalizeProcessOrderHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const id = getIdFromPath(req);
    if (!id) return poErr(req, ctx, "PROD_PO_ID_MISSING", 400, "ID required");

    const po = await fetchProcessOrder(id);
    if (!po) return poErr(req, ctx, "PROD_PO_NOT_FOUND", 404, "Not found");
    if (po.status !== "BATCH_STARTED") {
      return poErr(req, ctx, "PROD_PO_STATUS_INVALID", 422, "Must be BATCH_STARTED to finalize");
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
    const physicalRows = await computePhysicalAvailabilityRows(String(po.company_id), stockNeeds);
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
          `Insufficient UNRESTRICTED stock for ${nonIntShortages.length} material(s): ${formatShortageDetail(nonIntShortages)}`,
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
          unmet.push(materialId.slice(0, 8));
        }
      }

      if (unmet.length > 0) {
        return poErr(req, ctx, "PROD_PO_INT_NOT_VERIFIED", 422, `INT material(s) short in stock and output not yet declared: ${unmet.join(", ")}. Finalize or verify the INT Process Orders first.`);
      }
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

    return okResponse({ id, status: "FINAL" }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PO_FINALIZE_FAILED";
    return poErr(req, ctx, code, 500, "Finalize failed");
  }
}

export async function verifyProcessOrderHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const id = getIdFromPath(req);
    if (!id) return poErr(req, ctx, "PROD_PO_ID_MISSING", 400, "ID required");

    const po = await fetchProcessOrder(id);
    if (!po) return poErr(req, ctx, "PROD_PO_NOT_FOUND", 404, "Not found");
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
    const stockNeeds = buildLineAvailabilityNeeds(lines);
    const shortRows = (await computePhysicalAvailabilityRows(String(po.company_id), stockNeeds)).filter((row) => row.short);
    if (shortRows.length > 0) {
      return poErr(
        req,
        ctx,
        "PROD_PO_INSUFFICIENT_STOCK",
        422,
        `Insufficient UNRESTRICTED stock for ${shortRows.length} material(s): ${formatShortageDetail(shortRows)}`,
      );
    }

    const shopfloorSlocId = await resolveOutputStorageLocationId(toTrimmedString(po.stroke_master_id) || null);
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
    const conversionRate = await resolveConversionRate(
      String(po.company_id), String(po.segment_code ?? ""), String(po.material_id), today,
    );
    if (conversionRate === null) {
      return poErr(req, ctx, "PROD_PO_CONVERSION_RATE_MISSING", 422,
        "Conversion cost rate is not configured for this segment/prodshade as of the posting date. Set it in the Conversion Cost config before verifying (Section 104.8).");
    }
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
          has_unapproved_deviation: applyResult.hasUnapprovedDeviation ?? false,
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
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PO_VERIFY_FAILED";
    return poErr(req, ctx, code, 500, `Verify failed: ${err instanceof Error ? err.message : ""}`);
  }
}

export async function reverseProcessOrderHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const id = getIdFromPath(req);
    if (!id) return poErr(req, ctx, "PROD_PO_ID_MISSING", 400, "ID required");

    const po = await fetchProcessOrder(id);
    if (!po) return poErr(req, ctx, "PROD_PO_NOT_FOUND", 404, "Not found");
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
        if (!lineRef) throw new Error("PROD_PO_REVERSAL_SOURCE_NOT_FOUND");

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

      const shopfloorSlocId = await resolveOutputStorageLocationId(toTrimmedString(po.stroke_master_id) || null);
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

      await resetReservationsForProcessOrder(id, ctx.auth_user_id, now);

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
      await resetReservationsForProcessOrder(id, ctx.auth_user_id, now);
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
