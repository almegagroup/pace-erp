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
import { generateBatchNumber } from "./batch_series.handlers.ts";
import { generateCompanyDocNumber } from "./production.utils.ts";

type JsonRecord = Record<string, unknown>;
type StockPostingResult = { stock_document_id: string; stock_ledger_id: string };

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
    .select("id, location_code, location_name")
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
    .select("material_id, alternate_material_id, dosage_pct")
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
  const alternateMap = await fetchStrokeAlternates(strokeMasterId);
  const materialIds = [
    ...lines.map((line) => String(line.material_id ?? "")),
    ...lines.map((line) => String(line.actual_material_id ?? "")),
    ...Array.from(alternateMap.values()).map((line) => String(line.alternate_material_id ?? "")),
  ];
  const slocIds = lines.map((line) => String(line.issue_sloc_id ?? ""));

  const [materialMap, slocMap] = await Promise.all([
    getMaterialMapByIds(
      materialIds,
      "[process_order.fetchOrderLines]",
      "PROD_PO_FETCH_FAILED",
      "id, pace_code, material_name, base_uom_code, production_mode, shade_code",
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
    return {
      ...line,
      dosage_pct: line.dosage_pct ?? alternate?.dosage_pct ?? null,
      material: materialMap.get(String(line.material_id ?? "")) ?? null,
      actual_material: materialMap.get(String(line.actual_material_id ?? "")) ?? null,
      registered_alternate_material_id: alternateMaterialId || null,
      registered_alternate_material: alternateMaterialId
        ? materialMap.get(alternateMaterialId) ?? null
        : null,
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
    .select("id, source_line_id, material_id, required_qty, issued_qty, status, storage_location_id, uom_code")
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

async function getSegmentLocConfig(companyId: string, segmentCode: string): Promise<JsonRecord | null> {
  const { data, error } = await serviceRoleClient
    .schema("erp_production")
    .from("production_segment_location_config")
    .select("rm_sloc_id, pm_sloc_id, shopfloor_sloc_id, fg_sloc_id")
    .eq("company_id", companyId)
    .eq("segment_code", segmentCode)
    .maybeSingle();
  if (error) {
    console.error("[process_order.getSegmentLocConfig] query failed:", JSON.stringify(error));
    throw new Error("PROD_PO_FETCH_FAILED");
  }
  return (data as JsonRecord | null) ?? null;
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
    });
  if (error || !Array.isArray(data) || data.length === 0) {
    console.error("[process_order.postStockMovement] rpc failed:", JSON.stringify(error));
    throw new Error(`PROD_STOCK_POST_FAILED: ${params.movementTypeCode} ${params.direction}`);
  }
  return data[0] as StockPostingResult;
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

function getIssueStorageLocationId(line: JsonRecord, segConfig: JsonRecord): string | null {
  return toTrimmedString(
    line.issue_sloc_id || (line.is_rm ? segConfig.rm_sloc_id : segConfig.pm_sloc_id),
  ) || null;
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
  const strokeAlternates = await fetchStrokeAlternates(toTrimmedString(po.stroke_master_id) || null);
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

      let nextActualMaterialId = toTrimmedString(bodyLine.actual_material_id) || null;
      const currentActualMaterialId = toTrimmedString(existingLine.actual_material_id) || null;
      const registeredAlternateId = toTrimmedString(
        strokeAlternates.get(String(existingLine.material_id))?.alternate_material_id,
      ) || null;

      if (!nextActualMaterialId || nextActualMaterialId === String(existingLine.material_id)) {
        nextActualMaterialId = null;
      }

      if (nextActualMaterialId !== currentActualMaterialId) {
        if (nextActualMaterialId && nextActualMaterialId !== registeredAlternateId) {
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
              storage_location_id: reservation.storage_location_id ?? existingLine.issue_sloc_id ?? null,
              required_qty: reservation.required_qty,
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

      const { error: lineUpdateErr } = await serviceRoleClient
        .schema("erp_production")
        .from("process_order_line")
        .update({
          actual_qty: actualQty,
          approved_status: approval.approved_status,
          ap_approved_qty: approval.ap_approved_qty,
          variance_qty: approval.variance_qty,
          actual_material_id: nextActualMaterialId,
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
        issue_sloc_id: null,
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
        storage_location_id: null,
        required_qty: 0,
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

async function checkStockAvailability(
  companyId: string,
  needed: Map<string, number>,
): Promise<{ material_id: string; needed: number; available: number }[]> {
  const matIds = Array.from(needed.keys());
  if (matIds.length === 0) return [];

  const { data: ledgerRows, error: ledgerErr } = await serviceRoleClient
    .schema("erp_inventory")
    .from("stock_ledger")
    .select("material_id, direction, quantity")
    .eq("company_id", companyId)
    .eq("stock_type_code", "UNRESTRICTED")
    .in("material_id", matIds);
  if (ledgerErr) {
    console.error("[process_order.checkStockAvailability] ledger query failed:", JSON.stringify(ledgerErr));
    throw new Error("PROD_PO_STOCK_CHECK_FAILED");
  }

  const available = new Map<string, number>();
  for (const row of (ledgerRows ?? []) as JsonRecord[]) {
    const mid = String(row.material_id);
    const qty = Number(row.quantity ?? 0);
    available.set(mid, (available.get(mid) ?? 0) + (String(row.direction) === "IN" ? qty : -qty));
  }

  const { data: reservationRows, error: reservationErr } = await serviceRoleClient
    .schema("erp_production")
    .from("reservation_document")
    .select("material_id, balance_qty")
    .eq("company_id", companyId)
    .in("material_id", matIds)
    .in("status", RESERVATION_OPEN_STATUSES);
  if (reservationErr) {
    console.error("[process_order.checkStockAvailability] reservation query failed:", JSON.stringify(reservationErr));
    throw new Error("PROD_PO_STOCK_CHECK_FAILED");
  }
  for (const row of (reservationRows ?? []) as JsonRecord[]) {
    const mid = String(row.material_id);
    const qty = Number(row.balance_qty ?? 0);
    available.set(mid, (available.get(mid) ?? 0) - qty);
  }

  const { data: matRows, error: matErr } = await serviceRoleClient
    .schema("erp_master")
    .from("material_master")
    .select("id, production_mode")
    .in("id", matIds);
  if (matErr) {
    console.error("[process_order.checkStockAvailability] material query failed:", JSON.stringify(matErr));
    throw new Error("PROD_PO_STOCK_CHECK_FAILED");
  }

  const intMats = new Set(
    ((matRows ?? []) as JsonRecord[])
      .filter((row) => row.production_mode === "INT")
      .map((row) => String(row.id)),
  );

  if (intMats.size > 0) {
    const { data: intPOs, error: intErr } = await serviceRoleClient
      .schema("erp_production")
      .from("process_order")
      .select("material_id, planned_qty, actual_qty")
      .eq("company_id", companyId)
      .eq("po_type", "INT")
      .in("status", ["STANDARD", "QA_APPROVED", "BATCH_STARTED", "FINAL"])
      .in("material_id", Array.from(intMats));
    if (intErr) {
      console.error("[process_order.checkStockAvailability] int-po query failed:", JSON.stringify(intErr));
      throw new Error("PROD_PO_STOCK_CHECK_FAILED");
    }

    for (const row of (intPOs ?? []) as JsonRecord[]) {
      const mid = String(row.material_id);
      const qty = Number(row.actual_qty ?? row.planned_qty ?? 0);
      available.set(mid, (available.get(mid) ?? 0) + qty);
    }
  }

  const short: { material_id: string; needed: number; available: number }[] = [];
  for (const [mid, neededQty] of needed.entries()) {
    const avail = available.get(mid) ?? 0;
    if (avail < neededQty - EPSILON) {
      short.push({ material_id: mid, needed: neededQty, available: Math.max(0, avail) });
    }
  }
  return short;
}

export async function listProcessOrdersHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const url = new URL(req.url);
    const companyId = toTrimmedString(url.searchParams.get("company_id") ?? "");
    const status = toUpperTrimmedString(url.searchParams.get("status") ?? "");
    const poType = toUpperTrimmedString(url.searchParams.get("po_type") ?? "");
    const poTypeIn = toTrimmedString(url.searchParams.get("po_type_in") ?? "");
    const poTypeList = poTypeIn
      ? poTypeIn.split(",").map((value) => toUpperTrimmedString(value)).filter(Boolean)
      : [];
    const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
    const perPage = Math.min(100, Math.max(10, parseInt(url.searchParams.get("per_page") ?? "20", 10)));

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
    const materialMap = await getMaterialMapByIds(
      rows.map((row) => String(row.material_id ?? "")),
      "[process_order.listProcessOrders]",
      "PROD_PO_LIST_FAILED",
      "id, pace_code, material_name, shade_code",
    );

    const strokeIds = [...new Set(rows.map((row) => String(row.stroke_master_id ?? "")).filter(Boolean))];
    const createdByIds = [...new Set(rows.map((row) => String(row.created_by ?? "")).filter(Boolean))];
    const strokeNumberById = new Map<string, string>();

    if (strokeIds.length > 0) {
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
        strokeNumberById.set(String(stroke.id), String(stroke.stroke_number ?? ""));
      }
    }

    let createdByDisplayMap = new Map<string, string>();
    if (createdByIds.length > 0) {
      try {
        createdByDisplayMap = await resolveUserDisplayNames(createdByIds);
      } catch (error) {
        console.error("[process_order.listProcessOrders] created-by resolution failed:", JSON.stringify(error));
        throw new Error("PROD_PO_LIST_FAILED");
      }
    }

    return okResponse({
      data: rows.map((row) => ({
        ...row,
        material: materialMap.get(String(row.material_id ?? "")) ?? null,
        stroke_number: strokeNumberById.get(String(row.stroke_master_id ?? "")) || null,
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
      .select(`
        *,
        stroke:stroke_master!stroke_master_id(id, stroke_number, description, status),
        machine:machine_master!machine_id(id, machine_code, machine_name)
      `)
      .eq("id", id)
      .maybeSingle();

    if (error) {
      console.error("[process_order.getProcessOrder] query failed:", JSON.stringify(error));
      throw new Error("PROD_PO_FETCH_FAILED");
    }
    if (!po) return poErr(req, ctx, "PROD_PO_NOT_FOUND", 404, "Process order not found");

    const poRow = po as JsonRecord;
    const materialMap = await getMaterialMapByIds(
      [String(poRow.material_id ?? "")],
      "[process_order.getProcessOrder]",
      "PROD_PO_FETCH_FAILED",
      "id, pace_code, material_name, shade_code, base_uom_code",
    );
    const lines = await fetchOrderLines(id, toTrimmedString(poRow.stroke_master_id) || null);
    const { data: packOrders, error: packErr } = await serviceRoleClient
      .schema("erp_production")
      .from("packing_order")
      .select("id, po_number, status, planned_qty_kg, actual_qty_kg, plan_feed_id")
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
        lines,
        packing_orders: packOrders ?? [],
      },
    }, ctx.request_id, req);
  } catch (err) {
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
    const notes = toTrimmedString(body.notes);

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
        .select("material_id, dosage_pct")
        .eq("stroke_master_id", strokeId);
      if (strokeLinesErr) {
        console.error("[process_order.createProcessOrder] stroke-line query failed:", JSON.stringify(strokeLinesErr));
        throw new Error("PROD_PO_CREATE_FAILED");
      }

      if ((strokeLines ?? []).length > 0) {
        const needed = new Map<string, number>();
        for (const strokeLine of (strokeLines ?? []) as JsonRecord[]) {
          const mid = String(strokeLine.material_id);
          const qty = (Number(strokeLine.dosage_pct ?? 0) / 100) * plannedQty;
          needed.set(mid, (needed.get(mid) ?? 0) + qty);
        }

        const short = await checkStockAvailability(companyId, needed);
        if (short.length > 0) {
          const detail = short
            .map((row) => `${row.material_id.slice(0, 8)} (need ${row.needed.toFixed(3)}, have ${row.available.toFixed(3)})`)
            .join("; ");
          return poErr(req, ctx, "PROD_PO_INSUFFICIENT_STOCK", 422, `Insufficient UNRESTRICTED stock for ${short.length} material(s): ${detail}`);
        }
      }
    }

    const poNumber = await generateCompanyDocNumber(companyId, "PROC_PO");
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
        .select("material_id, dosage_pct, display_order")
        .eq("stroke_master_id", strokeId)
        .order("display_order");
      if (strokeLineErr) {
        console.error("[process_order.createProcessOrder] stroke-line prepopulate query failed:", JSON.stringify(strokeLineErr));
        throw new Error("PROD_PO_LINE_PREPOPULATE_FAILED");
      }

      if ((strokeLines ?? []).length > 0) {
        const lineRows = ((strokeLines ?? []) as JsonRecord[]).map((strokeLine) => ({
          process_order_id: poId,
          material_id: strokeLine.material_id,
          planned_qty: Number(((Number(strokeLine.dosage_pct ?? 0) / 100) * plannedQty).toFixed(4)),
          actual_qty: null,
          uom_code: "KG",
          issue_sloc_id: null,
          is_rm: true,
          display_order: strokeLine.display_order,
          dosage_pct: strokeLine.dosage_pct,
          is_formulation_line: true,
        }));
        const { data: createdLines, error: lineErr } = await serviceRoleClient
          .schema("erp_production")
          .from("process_order_line")
          .insert(lineRows)
          .select("id, material_id, planned_qty, issue_sloc_id, is_rm, uom_code");
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
        issue_sloc_id: toTrimmedString(line.issue_sloc_id) || null,
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
      const segConfig = await getSegmentLocConfig(companyId, segmentCode);
      if (!segConfig) {
        return poErr(req, ctx, "PROD_PO_SEG_LOC_MISSING", 422, `Segment location config not found for ${segmentCode}. Configure it first.`);
      }
      const shopfloorSlocId = toTrimmedString(segConfig.shopfloor_sloc_id) || null;
      if (!shopfloorSlocId) {
        return poErr(req, ctx, "PROD_PO_SHOPFLOOR_SLOC_MISSING", 422, "Shopfloor storage location not configured for this segment");
      }

      const batchNumber = await generateBatchNumber(companyId, "MTEST", null);
      const lines = await fetchOrderLines(poId, null);
      const postedBy = ctx.auth_user_id;
      const today = todayIso();
      const ledgerEntries: JsonRecord[] = [];

      for (const line of lines) {
        const issueQty = Number(line.planned_qty ?? 0);
        if (issueQty <= 0) continue;
        const slocId = getIssueStorageLocationId(line, segConfig);
        if (!slocId) {
          return poErr(req, ctx, "PROD_PO_SLOC_MISSING", 422, `Storage location missing for ${line.material_id}`);
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
        storageLocationId: shopfloorSlocId,
        materialId,
        quantity: plannedQty,
        baseUomCode: fgUom,
        unitValue: 0,
        stockTypeCode: "UNRESTRICTED",
        direction: "IN",
        postedBy,
      });

      const verifiedAt = new Date().toISOString();
      const { error: poUpdateErr } = await serviceRoleClient
        .schema("erp_production")
        .from("process_order")
        .update({
          status: "VERIFIED",
          batch_number: batchNumber,
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
        batch_number: batchNumber,
        ledger_entries: [...ledgerEntries, { movement: "P101", direction: "IN", ...fgPosting }],
      }, ctx.request_id, req);
    }

    if (insertedLines.length > 0) {
      const segConfig = await getSegmentLocConfig(companyId, segmentCode);
      const reservationRows = insertedLines.map((line) => ({
        source_type: "PROCESS_PO",
        source_id: poId,
        source_line_id: line.id,
        company_id: companyId,
        material_id: line.material_id,
        storage_location_id: line.issue_sloc_id
          ?? ((line.is_rm ? segConfig?.rm_sloc_id : segConfig?.pm_sloc_id) ?? null),
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

    const prodshadeId = batchType === "MTS" ? String(po.material_id ?? "") : null;
    const batchNumber = await generateBatchNumber(String(po.company_id), batchType, prodshadeId);
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
    if (!["QA_APPROVED", "BATCH_STARTED"].includes(String(po.status))) {
      return poErr(req, ctx, "PROD_PO_EDIT_STATUS_INVALID", 422, "Edit allowed only at QA_APPROVED or BATCH_STARTED");
    }

    const body = await parseBody(req);
    const machineId = Object.prototype.hasOwnProperty.call(body, "machine_id")
      ? (toTrimmedString(body.machine_id) || null)
      : undefined;
    const lines = Array.isArray(body.lines) ? (body.lines as JsonRecord[]) : [];
    const now = new Date().toISOString();

    if (machineId !== undefined && machineId) {
      const machine = await fetchMachine(String(po.company_id), machineId);
      if (!machine || machine.active !== true) {
        return poErr(req, ctx, "PROD_PO_MACHINE_INVALID", 422, "machine_id must belong to the company and be active");
      }
    }

    if (machineId !== undefined) {
      const { error: machineErr } = await serviceRoleClient
        .schema("erp_production")
        .from("process_order")
        .update({
          machine_id: machineId,
          last_updated_at: now,
          last_updated_by: ctx.auth_user_id,
        })
        .eq("id", id);
      if (machineErr) {
        console.error("[process_order.editProcessOrder] machine update failed:", JSON.stringify(machineErr));
        throw new Error("PROD_PO_LINE_UPDATE_FAILED");
      }
    }

    await Promise.all(lines.map(async (line) => {
      const lineId = toTrimmedString(line.id);
      const plannedQty = parsePositiveNumber(line.planned_qty);
      if (!lineId || plannedQty === null) return;

      const [{ error: lineErr }, { error: reservationErr }] = await Promise.all([
        serviceRoleClient
          .schema("erp_production")
          .from("process_order_line")
          .update({ planned_qty: plannedQty })
          .eq("id", lineId)
          .eq("process_order_id", id),
        serviceRoleClient
          .schema("erp_production")
          .from("reservation_document")
          .update({
            required_qty: plannedQty,
            last_updated_at: now,
            last_updated_by: ctx.auth_user_id,
          })
          .eq("source_line_id", lineId),
      ]);

      if (lineErr) {
        console.error("[process_order.editProcessOrder] line update failed:", JSON.stringify(lineErr));
        throw new Error("PROD_PO_LINE_UPDATE_FAILED");
      }
      if (reservationErr) {
        console.error("[process_order.editProcessOrder] reservation update failed:", JSON.stringify(reservationErr));
        throw new Error("PROD_PO_LINE_UPDATE_FAILED");
      }
    }));

    return okResponse({ id }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PO_LINE_UPDATE_FAILED";
    return poErr(req, ctx, code, 500, "Edit failed");
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

    const segConfig = await getSegmentLocConfig(String(po.company_id), String(po.segment_code));
    if (!segConfig) {
      return poErr(req, ctx, "PROD_PO_SEG_LOC_MISSING", 422, `Segment location config not found for ${po.segment_code}. Configure it first.`);
    }
    const shopfloorSlocId = toTrimmedString(segConfig.shopfloor_sloc_id) || null;
    if (!shopfloorSlocId) {
      return poErr(req, ctx, "PROD_PO_SHOPFLOOR_SLOC_MISSING", 422, "Shopfloor storage location not configured for this segment");
    }

    const today = todayIso();
    const docNumber = String(po.po_number);
    const postedBy = ctx.auth_user_id;
    const reservationMap = await fetchReservationRowsBySourceLineIds(lines.map((line) => String(line.id)));
    const ledgerEntries: JsonRecord[] = [];

    for (const line of lines) {
      const actualQty = lineOverrideMap.has(String(line.id))
        ? Number(lineOverrideMap.get(String(line.id)) ?? 0)
        : Number(line.planned_qty ?? 0);
      const slocId = getIssueStorageLocationId(line, segConfig);
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
        unitValue: 0,
        stockTypeCode: "UNRESTRICTED",
        direction: "OUT",
        postedBy,
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
      unitValue: 0,
      stockTypeCode: "UNRESTRICTED",
      direction: "IN",
      postedBy,
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
    const intNeeded = new Map<string, number>();
    for (const line of allLines) {
      const material = line.material as JsonRecord | null;
      if (material?.production_mode === "INT") {
        const materialId = String(line.material_id);
        const qty = Number(line.actual_qty ?? line.planned_qty ?? 0);
        intNeeded.set(materialId, (intNeeded.get(materialId) ?? 0) + qty);
      }
    }

    if (intNeeded.size > 0) {
      const { data: verifiedIntPOs, error: intErr } = await serviceRoleClient
        .schema("erp_production")
        .from("process_order")
        .select("material_id, actual_qty")
        .eq("company_id", String(po.company_id))
        .eq("po_type", "INT")
        .eq("status", "VERIFIED")
        .in("material_id", Array.from(intNeeded.keys()));
      if (intErr) {
        console.error("[process_order.finalize] verified-int query failed:", JSON.stringify(intErr));
        throw new Error("PROD_PO_FINALIZE_FAILED");
      }

      const verifiedQty = new Map<string, number>();
      for (const intPo of (verifiedIntPOs ?? []) as JsonRecord[]) {
        const materialId = String(intPo.material_id);
        verifiedQty.set(materialId, (verifiedQty.get(materialId) ?? 0) + Number(intPo.actual_qty ?? 0));
      }

      const unmet: string[] = [];
      for (const [materialId, neededQty] of intNeeded.entries()) {
        if ((verifiedQty.get(materialId) ?? 0) < neededQty - EPSILON) {
          unmet.push(materialId.slice(0, 8));
        }
      }

      if (unmet.length > 0) {
        return poErr(req, ctx, "PROD_PO_INT_NOT_VERIFIED", 422, `INT material(s) not yet VERIFIED: ${unmet.join(", ")}. Complete INT Process Orders first.`);
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
    const segConfig = await getSegmentLocConfig(String(po.company_id), String(po.segment_code));
    if (!segConfig) {
      return poErr(req, ctx, "PROD_PO_SEG_LOC_MISSING", 422, `Segment location config not found for ${po.segment_code}. Configure it first.`);
    }

    const shopfloorSlocId = toTrimmedString(segConfig.shopfloor_sloc_id) || null;
    if (!shopfloorSlocId) {
      return poErr(req, ctx, "PROD_PO_SHOPFLOOR_SLOC_MISSING", 422, "Shopfloor storage location not configured for this segment");
    }

    const today = todayIso();
    const docNumber = String(po.po_number);
    const postedBy = ctx.auth_user_id;
    const ledgerEntries: JsonRecord[] = [];
    const reservationMap = await fetchReservationRowsBySourceLineIds(lines.map((line) => String(line.id)));

    for (const line of lines) {
      const actualQty = Number(line.actual_qty ?? line.planned_qty ?? 0);
      if (actualQty <= 0) continue;

      const slocId = getIssueStorageLocationId(line, segConfig);
      if (!slocId) {
        return poErr(req, ctx, "PROD_PO_SLOC_MISSING", 422, `Storage location missing for ${String((line.material as JsonRecord | null)?.pace_code ?? line.material_id)}`);
      }

      const movementMaterialId = toTrimmedString(line.actual_material_id) || String(line.material_id);
      const movementMaterial = (toTrimmedString(line.actual_material_id)
        ? line.actual_material
        : line.material) as JsonRecord | null;
      const baseUom = String(movementMaterial?.base_uom_code ?? line.uom_code ?? "KG");

      // DEPENDENT: each P261 issue and its reservation issue update must stay in posting order.
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
        unitValue: 0,
        stockTypeCode: "UNRESTRICTED",
        direction: "OUT",
        postedBy,
      });

      const { error: lineUpdateErr } = await serviceRoleClient
        .schema("erp_production")
        .from("process_order_line")
        .update({ stock_ledger_id: posting.stock_ledger_id })
        .eq("id", line.id as string);
      if (lineUpdateErr) {
        console.error("[process_order.verify] line stock-ledger update failed:", JSON.stringify(lineUpdateErr));
        throw new Error("PROD_PO_VERIFY_FAILED");
      }

      const reservation = reservationMap.get(String(line.id));
      if (reservation && RESERVATION_OPEN_STATUSES.includes(String(reservation.status ?? ""))) {
        const issuedQty = Number(reservation.issued_qty ?? 0) + actualQty;
        const requiredQty = Number(reservation.required_qty ?? 0);
        const reservationStatus = issuedQty >= requiredQty - EPSILON ? "FULLY_ISSUED" : "PARTIAL";
        const { error: reservationErr } = await serviceRoleClient
          .schema("erp_production")
          .from("reservation_document")
          .update({
            issued_qty: issuedQty,
            status: reservationStatus,
            last_updated_at: new Date().toISOString(),
            last_updated_by: ctx.auth_user_id,
          })
          .eq("id", reservation.id as string);
        if (reservationErr) {
          console.error("[process_order.verify] reservation issue update failed:", JSON.stringify(reservationErr));
          throw new Error("PROD_PO_VERIFY_FAILED");
        }
      }

      ledgerEntries.push({ line_id: line.id, movement: "P261", direction: "OUT", ...posting });
    }

    const fgUom = await fetchProductionMaterialBaseUom(String(po.material_id));
    const fgPosting = await postStockMovement({
      documentNumber: docNumber,
      documentDate: today,
      postingDate: today,
      movementTypeCode: "P101",
      companyId: po.company_id,
      storageLocationId: shopfloorSlocId,
      materialId: po.material_id,
      quantity: verifiedQty,
      baseUomCode: fgUom,
      unitValue: 0,
      stockTypeCode: "QUALITY_INSPECTION",
      direction: "IN",
      postedBy,
    });
    ledgerEntries.push({ movement: "P101", direction: "IN", ...fgPosting });

    const qiReleasePosting = await postStockMovement({
      documentNumber: docNumber,
      documentDate: today,
      postingDate: today,
      movementTypeCode: "P321",
      companyId: po.company_id,
      storageLocationId: shopfloorSlocId,
      materialId: po.material_id,
      quantity: verifiedQty,
      baseUomCode: fgUom,
      unitValue: 0,
      stockTypeCode: "UNRESTRICTED",
      direction: "IN",
      postedBy,
    });
    ledgerEntries.push({ movement: "P321", direction: "IN", ...qiReleasePosting });

    const strokeNumber = toTrimmedString((po.stroke as JsonRecord | null)?.stroke_number) || null;
    const recoRows = lines.map((line) => ({
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
      line_material_type: (line.material as JsonRecord | null)?.production_mode === "INT" ? "INT" : "RM",
      dosage_pct: line.dosage_pct ?? null,
      actual_material_id: line.actual_material_id ?? null,
      storage_location_id: line.issue_sloc_id ?? (line.is_rm ? segConfig.rm_sloc_id : segConfig.pm_sloc_id) ?? null,
      standard_qty: line.planned_qty ?? null,
      actual_qty: Number(line.actual_qty ?? line.planned_qty ?? 0),
      approved_status: line.approved_status ?? "YES",
      ap_approved_qty: Number(line.ap_approved_qty ?? line.actual_qty ?? line.planned_qty ?? 0),
      variance_qty: Number(line.variance_qty ?? 0),
      is_formulation_line: line.is_formulation_line !== false,
      is_voided: false,
      last_updated_at: new Date().toISOString(),
      last_updated_by: ctx.auth_user_id,
    }));

    if (recoRows.length > 0) {
      const { error: recoErr } = await serviceRoleClient
        .schema("erp_production")
        .from("process_order_line_reco")
        .insert(recoRows);
      if (recoErr) {
        console.error("[process_order.verify] reco insert failed:", JSON.stringify(recoErr));
        throw new Error("PROD_PO_VERIFY_FAILED");
      }
    }

    const now = new Date().toISOString();
    const { error: poUpdateErr } = await serviceRoleClient
      .schema("erp_production")
      .from("process_order")
      .update({
        status: "VERIFIED",
        actual_qty: verifiedQty,
        fg_stock_ledger_id: fgPosting.stock_ledger_id,
        qi_release_stock_ledger_id: qiReleasePosting.stock_ledger_id,
        verified_at: now,
        verified_by: ctx.auth_user_id,
        has_unapproved_deviation: applyResult.hasUnapprovedDeviation ?? false,
        last_updated_at: now,
        last_updated_by: ctx.auth_user_id,
      })
      .eq("id", id);
    if (poUpdateErr) {
      console.error("[process_order.verify] process-order update failed:", JSON.stringify(poUpdateErr));
      throw new Error("PROD_PO_VERIFY_FAILED");
    }

    return okResponse({
      id,
      status: "VERIFIED",
      batch_number: po.batch_number,
      verified_qty: verifiedQty,
      ledger_entries: ledgerEntries,
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

    if (po.status === "VERIFIED") {
      const lines = await fetchOrderLines(id, toTrimmedString(po.stroke_master_id) || null);
      const today = todayIso();
      const revDocNum = `${po.po_number}-REV`;
      const segConfig = await getSegmentLocConfig(String(po.company_id), String(po.segment_code));
      if (!segConfig) {
        return poErr(req, ctx, "PROD_PO_SEG_LOC_MISSING", 422, `Segment location config not found for ${po.segment_code}. Configure it first.`);
      }

      // DEPENDENT: each P262 reversal must follow the original issue lines one by one.
      for (const line of lines) {
        const actualQty = Number(line.actual_qty ?? 0);
        if (actualQty <= 0) continue;
        const slocId = getIssueStorageLocationId(line, segConfig);
        if (!slocId) continue;

        const movementMaterialId = toTrimmedString(line.actual_material_id) || String(line.material_id);
        const movementMaterial = (toTrimmedString(line.actual_material_id)
          ? line.actual_material
          : line.material) as JsonRecord | null;
        const baseUom = String(movementMaterial?.base_uom_code ?? "KG");

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
          unitValue: 0,
          stockTypeCode: "UNRESTRICTED",
          direction: "IN",
          postedBy: ctx.auth_user_id,
          reversalOfId: toTrimmedString(line.stock_ledger_id) || null,
        });
        ledgerEntries.push({ line_id: line.id, movement: "P262", direction: "IN", ...posting });
      }

      const shopfloorSlocId = toTrimmedString(segConfig.shopfloor_sloc_id) || null;
      const fgUom = await fetchProductionMaterialBaseUom(String(po.material_id));

      if (po.qi_release_stock_ledger_id && shopfloorSlocId) {
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
          unitValue: 0,
          stockTypeCode: "UNRESTRICTED",
          direction: "OUT",
          postedBy: ctx.auth_user_id,
          reversalOfId: String(po.qi_release_stock_ledger_id),
        });
        ledgerEntries.push({ movement: "P322", direction: "OUT", ...p322Posting });
      }

      if (po.fg_stock_ledger_id && shopfloorSlocId) {
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
          unitValue: 0,
          stockTypeCode: po.qi_release_stock_ledger_id ? "QUALITY_INSPECTION" : "UNRESTRICTED",
          direction: "OUT",
          postedBy: ctx.auth_user_id,
          reversalOfId: String(po.fg_stock_ledger_id),
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

    return okResponse({ id, status: "REVERSED", ledger_entries: ledgerEntries }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PO_REVERSE_FAILED";
    return poErr(req, ctx, code, 500, `Reverse failed: ${err instanceof Error ? err.message : ""}`);
  }
}
