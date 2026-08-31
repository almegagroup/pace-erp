/*
 * File-Path: supabase/functions/api/_core/procurement/location_transfer.handlers.ts
 * Domain: PROCUREMENT / INVENTORY
 * Purpose: IN10 / IN11 location transfer request + posting workbench handlers.
 * Authority: Backend
 */

import type { ContextResolution } from "../../_pipeline/context.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { todayIsoInKolkata } from "../../_shared/dateUtils.ts";
import { assertCompanyScope, isCompanyScopeAdminBypass } from "../../_shared/companyScope.ts";
import { canMaintainCompanyResource } from "../../_shared/companyResourceAccess.ts";
import { generateMaterialDocNumber } from "../../_shared/materialDocument.ts";
import { fetchAllRows } from "../../_shared/fetchAllRows.ts";
import { errorResponse, okResponse } from "../response.ts";

type JsonRecord = Record<string, unknown>;
type ProcurementHandlerContext = {
  context: Extract<ContextResolution, { status: "RESOLVED" }>;
  request_id: string;
  auth_user_id: string;
  roleCode: string;
};
type LtrRow = Record<string, unknown>;
type LtrLineRow = Record<string, unknown>;
type LtrPostingRow = Record<string, unknown>;
type TransferLineInput = {
  id?: string | null;
  source_storage_location_id: string;
  target_storage_location_id: string;
  material_id: string;
  requested_qty: number;
  uom_code?: string | null;
  stock_type_code: string;
  batch_number?: string | null;
  source_lot_ref?: string | null;
  remarks?: string | null;
};
type PostingInput = {
  request_line_id: string;
  quantity: number;
  remarks?: string | null;
};
type AvailabilityPreviewRow = {
  client_row_id: string;
  source_storage_location_id: string;
  target_storage_location_id: string;
  material_id: string;
  stock_type_code: string;
  requested_qty: number;
  uom_code: string | null;
  batch_number: string | null;
  source_lot_ref: string | null;
  live_qty: number;
  reserved_other_qty: number;
  available_qty: number;
  valuation_rate: number;
  is_valid: boolean;
  invalid_reason: string | null;
};

const REQUEST_RESOURCE = "PROC_LOC_TRANSFER_REQ";
const POST_RESOURCE = "PROC_LOC_TRANSFER_POST";
const REVERSE_RESOURCE = "PROC_LOC_TRANSFER_REVERSE";
const REQUEST_STATUSES = new Set(["OPEN", "PARTIALLY_POSTED", "POSTED", "CANCELLED"]);
const LINE_STATUSES = new Set(["OPEN", "PARTIALLY_POSTED", "POSTED", "CANCELLED"]);
const STOCK_TYPES = new Set(["UNRESTRICTED", "QUALITY_INSPECTION", "BLOCKED"]);
const RESERVATION_ACTIVE_STATUSES = ["OPEN", "PARTIAL", "FULLY_ISSUED"];
const EPSILON = 0.000001;

function parseBody(req: Request): Promise<JsonRecord> {
  return req.json().catch(() => ({} as JsonRecord));
}

function toTrimmedString(value: unknown): string {
  return String(value ?? "").trim();
}

function toUpperTrimmedString(value: unknown): string {
  return toTrimmedString(value).toUpperCase();
}

function parseNullableNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parsePositiveNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function nowIsoString(): string {
  return new Date().toISOString();
}

function todayIsoDate(): string {
  return todayIsoInKolkata();
}

function getPathSegments(req: Request): string[] {
  return new URL(req.url).pathname.split("/").filter(Boolean);
}

function getRequestIdFromPath(req: Request): string {
  return getPathSegments(req)[3] ?? "";
}

function getPostingIdFromPath(req: Request): string {
  // /api/procurement/location-transfer-postings/:postingId/reverse
  //  0    1           2                            3          4
  return getPathSegments(req)[3] ?? "";
}

function ltrErrorResponse(
  req: Request,
  ctx: ProcurementHandlerContext,
  code: string,
  status: number,
  message: string,
  extra?: JsonRecord,
): Response {
  return errorResponse(code, message, ctx.request_id, "NONE", status, extra ?? {}, req);
}

async function assertScopedCompanyAccess(
  ctx: ProcurementHandlerContext,
  companyId: string,
  resourceCode: string,
  action: "VIEW" | "WRITE" | "EDIT" | "APPROVE",
): Promise<void> {
  try {
    await assertCompanyScope(ctx, companyId);
  } catch {
    throw new Error("LTR_SCOPE_VIOLATION");
  }
  if (isCompanyScopeAdminBypass(ctx)) return;
  const allowed = await canMaintainCompanyResource(ctx, companyId, resourceCode, action);
  if (!allowed) throw new Error("LTR_SCOPE_VIOLATION");
}

async function generateProcurementDocNumber(docType: string): Promise<string> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .rpc("generate_doc_number", { p_doc_type: docType });
  if (error || !data) throw new Error("PROCUREMENT_DOC_NUMBER_FAILED");
  return String(data);
}

async function fetchRequestRow(requestId: string): Promise<LtrRow> {
  const { data, error } = await serviceRoleClient
    .schema("erp_inventory")
    .from("location_transfer_request")
    .select("*")
    .eq("id", requestId)
    .single();
  if (error || !data) throw new Error("LTR_REQUEST_NOT_FOUND");
  return data as LtrRow;
}

async function fetchRequestRowByNumber(companyId: string, ltrNumber: string): Promise<LtrRow> {
  const { data, error } = await serviceRoleClient
    .schema("erp_inventory")
    .from("location_transfer_request")
    .select("*")
    .eq("company_id", companyId)
    .eq("ltr_number", ltrNumber)
    .single();
  if (error || !data) throw new Error("LTR_REQUEST_NOT_FOUND");
  return data as LtrRow;
}

async function fetchRequestLines(requestId: string): Promise<LtrLineRow[]> {
  const { data, error } = await serviceRoleClient
    .schema("erp_inventory")
    .from("location_transfer_request_line")
    .select("*")
    .eq("request_id", requestId)
    .order("line_no", { ascending: true });
  if (error) throw new Error("LTR_LINE_FETCH_FAILED");
  return (data ?? []) as LtrLineRow[];
}

async function fetchRequestPostings(requestId: string): Promise<LtrPostingRow[]> {
  const { data, error } = await serviceRoleClient
    .schema("erp_inventory")
    .from("location_transfer_posting")
    .select("*")
    .eq("request_id", requestId)
    .order("posted_at", { ascending: false });
  if (error) throw new Error("LTR_POSTING_FETCH_FAILED");
  return (data ?? []) as LtrPostingRow[];
}

async function getStorageLocationScope(
  storageLocationId: string,
  companyId?: string,
): Promise<{ company_id: string }> {
  let query = serviceRoleClient
    .schema("erp_inventory")
    .from("storage_location_plant_map")
    .select("company_id")
    .eq("storage_location_id", storageLocationId)
    .eq("active", true)
    .limit(1);
  const scopedCompanyId = toTrimmedString(companyId);
  if (scopedCompanyId) query = query.eq("company_id", scopedCompanyId);
  const { data, error } = await query.maybeSingle();
  if (error || !data?.company_id) throw new Error("LTR_STORAGE_LOCATION_SCOPE_NOT_FOUND");
  return { company_id: String(data.company_id) };
}

