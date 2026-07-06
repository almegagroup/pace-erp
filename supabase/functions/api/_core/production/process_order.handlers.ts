/*
 * File-ID: 27.6
 * File-Path: supabase/functions/api/_core/production/process_order.handlers.ts
 * Gate: 27
 * Phase: 27
 * Domain: PRODUCTION
 * Purpose: Process Order full lifecycle — STANDARD → QA_APPROVED → BATCH_STARTED → FINAL → VERIFIED.
 *          Stock movements (P261 RM/PM out + P101 FG in) fire at VERIFIED.
 * Authority: Backend
 * DB column names: material_id, planned_qty, actual_qty, qa_decided_by/at, issue_sloc_id
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
import { generateBatchNumber } from "./batch_series.handlers.ts";
import { generateCompanyDocNumber } from "./production.utils.ts";

type JsonRecord = Record<string, unknown>;

const VALID_PO_TYPES = new Set(["MTO","HPS","MTS","INT","MTEST"]);
const VALID_SEGMENTS = new Set(["ADMIX","HPS","IWC","POWDER","INT"]);

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function poErr(req: Request, ctx: ProdHandlerContext, code: string, status: number, msg: string): Response {
  return errorResponse(code, msg, ctx.request_id, "NONE", status, {}, req);
}

async function fetchProcessOrder(id: string): Promise<JsonRecord | null> {
  const { data, error } = await serviceRoleClient
    .schema("erp_production").from("process_order")
    .select("*").eq("id", id).maybeSingle();
  if (error) throw new Error("PROD_PO_FETCH_FAILED");
  return (data as JsonRecord | null) ?? null;
}

async function fetchOrderLines(orderId: string): Promise<JsonRecord[]> {
  const { data } = await serviceRoleClient
    .schema("erp_production").from("process_order_line")
    .select(`
      id, material_id, planned_qty, actual_qty, uom_code,
      issue_sloc_id, is_rm, display_order, stock_ledger_id,
      material:erp_master.material_master!material_id(id, pace_code, material_name, base_uom_code, production_mode)
    `)
    .eq("process_order_id", orderId)
    .order("display_order");
  return (data ?? []) as JsonRecord[];
}

// Returns UNRESTRICTED balance per material in a company.
// For INT materials, also adds planned output from active INT POs (not yet VERIFIED).
async function checkStockAvailability(
  companyId: string,
  needed: Map<string, number>,
): Promise<{ material_id: string; needed: number; available: number }[]> {
  const matIds = Array.from(needed.keys());
  if (matIds.length === 0) return [];

  const { data: ledgerRows } = await serviceRoleClient
    .schema("erp_inventory").from("stock_ledger")
    .select("material_id, direction, quantity")
    .eq("company_id", companyId)
    .eq("stock_type_code", "UNRESTRICTED")
    .in("material_id", matIds);

  const available = new Map<string, number>();
  for (const row of (ledgerRows ?? []) as JsonRecord[]) {
    const mid = row.material_id as string;
    const qty = Number(row.quantity ?? 0);
    available.set(mid, (available.get(mid) ?? 0) + ((row.direction as string) === "IN" ? qty : -qty));
  }

  // Find INT materials and credit their planned output from active (not-yet-VERIFIED) INT POs
  const { data: matRows } = await serviceRoleClient
    .schema("erp_master").from("material_master")
    .select("id, production_mode")
    .in("id", matIds);

  const intMats = new Set(
    ((matRows ?? []) as JsonRecord[])
      .filter(m => m.production_mode === "INT")
      .map(m => m.id as string),
  );

  if (intMats.size > 0) {
    const { data: intPOs } = await serviceRoleClient
      .schema("erp_production").from("process_order")
      .select("material_id, planned_qty, actual_qty")
      .eq("company_id", companyId)
      .eq("po_type", "INT")
      .in("status", ["STANDARD", "QA_APPROVED", "BATCH_STARTED", "FINAL"])
      .in("material_id", Array.from(intMats));

    for (const ip of (intPOs ?? []) as JsonRecord[]) {
      const mid = ip.material_id as string;
      const qty = Number(ip.actual_qty ?? ip.planned_qty ?? 0);
      available.set(mid, (available.get(mid) ?? 0) + qty);
    }
  }

  const short: { material_id: string; needed: number; available: number }[] = [];
  for (const [mid, neededQty] of needed.entries()) {
    const avail = available.get(mid) ?? 0;
    if (avail < neededQty - 0.0001) {
      short.push({ material_id: mid, needed: neededQty, available: Math.max(0, avail) });
    }
  }
  return short;
}

async function getSegmentLocConfig(companyId: string, segmentCode: string): Promise<JsonRecord | null> {
  const { data } = await serviceRoleClient
    .schema("erp_production").from("production_segment_location_config")
    .select("rm_sloc_id, pm_sloc_id, shopfloor_sloc_id, fg_sloc_id")
    .eq("company_id", companyId)
    .eq("segment_code", segmentCode)
    .maybeSingle();
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
}): Promise<{ stock_document_id: string; stock_ledger_id: string }> {
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
    throw new Error(`PROD_STOCK_POST_FAILED: ${params.movementTypeCode} ${params.direction}`);
  }
  return data[0] as { stock_document_id: string; stock_ledger_id: string };
}

// GET /api/production/process-orders?company_id=&status=&po_type=&page=&per_page=
export async function listProcessOrdersHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const url = new URL(req.url);
    const companyId = toTrimmedString(url.searchParams.get("company_id") ?? "");
    const status = toUpperTrimmedString(url.searchParams.get("status") ?? "");
    const poType = toUpperTrimmedString(url.searchParams.get("po_type") ?? "");
    const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
    const perPage = Math.min(100, Math.max(10, parseInt(url.searchParams.get("per_page") ?? "20", 10)));

    let query = serviceRoleClient
      .schema("erp_production").from("process_order")
      .select(`
        id, company_id, po_number, po_type, segment_code,
        material_id, stroke_master_id, batch_number,
        planned_qty, actual_qty, status,
        qa_decided_by, qa_decided_at,
        batch_started_at, finalized_at, verified_at, created_by, created_at,
        material:erp_master.material_master!material_id(id, pace_code, material_name, shade_code)
      `, { count: "exact" })
      .order("created_at", { ascending: false })
      .range((page - 1) * perPage, page * perPage - 1);

    if (companyId) query = query.eq("company_id", companyId);
    if (status) query = query.eq("status", status);
    if (poType) query = query.eq("po_type", poType);

    const { data, error, count } = await query;
    if (error) throw new Error("PROD_PO_LIST_FAILED");

    return okResponse({
      data: data ?? [],
      pagination: { page, per_page: perPage, total: count ?? 0, total_pages: Math.ceil((count ?? 0) / perPage) },
    }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PO_LIST_FAILED";
    return poErr(req, ctx, code, 500, "Process order list failed");
  }
}

// GET /api/production/process-orders/:id
export async function getProcessOrderHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const id = getIdFromPath(req);
    if (!id) return poErr(req, ctx, "PROD_PO_ID_MISSING", 400, "Process order ID required");

    const { data: po, error } = await serviceRoleClient
      .schema("erp_production").from("process_order")
      .select(`
        *, material:erp_master.material_master!material_id(id, pace_code, material_name, shade_code),
        stroke:stroke_master!stroke_master_id(id, stroke_number, description, status)
      `)
      .eq("id", id).maybeSingle();

    if (error) throw new Error("PROD_PO_FETCH_FAILED");
    if (!po) return poErr(req, ctx, "PROD_PO_NOT_FOUND", 404, "Process order not found");

    const lines = await fetchOrderLines(id);
    const { data: packOrders } = await serviceRoleClient
      .schema("erp_production").from("packing_order")
      .select("id, po_number, status, planned_qty_kg, actual_qty_kg, plan_feed_id")
      .eq("process_order_id", id)
      .neq("status", "REVERSED");

    return okResponse({ data: { ...(po as JsonRecord), lines, packing_orders: packOrders ?? [] } }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PO_FETCH_FAILED";
    return poErr(req, ctx, code, 500, "Process order fetch failed");
  }
}

// POST /api/production/process-orders
export async function createProcessOrderHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const body = await parseBody(req);

    const companyId = toTrimmedString(body.company_id);
    const poType = toUpperTrimmedString(body.po_type);
    const segmentCode = toUpperTrimmedString(body.segment_code);
    // Accept both naming conventions from client
    const materialId = toTrimmedString(body.material_id || body.prodshade_material_id);
    const strokeId = toTrimmedString(body.stroke_master_id) || null;
    const plannedQty = parsePositiveNumber(body.planned_qty ?? body.planned_qty_kg);
    const notes = toTrimmedString(body.notes);

    if (!companyId || !VALID_PO_TYPES.has(poType) || !VALID_SEGMENTS.has(segmentCode) || !materialId || !plannedQty) {
      return poErr(req, ctx, "PROD_PO_INVALID", 400,
        "company_id, po_type, segment_code, material_id (prodshade), planned_qty required");
    }

    if (poType !== "MTEST" && !strokeId) {
      return poErr(req, ctx, "PROD_PO_STROKE_REQUIRED", 400, "stroke_master_id required for non-MTEST orders");
    }

    if (strokeId) {
      const { data: stroke } = await serviceRoleClient
        .schema("erp_production").from("stroke_master")
        .select("status").eq("id", strokeId).maybeSingle();
      if (!stroke || (stroke as JsonRecord).status !== "APPROVED") {
        return poErr(req, ctx, "PROD_PO_STROKE_NOT_APPROVED", 422, "Stroke master must be APPROVED");
      }
    }

    // Availability check — UNRESTRICTED stock per material (INT exception: credit active INT PO planned output)
    if (strokeId && poType !== "MTEST") {
      const { data: strokeLines } = await serviceRoleClient
        .schema("erp_production").from("stroke_line")
        .select("material_id, dosage_pct")
        .eq("stroke_master_id", strokeId);

      if (strokeLines && strokeLines.length > 0) {
        const needed = new Map<string, number>();
        for (const sl of strokeLines as JsonRecord[]) {
          const mid = sl.material_id as string;
          const qty = (Number(sl.dosage_pct) / 100) * plannedQty;
          needed.set(mid, (needed.get(mid) ?? 0) + qty);
        }

        const short = await checkStockAvailability(companyId, needed);
        if (short.length > 0) {
          const detail = short
            .map(s => `${s.material_id.slice(0, 8)} (need ${s.needed.toFixed(3)}, have ${s.available.toFixed(3)})`)
            .join("; ");
          return poErr(req, ctx, "PROD_PO_INSUFFICIENT_STOCK", 422,
            `Insufficient UNRESTRICTED stock for ${short.length} material(s): ${detail}`);
        }
      }
    }

    const poNumber = await generateCompanyDocNumber(companyId, "PROC_PO");
    const now = new Date().toISOString();

    const { data: po, error: poInsErr } = await serviceRoleClient
      .schema("erp_production").from("process_order")
      .insert({
        company_id: companyId,
        po_number: poNumber,
        po_type: poType,
        segment_code: segmentCode,
        material_id: materialId,
        stroke_master_id: strokeId,
        planned_qty: plannedQty,
        notes: notes || null,
        status: "STANDARD",
        created_by: ctx.auth_user_id,
        created_at: now,
        last_updated_at: now,
        last_updated_by: ctx.auth_user_id,
      })
      .select("id").single();

    if (poInsErr) throw new Error("PROD_PO_CREATE_FAILED");
    const poId = (po as JsonRecord).id as string;

    // Pre-populate lines from stroke dosage BOM
    if (strokeId && poType !== "MTEST") {
      const { data: strokeLines } = await serviceRoleClient
        .schema("erp_production").from("stroke_line")
        .select("material_id, dosage_pct, display_order")
        .eq("stroke_master_id", strokeId)
        .order("display_order");

      if (strokeLines && strokeLines.length > 0) {
        const lineRows = (strokeLines as JsonRecord[]).map((sl) => ({
          process_order_id: poId,
          material_id: sl.material_id,
          planned_qty: Number(((sl.dosage_pct as number) / 100 * plannedQty).toFixed(4)),
          actual_qty: null,
          uom_code: "KG",
          issue_sloc_id: null,
          is_rm: true,
          display_order: sl.display_order,
        }));
        const { error: lineErr } = await serviceRoleClient
          .schema("erp_production").from("process_order_line").insert(lineRows);
        if (lineErr) throw new Error("PROD_PO_LINE_PREPOPULATE_FAILED");
      }
    }

    // Manual lines (for MTEST or overrides)
    const manualLines = Array.isArray(body.lines) ? body.lines : [];
    if (manualLines.length > 0) {
      const manualRows = (manualLines as JsonRecord[]).map((l, idx) => ({
        process_order_id: poId,
        material_id: toTrimmedString(l.material_id),
        planned_qty: parsePositiveNumber(l.planned_qty) ?? 0,
        actual_qty: null,
        uom_code: toTrimmedString(l.uom_code) || "KG",
        issue_sloc_id: toTrimmedString(l.issue_sloc_id) || null,
        is_rm: l.is_rm !== false,
        display_order: 1000 + idx,
      }));
      await serviceRoleClient.schema("erp_production").from("process_order_line").insert(manualRows);
    }

    return okResponse({ id: poId, po_number: poNumber }, ctx.request_id, req, 201);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PO_CREATE_FAILED";
    return poErr(req, ctx, code, 500, `Process order create failed: ${err instanceof Error ? err.message : ""}`);
  }
}

// PATCH /api/production/process-orders/:id/lines
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

    await serviceRoleClient.schema("erp_production").from("process_order_line")
      .delete().eq("process_order_id", id);

    if (lines.length > 0) {
      const lineRows = (lines as JsonRecord[]).map((l, idx) => ({
        process_order_id: id,
        material_id: toTrimmedString(l.material_id),
        planned_qty: parsePositiveNumber(l.planned_qty) ?? 0,
        actual_qty: null,
        uom_code: toTrimmedString(l.uom_code) || "KG",
        issue_sloc_id: toTrimmedString(l.issue_sloc_id) || null,
        is_rm: l.is_rm !== false,
        display_order: idx,
      }));
      const { error } = await serviceRoleClient.schema("erp_production").from("process_order_line").insert(lineRows);
      if (error) throw new Error("PROD_PO_LINE_UPDATE_FAILED");
    }

    if (body.planned_qty || body.planned_qty_kg) {
      const newQty = parsePositiveNumber(body.planned_qty ?? body.planned_qty_kg);
      if (newQty) {
        await serviceRoleClient.schema("erp_production").from("process_order")
          .update({ planned_qty: newQty, last_updated_at: new Date().toISOString(), last_updated_by: ctx.auth_user_id })
          .eq("id", id);
      }
    }

    return okResponse({ id }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PO_LINE_UPDATE_FAILED";
    return poErr(req, ctx, code, 500, "Lines update failed");
  }
}

// POST /api/production/process-orders/:id/qa-approve
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

    const lines = await fetchOrderLines(id);
    if (lines.length === 0 && po.po_type !== "MTEST") {
      return poErr(req, ctx, "PROD_PO_NO_LINES", 422, "Cannot approve without RM lines");
    }

    const now = new Date().toISOString();
    await serviceRoleClient.schema("erp_production").from("process_order")
      .update({ status: "QA_APPROVED", qa_decided_by: ctx.auth_user_id, qa_decided_at: now, last_updated_at: now, last_updated_by: ctx.auth_user_id })
      .eq("id", id);

    return okResponse({ id, status: "QA_APPROVED" }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PO_QA_APPROVE_FAILED";
    return poErr(req, ctx, code, 500, "QA approve failed");
  }
}

// POST /api/production/process-orders/:id/qa-reject
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
    const now = new Date().toISOString();

    await serviceRoleClient.schema("erp_production").from("process_order")
      .update({ status: "QA_REJECTED", qa_rejection_reason: reason || null, qa_decided_by: ctx.auth_user_id, qa_decided_at: now, last_updated_at: now, last_updated_by: ctx.auth_user_id })
      .eq("id", id);

    return okResponse({ id, status: "QA_REJECTED" }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PO_QA_REJECT_FAILED";
    return poErr(req, ctx, code, 500, "QA reject failed");
  }
}

// POST /api/production/process-orders/:id/start-batch
export async function startBatchHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const id = getIdFromPath(req);
    if (!id) return poErr(req, ctx, "PROD_PO_ID_MISSING", 400, "ID required");

    const po = await fetchProcessOrder(id);
    if (!po) return poErr(req, ctx, "PROD_PO_NOT_FOUND", 404, "Not found");
    if (po.status !== "QA_APPROVED") {
      return poErr(req, ctx, "PROD_PO_STATUS_INVALID", 422, "Must be QA_APPROVED to start batch");
    }

    const batchTypeMap: Record<string, string> = {
      "MTO": "MTO", "HPS": "HPS", "MTS": "IWC", "INT": "MTO", "MTEST": "MTEST",
    };
    const batchType = batchTypeMap[po.po_type as string] ?? "MTO";
    // Per-prodshade series for HPS and IWC
    const prodshadeId = (batchType === "HPS" || batchType === "IWC")
      ? (po.material_id as string | null)
      : null;

    const batchNumber = await generateBatchNumber(po.company_id as string, batchType, prodshadeId);
    const now = new Date().toISOString();

    await serviceRoleClient.schema("erp_production").from("process_order")
      .update({
        status: "BATCH_STARTED",
        batch_number: batchNumber,
        batch_started_at: now,
        batch_started_by: ctx.auth_user_id,
        last_updated_at: now,
        last_updated_by: ctx.auth_user_id,
      })
      .eq("id", id);

    return okResponse({ id, status: "BATCH_STARTED", batch_number: batchNumber }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PO_START_BATCH_FAILED";
    return poErr(req, ctx, code, 500, `Start batch failed: ${err instanceof Error ? err.message : ""}`);
  }
}

// POST /api/production/process-orders/:id/finalize
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

    const lineUpdates = Array.isArray(body.lines) ? body.lines : [];
    const now = new Date().toISOString();

    for (const lu of lineUpdates as JsonRecord[]) {
      const lineId = toTrimmedString(lu.id);
      const lineActualQty = parsePositiveNumber(lu.actual_qty) ?? 0;
      if (lineId) {
        await serviceRoleClient.schema("erp_production").from("process_order_line")
          .update({ actual_qty: lineActualQty }).eq("id", lineId).eq("process_order_id", id);
      } else if (lu.material_id) {
        await serviceRoleClient.schema("erp_production").from("process_order_line")
          .insert({
            process_order_id: id,
            material_id: toTrimmedString(lu.material_id),
            planned_qty: lineActualQty,
            actual_qty: lineActualQty,
            uom_code: toTrimmedString(lu.uom_code) || "KG",
            issue_sloc_id: toTrimmedString(lu.issue_sloc_id) || null,
            is_rm: lu.is_rm !== false,
            display_order: 9999,
          });
      }
    }

    // INT dependency check: any RM line whose material has production_mode = 'INT'
    // must have sufficient VERIFIED INT process order output in this company.
    const allLines = await fetchOrderLines(id);
    const intNeeded = new Map<string, number>();
    for (const line of allLines) {
      const mat = line.material as JsonRecord | null;
      if ((mat as JsonRecord | null)?.production_mode === "INT") {
        const mid = line.material_id as string;
        const qty = Number(line.actual_qty ?? line.planned_qty ?? 0);
        intNeeded.set(mid, (intNeeded.get(mid) ?? 0) + qty);
      }
    }

    if (intNeeded.size > 0) {
      const { data: verifiedIntPOs } = await serviceRoleClient
        .schema("erp_production").from("process_order")
        .select("material_id, actual_qty")
        .eq("company_id", po.company_id as string)
        .eq("po_type", "INT")
        .eq("status", "VERIFIED")
        .in("material_id", Array.from(intNeeded.keys()));

      const verifiedQty = new Map<string, number>();
      for (const ip of (verifiedIntPOs ?? []) as JsonRecord[]) {
        const mid = ip.material_id as string;
        verifiedQty.set(mid, (verifiedQty.get(mid) ?? 0) + Number(ip.actual_qty ?? 0));
      }

      const unmet: string[] = [];
      for (const [mid, needed] of intNeeded.entries()) {
        if ((verifiedQty.get(mid) ?? 0) < needed - 0.0001) unmet.push(mid.slice(0, 8));
      }

      if (unmet.length > 0) {
        return poErr(req, ctx, "PROD_PO_INT_NOT_VERIFIED", 422,
          `INT material(s) not yet VERIFIED: ${unmet.join(", ")}. Complete INT Process Orders first.`);
      }
    }

    await serviceRoleClient.schema("erp_production").from("process_order")
      .update({ status: "FINAL", actual_qty: actualQty, finalized_at: now, finalized_by: ctx.auth_user_id, last_updated_at: now, last_updated_by: ctx.auth_user_id })
      .eq("id", id);

    return okResponse({ id, status: "FINAL" }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PO_FINALIZE_FAILED";
    return poErr(req, ctx, code, 500, "Finalize failed");
  }
}

// POST /api/production/process-orders/:id/verify
// Stock movements fire here: P261 RM/PM issues + P101 FG receipt (SAP 101 = GR for both PO and Production Order).
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
    const verifiedQty = parsePositiveNumber(body.verified_qty ?? body.verified_qty_kg) ?? (po.actual_qty as number);

    // Apply QA adjustments to lines before stock posting
    const lineAdjustments = Array.isArray(body.lines) ? body.lines : [];
    for (const adj of lineAdjustments as JsonRecord[]) {
      const lineId = toTrimmedString(adj.id);
      const adjQty = parsePositiveNumber(adj.actual_qty);
      if (lineId && adjQty !== null) {
        await serviceRoleClient.schema("erp_production").from("process_order_line")
          .update({ actual_qty: adjQty }).eq("id", lineId).eq("process_order_id", id);
      }
    }

    const lines = await fetchOrderLines(id);
    const segConfig = await getSegmentLocConfig(po.company_id as string, po.segment_code as string);

    if (!segConfig) {
      return poErr(req, ctx, "PROD_PO_SEG_LOC_MISSING", 422,
        `Segment location config not found for ${po.segment_code}. Configure it first.`);
    }

    const today = todayIso();
    const docNumber = po.po_number as string;
    const postedBy = ctx.auth_user_id;
    const ledgerEntries: JsonRecord[] = [];

    // P261: Issue each RM/PM line from its storage location
    for (const line of lines) {
      const actualQty = Number(line.actual_qty ?? line.planned_qty ?? 0);
      if (actualQty <= 0) continue;

      const mat = line.material as JsonRecord | null;
      const baseUom = (mat?.base_uom_code ?? line.uom_code ?? "KG") as string;
      const slocId = (line.issue_sloc_id
        || (line.is_rm ? segConfig.rm_sloc_id : segConfig.pm_sloc_id)) as string | null;

      if (!slocId) {
        return poErr(req, ctx, "PROD_PO_SLOC_MISSING", 422,
          `Storage location missing for ${mat?.pace_code ?? line.material_id}. Set segment config or per-line override.`);
      }

      const posting = await postStockMovement({
        documentNumber: docNumber, documentDate: today, postingDate: today,
        movementTypeCode: "P261", companyId: po.company_id,
        storageLocationId: slocId, materialId: line.material_id,
        quantity: actualQty, baseUomCode: baseUom,
        unitValue: 0, stockTypeCode: "UNRESTRICTED", direction: "OUT",
        postedBy,
      });

      await serviceRoleClient.schema("erp_production").from("process_order_line")
        .update({ stock_ledger_id: posting.stock_ledger_id })
        .eq("id", line.id as string);

      ledgerEntries.push({ line_id: line.id, movement: "P261", direction: "OUT", ...posting });
    }

    // P101: FG receipt into shopfloor sloc (SAP 101 = GR for Production Order, same code as vendor GRN)
    const shopfloorSlocId = segConfig.shopfloor_sloc_id as string | null;
    if (!shopfloorSlocId) {
      return poErr(req, ctx, "PROD_PO_SHOPFLOOR_SLOC_MISSING", 422,
        "Shopfloor storage location not configured for this segment");
    }

    const { data: prodMat } = await serviceRoleClient
      .schema("erp_master").from("material_master")
      .select("base_uom_code").eq("id", po.material_id as string).maybeSingle();
    const fgUom = ((prodMat as JsonRecord | null)?.base_uom_code ?? "KG") as string;

    const fgPosting = await postStockMovement({
      documentNumber: docNumber, documentDate: today, postingDate: today,
      movementTypeCode: "P101", companyId: po.company_id,
      storageLocationId: shopfloorSlocId, materialId: po.material_id,
      quantity: verifiedQty, baseUomCode: fgUom,
      unitValue: 0, stockTypeCode: "UNRESTRICTED", direction: "IN",
      postedBy,
    });

    const now = new Date().toISOString();
    await serviceRoleClient.schema("erp_production").from("process_order")
      .update({
        status: "VERIFIED",
        actual_qty: verifiedQty,
        fg_stock_ledger_id: fgPosting.stock_ledger_id,
        verified_at: now,
        verified_by: ctx.auth_user_id,
        last_updated_at: now,
        last_updated_by: ctx.auth_user_id,
      })
      .eq("id", id);

    return okResponse({
      id, status: "VERIFIED",
      batch_number: po.batch_number,
      verified_qty: verifiedQty,
      ledger_entries: [...ledgerEntries, { movement: "P101", direction: "IN", ...fgPosting }],
    }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PO_VERIFY_FAILED";
    return poErr(req, ctx, code, 500, `Verify failed: ${err instanceof Error ? err.message : ""}`);
  }
}

// POST /api/production/process-orders/:id/reverse
export async function reverseProcessOrderHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const id = getIdFromPath(req);
    if (!id) return poErr(req, ctx, "PROD_PO_ID_MISSING", 400, "ID required");

    const po = await fetchProcessOrder(id);
    if (!po) return poErr(req, ctx, "PROD_PO_NOT_FOUND", 404, "Not found");
    if (po.status === "REVERSED") return poErr(req, ctx, "PROD_PO_ALREADY_REVERSED", 409, "Already reversed");

    // Cannot reverse if active packing orders exist
    const { count } = await serviceRoleClient.schema("erp_production").from("packing_order")
      .select("id", { count: "exact", head: true })
      .eq("process_order_id", id).neq("status", "REVERSED");
    if ((count ?? 0) > 0) {
      return poErr(req, ctx, "PROD_PO_HAS_PACKING_ORDERS", 422, "Reverse all Packing Orders first");
    }

    const now = new Date().toISOString();

    if (po.status === "VERIFIED") {
      const lines = await fetchOrderLines(id);
      const today = todayIso();
      const revDocNum = `${po.po_number}-REV`;
      const segConfig = await getSegmentLocConfig(po.company_id as string, po.segment_code as string);

      // P102: Reverse the FG receipt (P101 reversal)
      if (po.fg_stock_ledger_id && segConfig?.shopfloor_sloc_id) {
        const { data: prodMat } = await serviceRoleClient
          .schema("erp_master").from("material_master")
          .select("base_uom_code").eq("id", po.material_id as string).maybeSingle();
        const fgUom = ((prodMat as JsonRecord | null)?.base_uom_code ?? "KG") as string;

        await postStockMovement({
          documentNumber: revDocNum, documentDate: today, postingDate: today,
          movementTypeCode: "P102", companyId: po.company_id,
          storageLocationId: segConfig.shopfloor_sloc_id,
          materialId: po.material_id,
          quantity: po.actual_qty as number,
          baseUomCode: fgUom, unitValue: 0, stockTypeCode: "UNRESTRICTED", direction: "OUT",
          postedBy: ctx.auth_user_id, reversalOfId: po.fg_stock_ledger_id as string,
        });
      }

      // P262: Reverse each RM/PM issue
      for (const line of lines) {
        const actualQty = Number(line.actual_qty ?? 0);
        if (actualQty <= 0) continue;
        const mat = line.material as JsonRecord | null;
        const baseUom = (mat?.base_uom_code ?? "KG") as string;
        const slocId = (line.issue_sloc_id
          || (line.is_rm ? segConfig?.rm_sloc_id : segConfig?.pm_sloc_id)) as string | null;
        if (!slocId) continue;

        await postStockMovement({
          documentNumber: revDocNum, documentDate: today, postingDate: today,
          movementTypeCode: "P262", companyId: po.company_id,
          storageLocationId: slocId, materialId: line.material_id,
          quantity: actualQty, baseUomCode: baseUom, unitValue: 0, stockTypeCode: "UNRESTRICTED",
          direction: "IN", postedBy: ctx.auth_user_id,
          reversalOfId: (line.stock_ledger_id as string | null) ?? null,
        });
      }
    }

    await serviceRoleClient.schema("erp_production").from("process_order")
      .update({ status: "REVERSED", reversed_by: ctx.auth_user_id, reversed_at: now, last_updated_at: now, last_updated_by: ctx.auth_user_id })
      .eq("id", id);

    return okResponse({ id, status: "REVERSED" }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PO_REVERSE_FAILED";
    return poErr(req, ctx, code, 500, `Reverse failed: ${err instanceof Error ? err.message : ""}`);
  }
}