async function getMaterialInfo(materialIds: string[]): Promise<Map<string, JsonRecord>> {
  const uniqueMaterialIds = [...new Set(materialIds.map((entry) => toTrimmedString(entry)).filter(Boolean))];
  if (uniqueMaterialIds.length === 0) return new Map();
  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("material_master")
    .select("id, pace_code, material_name, material_type, base_uom_code")
    .in("id", uniqueMaterialIds);
  if (error) throw new Error("LTR_MATERIAL_LOOKUP_FAILED");
  return new Map(((data ?? []) as JsonRecord[]).map((row) => [toTrimmedString(row.id), row]));
}

async function listCompanyMappedMaterialIds(companyId: string, materialIds: string[]): Promise<Set<string>> {
  const uniqueMaterialIds = [...new Set(materialIds.map((entry) => toTrimmedString(entry)).filter(Boolean))];
  if (uniqueMaterialIds.length === 0) return new Set();
  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("material_company_ext")
    .select("material_id")
    .eq("company_id", companyId)
    .in("material_id", uniqueMaterialIds);
  if (error) throw new Error("LTR_COMPANY_MATERIAL_LOOKUP_FAILED");
  return new Set(((data ?? []) as JsonRecord[]).map((row) => toTrimmedString(row.material_id)).filter(Boolean));
}

async function getLiveStockBalance(params: {
  companyId: string;
  storageLocationId: string;
  materialId: string;
  stockTypeCode: string;
  batchNumber?: string | null;
  sourceLotRef?: string | null;
}): Promise<{ quantity: number; valuationRate: number }> {
  const batchNumber = toTrimmedString(params.batchNumber);
  const sourceLotRef = toTrimmedString(params.sourceLotRef);
  // Paged via fetchAllRows, not a plain .select() -- a busy material+location
  // can accumulate well over PostgREST's 1000-row default cap in its ledger
  // history, and this balance is batch-specific (or explicitly NULL-batch),
  // so it can't be swapped for stock_snapshot the way a non-batch check can
  // (stock_snapshot deliberately blends every batch into one running total).
  let data: JsonRecord[];
  try {
    data = await fetchAllRows<JsonRecord>((from, to) => {
      let query = serviceRoleClient
        .schema("erp_inventory")
        .from("stock_ledger")
        .select("direction, quantity, valuation_rate")
        .eq("company_id", params.companyId)
        .eq("storage_location_id", params.storageLocationId)
        .eq("material_id", params.materialId)
        .eq("stock_type_code", params.stockTypeCode)
        .order("ledger_seq", { ascending: true })
        .range(from, to);
      query = batchNumber ? query.eq("batch_number", batchNumber) : query.is("batch_number", null);
      if (sourceLotRef) {
        query = query.eq("source_lot_ref", sourceLotRef);
      }
      return query;
    });
  } catch {
    throw new Error("LTR_STOCK_LOOKUP_FAILED");
  }
  let quantity = 0;
  let lastRate = 0;
  for (const row of data) {
    const sign = toUpperTrimmedString(row.direction) === "OUT" ? -1 : 1;
    quantity += Number(parseNullableNumber(row.quantity) ?? 0) * sign;
    if (parseNullableNumber(row.valuation_rate) !== null) {
      lastRate = Number(parseNullableNumber(row.valuation_rate) ?? lastRate);
    }
  }
  return { quantity: Number(quantity.toFixed(6)), valuationRate: lastRate };
}

async function getReservedQtyOther(params: {
  companyId: string;
  storageLocationId: string;
  materialId: string;
  batchNumber?: string | null;
  sourceLotRef?: string | null;
  excludeRequestId?: string | null;
  excludeLineId?: string | null;
}): Promise<number> {
  let query = serviceRoleClient
    .schema("erp_production")
    .from("reservation_document")
    .select("balance_qty, source_id, source_line_id")
    .eq("source_type", "LOCATION_TRANSFER")
    .eq("company_id", params.companyId)
    .eq("storage_location_id", params.storageLocationId)
    .eq("material_id", params.materialId)
    .in("status", RESERVATION_ACTIVE_STATUSES);
  const batchNumber = toTrimmedString(params.batchNumber);
  const sourceLotRef = toTrimmedString(params.sourceLotRef);
  query = batchNumber ? query.eq("batch_number", batchNumber) : query.is("batch_number", null);
  query = sourceLotRef ? query.eq("source_lot_ref", sourceLotRef) : query.is("source_lot_ref", null);
  const { data, error } = await query;
  if (error) throw new Error("LTR_RESERVATION_LOOKUP_FAILED");
  let reserved = 0;
  for (const row of (data ?? []) as JsonRecord[]) {
    if (params.excludeRequestId && toTrimmedString(row.source_id) === params.excludeRequestId) {
      if (!params.excludeLineId || toTrimmedString(row.source_line_id) === params.excludeLineId) {
        continue;
      }
    }
    reserved += Number(parseNullableNumber(row.balance_qty) ?? 0);
  }
  return Number(reserved.toFixed(6));
}

async function getLineAvailability(params: {
  companyId: string;
  storageLocationId: string;
  materialId: string;
  stockTypeCode: string;
  batchNumber?: string | null;
  sourceLotRef?: string | null;
  excludeRequestId?: string | null;
  excludeLineId?: string | null;
}): Promise<{ liveQty: number; reservedOtherQty: number; availableQty: number; valuationRate: number }> {
  const [live, reservedOtherQty] = await Promise.all([
    getLiveStockBalance({
      companyId: params.companyId,
      storageLocationId: params.storageLocationId,
      materialId: params.materialId,
      stockTypeCode: params.stockTypeCode,
      batchNumber: params.batchNumber,
      sourceLotRef: params.sourceLotRef,
    }),
    getReservedQtyOther({
      companyId: params.companyId,
      storageLocationId: params.storageLocationId,
      materialId: params.materialId,
      batchNumber: params.batchNumber,
      sourceLotRef: params.sourceLotRef,
      excludeRequestId: params.excludeRequestId,
      excludeLineId: params.excludeLineId,
    }),
  ]);
  const availableQty = Number((live.quantity - reservedOtherQty).toFixed(6));
  return {
    liveQty: live.quantity,
    reservedOtherQty,
    availableQty,
    valuationRate: live.valuationRate,
  };
}

async function normalizeLinesForSave(companyId: string, rawLines: unknown, requestId?: string | null): Promise<TransferLineInput[]> {
  const lines = Array.isArray(rawLines) ? rawLines : [];
  if (lines.length === 0) throw new Error("LTR_LINE_REQUIRED");

  const normalized = lines.map((entry) => {
    const line = (entry ?? {}) as JsonRecord;
    return {
      id: toTrimmedString(line.id) || null,
      source_storage_location_id: toTrimmedString(line.source_storage_location_id),
      target_storage_location_id: toTrimmedString(line.target_storage_location_id),
      material_id: toTrimmedString(line.material_id),
      requested_qty: Number(parsePositiveNumber(line.requested_qty) ?? 0),
      uom_code: toTrimmedString(line.uom_code) || null,
      stock_type_code: toUpperTrimmedString(line.stock_type_code),
      batch_number: toTrimmedString(line.batch_number) || null,
      source_lot_ref: toTrimmedString(line.source_lot_ref) || null,
      remarks: toTrimmedString(line.remarks) || null,
    };
  });

  const materialInfo = await getMaterialInfo(normalized.map((line) => line.material_id));
  const mappedMaterialIds = await listCompanyMappedMaterialIds(companyId, normalized.map((line) => line.material_id));

  for (const [index, line] of normalized.entries()) {
    if (
      !line.source_storage_location_id
      || !line.target_storage_location_id
      || !line.material_id
      || !(line.requested_qty > 0)
      || !STOCK_TYPES.has(line.stock_type_code)
    ) {
      throw new Error(`LTR_LINE_INVALID_${index + 1}`);
    }
    if (line.source_storage_location_id === line.target_storage_location_id) {
      throw new Error("LTR_SOURCE_TARGET_SAME");
    }
    if (!mappedMaterialIds.has(line.material_id)) {
      throw new Error("LTR_COMPANY_MATERIAL_SCOPE_INVALID");
    }
    const material = materialInfo.get(line.material_id);
    if (!material) throw new Error("LTR_MATERIAL_NOT_FOUND");
    const materialType = toUpperTrimmedString(material.material_type);
    if (materialType === "SFG" && !line.batch_number) {
      throw new Error("LTR_BATCH_REQUIRED_FOR_SFG");
    }
    if (materialType === "FG" && (!line.batch_number || !line.source_lot_ref)) {
      throw new Error("LTR_LOT_REQUIRED_FOR_FG");
    }
    const [sourceScope, targetScope] = await Promise.all([
      getStorageLocationScope(line.source_storage_location_id, companyId),
      getStorageLocationScope(line.target_storage_location_id, companyId),
    ]);
    if (sourceScope.company_id !== companyId || targetScope.company_id !== companyId) {
      throw new Error("LTR_STORAGE_LOCATION_SCOPE_NOT_FOUND");
    }
    const availability = await getLineAvailability({
      companyId,
      storageLocationId: line.source_storage_location_id,
      materialId: line.material_id,
      stockTypeCode: line.stock_type_code,
      batchNumber: line.batch_number,
      sourceLotRef: line.source_lot_ref,
      excludeRequestId: requestId ?? null,
      excludeLineId: line.id ?? null,
    });
    if (line.requested_qty > availability.availableQty + EPSILON) {
      throw new Error("LTR_REQUEST_QTY_EXCEEDS_AVAILABLE");
    }
    if (!line.uom_code) {
      line.uom_code = toTrimmedString(material.base_uom_code) || "KG";
    }
  }

  return normalized;
}

async function buildAvailabilityPreview(
  companyId: string,
  rawLines: unknown,
  requestId?: string | null,
): Promise<AvailabilityPreviewRow[]> {
  const lines = Array.isArray(rawLines) ? rawLines : [];
  if (lines.length === 0) return [];

  const normalized = lines.map((entry, index) => {
    const line = (entry ?? {}) as JsonRecord;
    return {
      client_row_id: toTrimmedString(line.client_row_id) || toTrimmedString(line.id) || `ROW-${index + 1}`,
      id: toTrimmedString(line.id) || null,
      source_storage_location_id: toTrimmedString(line.source_storage_location_id),
      target_storage_location_id: toTrimmedString(line.target_storage_location_id),
      material_id: toTrimmedString(line.material_id),
      requested_qty: Number(parseNullableNumber(line.requested_qty) ?? 0),
      uom_code: toTrimmedString(line.uom_code) || null,
      stock_type_code: toUpperTrimmedString(line.stock_type_code),
      batch_number: toTrimmedString(line.batch_number) || null,
      source_lot_ref: toTrimmedString(line.source_lot_ref) || null,
    };
  });

  const materialInfo = await getMaterialInfo(normalized.map((line) => line.material_id));
  const mappedMaterialIds = await listCompanyMappedMaterialIds(companyId, normalized.map((line) => line.material_id));

  const rows: AvailabilityPreviewRow[] = [];
  for (const line of normalized) {
    let invalidReason: string | null = null;
    if (!line.source_storage_location_id || !line.target_storage_location_id || !line.material_id) {
      invalidReason = "Source, target, and material are required.";
    } else if (!STOCK_TYPES.has(line.stock_type_code)) {
      invalidReason = "Invalid stock type.";
    } else if (line.source_storage_location_id === line.target_storage_location_id) {
      invalidReason = "Source and target location cannot be the same.";
    } else if (!mappedMaterialIds.has(line.material_id)) {
      invalidReason = "Material is not mapped to this company.";
    }

    if (!invalidReason) {
      const material = materialInfo.get(line.material_id);
      if (!material) {
        invalidReason = "Material not found.";
      } else {
        const materialType = toUpperTrimmedString(material.material_type);
        if (materialType === "SFG" && !line.batch_number) {
          invalidReason = "Batch number is required for SFG materials.";
        } else if (materialType === "FG" && (!line.batch_number || !line.source_lot_ref)) {
          invalidReason = "Batch number and source lot are required for FG materials.";
        } else {
          const [sourceScope, targetScope] = await Promise.all([
            getStorageLocationScope(line.source_storage_location_id, companyId),
            getStorageLocationScope(line.target_storage_location_id, companyId),
          ]);
          if (sourceScope.company_id !== companyId || targetScope.company_id !== companyId) {
            invalidReason = "Source or target location does not belong to this company.";
          }
        }
      }
    }

    let liveQty = 0;
    let reservedOtherQty = 0;
    let availableQty = 0;
    let valuationRate = 0;
    if (!invalidReason) {
      const availability = await getLineAvailability({
        companyId,
        storageLocationId: line.source_storage_location_id,
        materialId: line.material_id,
        stockTypeCode: line.stock_type_code,
        batchNumber: line.batch_number,
        sourceLotRef: line.source_lot_ref,
        excludeRequestId: requestId ?? null,
        excludeLineId: line.id ?? null,
      });
      liveQty = availability.liveQty;
      reservedOtherQty = availability.reservedOtherQty;
      availableQty = availability.availableQty;
      valuationRate = availability.valuationRate;
      if (!(line.requested_qty > 0)) {
        invalidReason = "Requested quantity must be above zero.";
      } else if (line.requested_qty > availability.availableQty + EPSILON) {
        invalidReason = "Requested quantity exceeds available quantity.";
      }
    }

    rows.push({
      client_row_id: line.client_row_id,
      source_storage_location_id: line.source_storage_location_id,
      target_storage_location_id: line.target_storage_location_id,
      material_id: line.material_id,
      stock_type_code: line.stock_type_code,
      requested_qty: Number(line.requested_qty.toFixed(6)),
      uom_code: line.uom_code,
      batch_number: line.batch_number,
      source_lot_ref: line.source_lot_ref,
      live_qty: Number(liveQty.toFixed(6)),
      reserved_other_qty: Number(reservedOtherQty.toFixed(6)),
      available_qty: Number(availableQty.toFixed(6)),
      valuation_rate: valuationRate,
      is_valid: !invalidReason,
      invalid_reason: invalidReason,
    });
  }
  return rows;
}

function deriveHeaderStatusFromLines(lines: LtrLineRow[]): string {
  const hasOpen = lines.some((line) => {
    const status = toUpperTrimmedString(line.status);
    return status === "OPEN" || status === "PARTIALLY_POSTED";
  });
  const hasPosted = lines.some((line) => toUpperTrimmedString(line.status) === "POSTED");
  if (hasOpen && hasPosted) return "PARTIALLY_POSTED";
  if (hasOpen) return "OPEN";
  if (hasPosted) return "POSTED";
  return "CANCELLED";
}

function deriveLineStatus(requestedQty: number, postedQty: number): string {
  if (postedQty <= EPSILON) return "OPEN";
  if (postedQty >= requestedQty - EPSILON) return "POSTED";
  return "PARTIALLY_POSTED";
}

async function syncReservationForLine(
  requestId: string,
  lineId: string,
  line: TransferLineInput | LtrLineRow,
  companyId: string,
  postedQty: number,
  updatedBy: string,
): Promise<void> {
  const requestedQty = Number(parseNullableNumber((line as JsonRecord).requested_qty) ?? 0);
  const nextStatus =
    postedQty >= requestedQty - EPSILON
      ? "FULLY_ISSUED"
      : postedQty > EPSILON
        ? "PARTIAL"
        : "OPEN";
  const payload = {
    source_type: "LOCATION_TRANSFER",
    source_id: requestId,
    source_line_id: lineId,
    company_id: companyId,
    material_id: toTrimmedString((line as JsonRecord).material_id),
    storage_location_id: toTrimmedString((line as JsonRecord).source_storage_location_id),
    required_qty: requestedQty,
    uom_code: toTrimmedString((line as JsonRecord).uom_code) || "KG",
    required_by_date: null,
    issued_qty: Number(postedQty.toFixed(6)),
    status: nextStatus,
    batch_number: toTrimmedString((line as JsonRecord).batch_number) || null,
    source_lot_ref: toTrimmedString((line as JsonRecord).source_lot_ref) || null,
    last_updated_by: updatedBy,
    last_updated_at: nowIsoString(),
  };

  const { data: existing, error: lookupError } = await serviceRoleClient
    .schema("erp_production")
    .from("reservation_document")
    .select("id")
    .eq("source_type", "LOCATION_TRANSFER")
    .eq("source_line_id", lineId)
    .maybeSingle();
  if (lookupError) throw new Error("LTR_RESERVATION_SYNC_FAILED");

  if (existing?.id) {
    const { error } = await serviceRoleClient
      .schema("erp_production")
      .from("reservation_document")
      .update(payload)
      .eq("id", existing.id as string);
    if (error) throw new Error("LTR_RESERVATION_SYNC_FAILED");
  } else {
    const { error } = await serviceRoleClient
      .schema("erp_production")
      .from("reservation_document")
      .insert({
        ...payload,
        created_by: updatedBy,
      });
    if (error) throw new Error("LTR_RESERVATION_SYNC_FAILED");
  }
}

async function cancelReservationsForRequest(requestId: string, updatedBy: string): Promise<void> {
  const { error } = await serviceRoleClient
    .schema("erp_production")
    .from("reservation_document")
    .update({
      status: "CANCELLED",
      last_updated_by: updatedBy,
      last_updated_at: nowIsoString(),
    })
    .eq("source_type", "LOCATION_TRANSFER")
    .eq("source_id", requestId)
    .neq("status", "CANCELLED");
  if (error) throw new Error("LTR_RESERVATION_CANCEL_FAILED");
}

async function postTransferDocument(params: {
  requestId: string;
  action: "POST" | "REVERSE";
  postedBy: string;
  movements: JsonRecord[];
  context: JsonRecord;
}): Promise<void> {
  const { error } = await serviceRoleClient
    .schema("erp_inventory")
    .rpc("post_document", {
      p_reference_document_type: "LTR",
      p_reference_document_id: params.requestId,
      p_movements: params.movements,
      p_posted_by: params.postedBy,
      p_context: {
        action: params.action,
        ...params.context,
      },
    });
  if (error) {
    console.error("[location_transfer.postTransferDocument] rpc failed:", JSON.stringify(error));
    throw new Error("LTR_POST_DOCUMENT_FAILED");
  }
}

async function hydrateRequestPayload(requestId: string): Promise<JsonRecord> {
  const [requestRow, lineRows, postingRows] = await Promise.all([
    fetchRequestRow(requestId),
    fetchRequestLines(requestId),
    fetchRequestPostings(requestId),
  ]);

  const materialIds = [...new Set(lineRows.map((row) => toTrimmedString(row.material_id)).filter(Boolean))];
  const locationIds = [...new Set([
    ...lineRows.map((row) => toTrimmedString(row.source_storage_location_id)),
    ...lineRows.map((row) => toTrimmedString(row.target_storage_location_id)),
  ].filter(Boolean))];
  const userIds = [...new Set([
    toTrimmedString(requestRow.created_by),
    toTrimmedString(requestRow.last_updated_by),
    ...postingRows.map((row) => toTrimmedString(row.posted_by)),
  ].filter(Boolean))];

  const [materialRows, locationRows, userRows] = await Promise.all([
    materialIds.length
      ? serviceRoleClient.schema("erp_master").from("material_master").select("id, pace_code, material_name").in("id", materialIds)
      : Promise.resolve({ data: [] as JsonRecord[] }),
    locationIds.length
      ? serviceRoleClient.schema("erp_inventory").from("storage_location_master").select("id, code, name").in("id", locationIds)
      : Promise.resolve({ data: [] as JsonRecord[] }),
    userIds.length
      ? serviceRoleClient.schema("erp_hr").from("employee_master").select("auth_user_id, employee_code, full_name").in("auth_user_id", userIds)
      : Promise.resolve({ data: [] as JsonRecord[] }),
  ]);

  const materialMap = new Map(((materialRows.data ?? []) as JsonRecord[]).map((row) => [
    toTrimmedString(row.id),
    `${toTrimmedString(row.pace_code)} - ${toTrimmedString(row.material_name)}`.trim(),
  ]));
  const locationMap = new Map(((locationRows.data ?? []) as JsonRecord[]).map((row) => [
    toTrimmedString(row.id),
    {
      code: toTrimmedString(row.code),
      name: toTrimmedString(row.name),
      label: `${toTrimmedString(row.code)} - ${toTrimmedString(row.name)}`.trim(),
    },
  ]));
  const userMap = new Map(((userRows.data ?? []) as JsonRecord[]).map((row) => [
    toTrimmedString(row.auth_user_id),
    `${toTrimmedString(row.employee_code)} - ${toTrimmedString(row.full_name)}`.trim(),
  ]));

  const lineAvailability = await Promise.all(lineRows.map((line) => getLineAvailability({
    companyId: toTrimmedString(requestRow.company_id),
    storageLocationId: toTrimmedString(line.source_storage_location_id),
    materialId: toTrimmedString(line.material_id),
    stockTypeCode: toUpperTrimmedString(line.stock_type_code),
    batchNumber: toTrimmedString(line.batch_number) || null,
    sourceLotRef: toTrimmedString(line.source_lot_ref) || null,
    excludeRequestId: requestId,
    excludeLineId: toTrimmedString(line.id),
  })));

  return {
    ...requestRow,
    created_by_label: userMap.get(toTrimmedString(requestRow.created_by)) ?? null,
    last_updated_by_label: userMap.get(toTrimmedString(requestRow.last_updated_by)) ?? null,
    lines: lineRows.map((line, index) => ({
      ...line,
      material_label: materialMap.get(toTrimmedString(line.material_id)) ?? "—",
      source_storage_location: locationMap.get(toTrimmedString(line.source_storage_location_id)) ?? null,
      target_storage_location: locationMap.get(toTrimmedString(line.target_storage_location_id)) ?? null,
      available_qty: Number(lineAvailability[index]?.availableQty ?? 0),
      live_qty: Number(lineAvailability[index]?.liveQty ?? 0),
      reserved_other_qty: Number(lineAvailability[index]?.reservedOtherQty ?? 0),
      open_qty: Number((
        Number(parseNullableNumber(line.requested_qty) ?? 0)
        - Number(parseNullableNumber(line.posted_qty) ?? 0)
      ).toFixed(6)),
    })),
    postings: postingRows.map((posting) => ({
      ...posting,
      posted_by_label: userMap.get(toTrimmedString(posting.posted_by)) ?? null,
    })),
  };
}

export async function listLocationTransferRequestsHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    const url = new URL(req.url);
    const companyId = toTrimmedString(url.searchParams.get("company_id"));
    const status = toUpperTrimmedString(url.searchParams.get("status"));
    const search = toTrimmedString(url.searchParams.get("search"));
    if (!companyId) {
      return ltrErrorResponse(req, ctx, "LTR_COMPANY_REQUIRED", 400, "company_id is required.");
    }
    await assertScopedCompanyAccess(ctx, companyId, REQUEST_RESOURCE, "VIEW");

    let query = serviceRoleClient
      .schema("erp_inventory")
      .from("location_transfer_request")
      .select("*")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });
    if (REQUEST_STATUSES.has(status)) query = query.eq("status", status);
    if (search) query = query.ilike("ltr_number", `%${search}%`);
    const { data, error } = await query;
    if (error) throw new Error("LTR_LIST_FAILED");
    return okResponse({ items: (data ?? []) as JsonRecord[] }, ctx.request_id, req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "LTR_LIST_FAILED";
    const code = message === "LTR_SCOPE_VIOLATION" ? "LTR_SCOPE_VIOLATION" : "LTR_LIST_FAILED";
    const status = code === "LTR_SCOPE_VIOLATION" ? 403 : 400;
    return ltrErrorResponse(req, ctx, code, status, message);
  }
}

export async function getLocationTransferRequestHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    const requestId = getRequestIdFromPath(req);
    const requestRow = await fetchRequestRow(requestId);
    await assertScopedCompanyAccess(ctx, toTrimmedString(requestRow.company_id), REQUEST_RESOURCE, "VIEW");
    return okResponse(await hydrateRequestPayload(requestId), ctx.request_id, req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "LTR_REQUEST_LOOKUP_FAILED";
    const code = message === "LTR_SCOPE_VIOLATION" ? "LTR_SCOPE_VIOLATION" : message;
    const status = code === "LTR_SCOPE_VIOLATION" ? 403 : code === "LTR_REQUEST_NOT_FOUND" ? 404 : 400;
    return ltrErrorResponse(req, ctx, code, status, message);
  }
}

export async function createLocationTransferRequestHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    const body = await parseBody(req);
    const companyId = toTrimmedString(body.company_id);
    if (!companyId) {
      return ltrErrorResponse(req, ctx, "LTR_COMPANY_REQUIRED", 400, "company_id is required.");
    }
    await assertScopedCompanyAccess(ctx, companyId, REQUEST_RESOURCE, "WRITE");
    const lines = await normalizeLinesForSave(companyId, body.lines);
    const ltrNumber = await generateProcurementDocNumber("LTR");
    const now = nowIsoString();

    const { data: requestRow, error: requestError } = await serviceRoleClient
      .schema("erp_inventory")
      .from("location_transfer_request")
      .insert({
        ltr_number: ltrNumber,
        company_id: companyId,
        request_date: toTrimmedString(body.request_date) || todayIsoDate(),
        required_by_date: toTrimmedString(body.required_by_date) || null,
        remarks: toTrimmedString(body.remarks) || null,
        created_by: ctx.auth_user_id,
        last_updated_by: ctx.auth_user_id,
        last_updated_at: now,
      })
      .select("id")
      .single();
    if (requestError || !requestRow?.id) throw new Error("LTR_CREATE_FAILED");

    const insertLines = lines.map((line, index) => ({
      request_id: requestRow.id,
      line_no: index + 1,
      source_storage_location_id: line.source_storage_location_id,
      target_storage_location_id: line.target_storage_location_id,
      material_id: line.material_id,
      requested_qty: line.requested_qty,
      posted_qty: 0,
      uom_code: line.uom_code ?? "KG",
      stock_type_code: line.stock_type_code,
      batch_number: line.batch_number ?? null,
      source_lot_ref: line.source_lot_ref ?? null,
      remarks: line.remarks ?? null,
      created_by: ctx.auth_user_id,
      last_updated_by: ctx.auth_user_id,
      last_updated_at: now,
    }));
    const { data: lineRows, error: lineError } = await serviceRoleClient
      .schema("erp_inventory")
      .from("location_transfer_request_line")
      .insert(insertLines)
      .select("*");
    if (lineError) throw new Error("LTR_LINE_CREATE_FAILED");

    for (const line of (lineRows ?? []) as LtrLineRow[]) {
      await syncReservationForLine(
        toTrimmedString(requestRow.id),
        toTrimmedString(line.id),
        line,
        companyId,
        0,
        ctx.auth_user_id,
      );
    }

    return okResponse(await hydrateRequestPayload(toTrimmedString(requestRow.id)), ctx.request_id, req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "LTR_CREATE_FAILED";
    const code =
      message === "LTR_SCOPE_VIOLATION"
        ? "LTR_SCOPE_VIOLATION"
        : message === "LTR_REQUEST_QTY_EXCEEDS_AVAILABLE"
          ? "LTR_REQUEST_QTY_EXCEEDS_AVAILABLE"
          : "LTR_CREATE_FAILED";
    const status = code === "LTR_SCOPE_VIOLATION" ? 403 : code === "LTR_REQUEST_QTY_EXCEEDS_AVAILABLE" ? 409 : 400;
    return ltrErrorResponse(req, ctx, code, status, message);
  }
}

export async function updateLocationTransferRequestHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    const requestId = getRequestIdFromPath(req);
    const body = await parseBody(req);
    const requestRow = await fetchRequestRow(requestId);
    const companyId = toTrimmedString(requestRow.company_id);
    await assertScopedCompanyAccess(ctx, companyId, REQUEST_RESOURCE, "EDIT");
    if (toUpperTrimmedString(requestRow.status) === "POSTED" || toUpperTrimmedString(requestRow.status) === "CANCELLED") {
      return ltrErrorResponse(req, ctx, "LTR_REQUEST_LOCKED", 409, "This request can no longer be edited.");
    }
    const existingLines = await fetchRequestLines(requestId);
    const lockedLineIds = new Set(
      existingLines
        .filter((line) => Number(parseNullableNumber(line.posted_qty) ?? 0) > EPSILON)
        .map((line) => toTrimmedString(line.id)),
    );
    // Lines already posted (in whole or in part) are excluded here, not rejected
    // wholesale -- §121.6 only locks that specific line's commercial identity,
    // the rest of the request (other open lines, new lines, header) stays editable.
    const incomingLines = (Array.isArray(body.lines) ? body.lines : [])
      .filter((entry) => {
        const id = toTrimmedString((entry as JsonRecord)?.id);
        return !id || !lockedLineIds.has(id);
      });
    let lines: TransferLineInput[] = [];
    if (incomingLines.length > 0) {
      lines = await normalizeLinesForSave(companyId, incomingLines, requestId);
    } else if (lockedLineIds.size === 0) {
      throw new Error("LTR_LINE_REQUIRED");
    }
    const now = nowIsoString();

    const { error: headerError } = await serviceRoleClient
      .schema("erp_inventory")
      .from("location_transfer_request")
      .update({
        request_date: toTrimmedString(body.request_date) || toTrimmedString(requestRow.request_date) || todayIsoDate(),
        required_by_date: toTrimmedString(body.required_by_date) || null,
        remarks: toTrimmedString(body.remarks) || null,
        last_updated_by: ctx.auth_user_id,
        last_updated_at: now,
      })
      .eq("id", requestId);
    if (headerError) throw new Error("LTR_UPDATE_FAILED");

    const existingLineIds = new Set(existingLines.map((line) => toTrimmedString(line.id)).filter(Boolean));
    const nextLineIds = new Set(lines.map((line) => toTrimmedString(line.id)).filter(Boolean));
    // Locked (already-posted) lines are never in `lines` -- they were deliberately
    // excluded above, not dropped by the caller. Never delete them.
    const deleteIds = [...existingLineIds].filter((id) => !nextLineIds.has(id) && !lockedLineIds.has(id));
    if (deleteIds.length > 0) {
      const { error: deleteReservationError } = await serviceRoleClient
        .schema("erp_production")
        .from("reservation_document")
        .delete()
        .in("source_line_id", deleteIds);
      if (deleteReservationError) throw new Error("LTR_RESERVATION_DELETE_FAILED");
      const { error: deleteLineError } = await serviceRoleClient
        .schema("erp_inventory")
        .from("location_transfer_request_line")
        .delete()
        .in("id", deleteIds);
      if (deleteLineError) throw new Error("LTR_LINE_DELETE_FAILED");
    }

    for (const [index, line] of lines.entries()) {
      const lineNo = index + 1;
      const linePayload = {
        request_id: requestId,
        line_no: lineNo,
        source_storage_location_id: line.source_storage_location_id,
        target_storage_location_id: line.target_storage_location_id,
        material_id: line.material_id,
        requested_qty: line.requested_qty,
        uom_code: line.uom_code ?? "KG",
        stock_type_code: line.stock_type_code,
        batch_number: line.batch_number ?? null,
        source_lot_ref: line.source_lot_ref ?? null,
        remarks: line.remarks ?? null,
        posted_qty: 0,
        status: "OPEN",
        last_updated_by: ctx.auth_user_id,
        last_updated_at: now,
      };
      if (line.id) {
        const { error: updateLineError } = await serviceRoleClient
          .schema("erp_inventory")
          .from("location_transfer_request_line")
          .update(linePayload)
          .eq("id", line.id)
          .eq("request_id", requestId);
        if (updateLineError) throw new Error("LTR_LINE_UPDATE_FAILED");
        await syncReservationForLine(requestId, line.id, linePayload, companyId, 0, ctx.auth_user_id);
      } else {
        const { data: createdLine, error: insertLineError } = await serviceRoleClient
          .schema("erp_inventory")
          .from("location_transfer_request_line")
          .insert({
            ...linePayload,
            created_by: ctx.auth_user_id,
          })
          .select("*")
          .single();
        if (insertLineError || !createdLine?.id) throw new Error("LTR_LINE_CREATE_FAILED");
        await syncReservationForLine(requestId, toTrimmedString(createdLine.id), createdLine as LtrLineRow, companyId, 0, ctx.auth_user_id);
      }
    }

    return okResponse(await hydrateRequestPayload(requestId), ctx.request_id, req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "LTR_UPDATE_FAILED";
    const code =
      message === "LTR_SCOPE_VIOLATION"
        ? "LTR_SCOPE_VIOLATION"
        : message === "LTR_REQUEST_QTY_EXCEEDS_AVAILABLE"
          ? "LTR_REQUEST_QTY_EXCEEDS_AVAILABLE"
          : message === "LTR_REQUEST_LOCKED"
            ? "LTR_REQUEST_LOCKED"
            : "LTR_UPDATE_FAILED";
    const status = code === "LTR_SCOPE_VIOLATION" ? 403 : code === "LTR_REQUEST_QTY_EXCEEDS_AVAILABLE" || code === "LTR_REQUEST_LOCKED" ? 409 : 400;
    return ltrErrorResponse(req, ctx, code, status, message);
  }
}

export async function cancelLocationTransferRequestHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    const requestId = getRequestIdFromPath(req);
    const requestRow = await fetchRequestRow(requestId);
    const companyId = toTrimmedString(requestRow.company_id);
    await assertScopedCompanyAccess(ctx, companyId, REQUEST_RESOURCE, "EDIT");
    const lines = await fetchRequestLines(requestId);
    if (lines.some((line) => Number(parseNullableNumber(line.posted_qty) ?? 0) > EPSILON)) {
      return ltrErrorResponse(req, ctx, "LTR_CANCEL_FORBIDDEN", 409, "Use IN11 reversal after posting has started.");
    }
    const now = nowIsoString();
    const { error: lineError } = await serviceRoleClient
      .schema("erp_inventory")
      .from("location_transfer_request_line")
      .update({
        status: "CANCELLED",
        last_updated_by: ctx.auth_user_id,
        last_updated_at: now,
      })
      .eq("request_id", requestId);
    if (lineError) throw new Error("LTR_CANCEL_FAILED");
    const { error: headerError } = await serviceRoleClient
      .schema("erp_inventory")
      .from("location_transfer_request")
      .update({
        status: "CANCELLED",
        cancelled_by: ctx.auth_user_id,
        cancelled_at: now,
        cancellation_reason: toTrimmedString((await parseBody(req)).reason) || null,
        last_updated_by: ctx.auth_user_id,
        last_updated_at: now,
      })
      .eq("id", requestId);
    if (headerError) throw new Error("LTR_CANCEL_FAILED");
    await cancelReservationsForRequest(requestId, ctx.auth_user_id);
    return okResponse(await hydrateRequestPayload(requestId), ctx.request_id, req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "LTR_CANCEL_FAILED";
    const code = message === "LTR_SCOPE_VIOLATION" ? "LTR_SCOPE_VIOLATION" : message === "LTR_CANCEL_FORBIDDEN" ? "LTR_CANCEL_FORBIDDEN" : "LTR_CANCEL_FAILED";
    const status = code === "LTR_SCOPE_VIOLATION" ? 403 : code === "LTR_CANCEL_FORBIDDEN" ? 409 : 400;
    return ltrErrorResponse(req, ctx, code, status, message);
  }
}

export async function getLocationTransferWorkbenchHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    const url = new URL(req.url);
    const requestId = toTrimmedString(url.searchParams.get("request_id"));
    const requestNumber = toTrimmedString(url.searchParams.get("request_number"));
    const companyId = toTrimmedString(url.searchParams.get("company_id"));
    if (!requestId && !(requestNumber && companyId)) {
      return ltrErrorResponse(req, ctx, "LTR_REQUEST_REQUIRED", 400, "request_id or company_id + request_number is required.");
    }
    const requestRow = requestId
      ? await fetchRequestRow(requestId)
      : await fetchRequestRowByNumber(companyId, requestNumber);
    await assertScopedCompanyAccess(ctx, toTrimmedString(requestRow.company_id), POST_RESOURCE, "WRITE");
    const payload = await hydrateRequestPayload(toTrimmedString(requestRow.id));
    return okResponse(payload, ctx.request_id, req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "LTR_WORKBENCH_FAILED";
    const code = message === "LTR_SCOPE_VIOLATION" ? "LTR_SCOPE_VIOLATION" : message;
    const status = code === "LTR_SCOPE_VIOLATION" ? 403 : code === "LTR_REQUEST_NOT_FOUND" ? 404 : 400;
    return ltrErrorResponse(req, ctx, code, status, message);
  }
}

export async function previewLocationTransferAvailabilityHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    const body = await parseBody(req);
    const companyId = toTrimmedString(body.company_id);
    const requestId = toTrimmedString(body.request_id) || null;
    if (!companyId) {
      return ltrErrorResponse(req, ctx, "LTR_COMPANY_REQUIRED", 400, "company_id is required.");
    }
    await assertScopedCompanyAccess(ctx, companyId, REQUEST_RESOURCE, requestId ? "EDIT" : "WRITE");
    const rows = await buildAvailabilityPreview(companyId, body.lines, requestId);
    return okResponse({
      rows,
      has_invalid_rows: rows.some((row) => !row.is_valid),
    }, ctx.request_id, req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "LTR_AVAILABILITY_PREVIEW_FAILED";
    const code = message === "LTR_SCOPE_VIOLATION" ? "LTR_SCOPE_VIOLATION" : "LTR_AVAILABILITY_PREVIEW_FAILED";
    const status = code === "LTR_SCOPE_VIOLATION" ? 403 : 400;
    return ltrErrorResponse(req, ctx, code, status, message);
  }
}

export async function postLocationTransferHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    const body = await parseBody(req);
    const requestId = toTrimmedString(body.request_id);
    const postingLines = (Array.isArray(body.lines) ? body.lines : []).map((entry) => ({
      request_line_id: toTrimmedString((entry as JsonRecord).request_line_id),
      quantity: Number(parsePositiveNumber((entry as JsonRecord).quantity) ?? 0),
      remarks: toTrimmedString((entry as JsonRecord).remarks) || null,
    })).filter((entry) => entry.request_line_id && entry.quantity > 0) as PostingInput[];
    if (!requestId || postingLines.length === 0) {
      return ltrErrorResponse(req, ctx, "LTR_POST_INVALID", 400, "request_id and at least one posting line are required.");
    }
    const requestRow = await fetchRequestRow(requestId);
    const companyId = toTrimmedString(requestRow.company_id);
    await assertScopedCompanyAccess(ctx, companyId, POST_RESOURCE, "WRITE");
    if (toUpperTrimmedString(requestRow.status) === "CANCELLED") {
      return ltrErrorResponse(req, ctx, "LTR_POST_INVALID", 409, "Cancelled requests cannot be posted.");
    }
    const lineRows = await fetchRequestLines(requestId);
    const lineMap = new Map(lineRows.map((line) => [toTrimmedString(line.id), line]));
    const requestNumber = toTrimmedString(requestRow.ltr_number);
    const matDoc = await generateMaterialDocNumber(companyId);
    const postingDate = todayIsoDate();
    const movementTypeCode = "P311";
    const movements: JsonRecord[] = [];
    const completionLines: JsonRecord[] = [];

    for (const entry of postingLines) {
      const line = lineMap.get(entry.request_line_id);
      if (!line) throw new Error("LTR_LINE_NOT_FOUND");
      if (!LINE_STATUSES.has(toUpperTrimmedString(line.status)) || toUpperTrimmedString(line.status) === "CANCELLED") {
        throw new Error("LTR_LINE_CLOSED");
      }
      const requestedQty = Number(parseNullableNumber(line.requested_qty) ?? 0);
      const postedQty = Number(parseNullableNumber(line.posted_qty) ?? 0);
      const openQty = requestedQty - postedQty;
      if (entry.quantity > openQty + EPSILON) {
        throw new Error("LTR_POST_QTY_EXCEEDS_OPEN");
      }
      const availability = await getLineAvailability({
        companyId,
        storageLocationId: toTrimmedString(line.source_storage_location_id),
        materialId: toTrimmedString(line.material_id),
        stockTypeCode: toUpperTrimmedString(line.stock_type_code),
        batchNumber: toTrimmedString(line.batch_number) || null,
        sourceLotRef: toTrimmedString(line.source_lot_ref) || null,
        excludeRequestId: requestId,
        excludeLineId: entry.request_line_id,
      });
      if (entry.quantity > availability.availableQty + EPSILON) {
        throw new Error("LTR_REQUEST_QTY_EXCEEDS_AVAILABLE");
      }

      const outLineRef = `${entry.request_line_id}::OUT`;
      const inLineRef = `${entry.request_line_id}::IN`;
      const commonMovement = {
        document_number: requestNumber,
        document_date: postingDate,
        posting_date: postingDate,
        movement_type_code: movementTypeCode,
        company_id: companyId,
        material_id: toTrimmedString(line.material_id),
        quantity: entry.quantity,
        base_uom_code: toTrimmedString(line.uom_code) || "KG",
        unit_value: availability.valuationRate,
        stock_type_code: toUpperTrimmedString(line.stock_type_code),
        batch_number: toTrimmedString(line.batch_number) || null,
        material_doc_number: matDoc.docNumber,
        material_doc_year: matDoc.docYear,
        reference_document_number: requestNumber,
      };
      movements.push({
        ...commonMovement,
        line_ref: outLineRef,
        storage_location_id: toTrimmedString(line.source_storage_location_id),
        direction: "OUT",
        reversal_of_id: null,
      });
      movements.push({
        ...commonMovement,
        line_ref: inLineRef,
        storage_location_id: toTrimmedString(line.target_storage_location_id),
        direction: "IN",
        reversal_of_id: null,
      });
      completionLines.push({
        request_line_id: entry.request_line_id,
        posted_qty: entry.quantity,
        uom_code: toTrimmedString(line.uom_code) || "KG",
        batch_number: toTrimmedString(line.batch_number) || null,
        source_lot_ref: toTrimmedString(line.source_lot_ref) || null,
        remarks: entry.remarks ?? null,
        movement_type_code: movementTypeCode,
        material_doc_number: matDoc.docNumber,
        material_doc_year: matDoc.docYear,
        out_line_ref: outLineRef,
        in_line_ref: inLineRef,
      });
    }

    await postTransferDocument({
      requestId,
      action: "POST",
      postedBy: ctx.auth_user_id,
      movements,
      context: {
        request_id: requestId,
        posted_by: ctx.auth_user_id,
        posting_lines: completionLines,
      },
    });

    return okResponse(await hydrateRequestPayload(requestId), ctx.request_id, req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "LTR_POST_FAILED";
    const code =
      message === "LTR_SCOPE_VIOLATION"
        ? "LTR_SCOPE_VIOLATION"
        : message === "LTR_REQUEST_QTY_EXCEEDS_AVAILABLE" || message === "LTR_POST_QTY_EXCEEDS_OPEN"
          ? message
          : message === "LTR_POST_DOCUMENT_FAILED"
            ? "LTR_POST_DOCUMENT_FAILED"
          : "LTR_POST_FAILED";
    const status = code === "LTR_SCOPE_VIOLATION" ? 403 : code === "LTR_REQUEST_QTY_EXCEEDS_AVAILABLE" || code === "LTR_POST_QTY_EXCEEDS_OPEN" ? 409 : code === "LTR_POST_DOCUMENT_FAILED" ? 500 : 400;
    return ltrErrorResponse(req, ctx, code, status, message);
  }
}

export async function reverseLocationTransferPostingHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    const postingId = getPostingIdFromPath(req);
    const { data: posting, error: postingError } = await serviceRoleClient
      .schema("erp_inventory")
      .from("location_transfer_posting")
      .select("*")
      .eq("id", postingId)
      .single();
    if (postingError || !posting) throw new Error("LTR_POSTING_NOT_FOUND");
    const requestRow = await fetchRequestRow(toTrimmedString((posting as JsonRecord).request_id));
    const companyId = toTrimmedString(requestRow.company_id);
    await assertScopedCompanyAccess(ctx, companyId, REVERSE_RESOURCE, "WRITE");
    if (toTrimmedString((posting as JsonRecord).reversal_of_posting_id)) {
      return ltrErrorResponse(req, ctx, "LTR_REVERSE_INVALID", 409, "A reversal cannot be reversed again.");
    }
    const { data: reversalExists } = await serviceRoleClient
      .schema("erp_inventory")
      .from("location_transfer_posting")
      .select("id")
      .eq("reversal_of_posting_id", postingId)
      .maybeSingle();
    if (reversalExists?.id) {
      return ltrErrorResponse(req, ctx, "LTR_REVERSE_INVALID", 409, "This posting has already been reversed.");
    }

    const line = (await fetchRequestLines(toTrimmedString((posting as JsonRecord).request_id)))
      .find((row) => toTrimmedString(row.id) === toTrimmedString((posting as JsonRecord).request_line_id));
    if (!line) throw new Error("LTR_LINE_NOT_FOUND");

    const matDoc = await generateMaterialDocNumber(companyId);
    const quantity = Number(parseNullableNumber((posting as JsonRecord).posted_qty) ?? 0);
    const stockTypeCode = toUpperTrimmedString(line.stock_type_code);
    const uomCode = toTrimmedString((posting as JsonRecord).uom_code) || toTrimmedString(line.uom_code) || "KG";
    const sourceStorageLocationId = toTrimmedString(line.source_storage_location_id);
    const targetStorageLocationId = toTrimmedString(line.target_storage_location_id);
    const materialId = toTrimmedString(line.material_id);
    const batchNumber = toTrimmedString((posting as JsonRecord).batch_number) || toTrimmedString(line.batch_number) || null;
    const targetBalance = await getLiveStockBalance({
      companyId,
      storageLocationId: targetStorageLocationId,
      materialId,
      stockTypeCode,
      batchNumber,
      sourceLotRef: toTrimmedString((posting as JsonRecord).source_lot_ref) || toTrimmedString(line.source_lot_ref) || null,
    });
    if (quantity > targetBalance.quantity + EPSILON) {
      return ltrErrorResponse(req, ctx, "LTR_REVERSE_INVALID", 409, "Target location no longer has enough quantity to reverse.");
    }

    const reverseBody = await parseBody(req);
    const requestNumber = toTrimmedString(requestRow.ltr_number);
    const postingDate = todayIsoDate();
    const requestLineId = toTrimmedString((posting as JsonRecord).request_line_id);
    const outLineRef = `${requestLineId}::REV::OUT::${postingId}`;
    const inLineRef = `${requestLineId}::REV::IN::${postingId}`;

    await postTransferDocument({
      requestId: toTrimmedString((posting as JsonRecord).request_id),
      action: "REVERSE",
      postedBy: ctx.auth_user_id,
      movements: [
        {
          line_ref: outLineRef,
          document_number: requestNumber,
          document_date: postingDate,
          posting_date: postingDate,
          movement_type_code: "P312",
          company_id: companyId,
          storage_location_id: targetStorageLocationId,
          material_id: materialId,
          quantity,
          base_uom_code: uomCode,
          unit_value: targetBalance.valuationRate,
          stock_type_code: stockTypeCode,
          direction: "OUT",
          reversal_of_id: null,
          batch_number: batchNumber,
          material_doc_number: matDoc.docNumber,
          material_doc_year: matDoc.docYear,
          reference_document_number: requestNumber,
        },
        {
          line_ref: inLineRef,
          document_number: requestNumber,
          document_date: postingDate,
          posting_date: postingDate,
          movement_type_code: "P312",
          company_id: companyId,
          storage_location_id: sourceStorageLocationId,
          material_id: materialId,
          quantity,
          base_uom_code: uomCode,
          unit_value: targetBalance.valuationRate,
          stock_type_code: stockTypeCode,
          direction: "IN",
          reversal_of_id: null,
          batch_number: batchNumber,
          material_doc_number: matDoc.docNumber,
          material_doc_year: matDoc.docYear,
          reference_document_number: requestNumber,
        },
      ],
      context: {
        request_id: toTrimmedString((posting as JsonRecord).request_id),
        posted_by: ctx.auth_user_id,
        posting_lines: [
          {
            request_line_id: requestLineId,
            posted_qty: quantity,
            uom_code: uomCode,
            batch_number: batchNumber,
            source_lot_ref: toTrimmedString((posting as JsonRecord).source_lot_ref) || null,
            remarks: toTrimmedString(reverseBody.remarks) || null,
            movement_type_code: "P312",
            material_doc_number: matDoc.docNumber,
            material_doc_year: matDoc.docYear,
            reversal_of_posting_id: postingId,
            out_line_ref: outLineRef,
            in_line_ref: inLineRef,
          },
        ],
      },
    });

    return okResponse(await hydrateRequestPayload(toTrimmedString((posting as JsonRecord).request_id)), ctx.request_id, req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "LTR_REVERSE_FAILED";
    const code = message === "LTR_SCOPE_VIOLATION" ? "LTR_SCOPE_VIOLATION" : message === "LTR_REVERSE_INVALID" ? "LTR_REVERSE_INVALID" : message === "LTR_POST_DOCUMENT_FAILED" ? "LTR_POST_DOCUMENT_FAILED" : "LTR_REVERSE_FAILED";
    const status = code === "LTR_SCOPE_VIOLATION" ? 403 : code === "LTR_REVERSE_INVALID" ? 409 : code === "LTR_POST_DOCUMENT_FAILED" ? 500 : 400;
    return ltrErrorResponse(req, ctx, code, status, message);
  }
}
