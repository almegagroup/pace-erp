/*
 * File-ID: 27.7
 * File-Path: supabase/functions/api/_core/production/packing_order.handlers.ts
 * Gate: 27
 * Phase: 27
 * Domain: PRODUCTION
 * Purpose: Packing Order lifecycle — STANDARD → FINAL | REVERSED.
 *          PM consumption (P261) fires at FINAL.
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
  parsePositiveInt,
  getIdFromPath,
} from "./production.shared.ts";
import { generateGlobalDocNumber } from "./production.utils.ts";

type JsonRecord = Record<string, unknown>;

const VALID_PACK_PO_TYPES = new Set(["PMTO","PHPS","PMTS","PTEST"]);

function todayIso(): string { return new Date().toISOString().slice(0, 10); }

function packErr(req: Request, ctx: ProdHandlerContext, code: string, status: number, msg: string): Response {
  return errorResponse(code, msg, ctx.request_id, "NONE", status, {}, req);
}

function createdOkResponse(data: unknown, requestId: string, req?: Request): Response {
  const response = okResponse(data, requestId, req);
  return new Response(response.body, { status: 201, headers: response.headers });
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

async function postStockMovement(params: {
  documentNumber: string; documentDate: string; postingDate: string;
  movementTypeCode: string; companyId: unknown; storageLocationId: unknown;
  materialId: unknown; quantity: number; baseUomCode: string; unitValue: number;
  stockTypeCode: string; direction: "IN" | "OUT"; postedBy: string; reversalOfId?: string | null;
}): Promise<{ stock_document_id: string; stock_ledger_id: string }> {
  const { data, error } = await serviceRoleClient.schema("erp_inventory").rpc("post_stock_movement", {
    p_document_number: params.documentNumber, p_document_date: params.documentDate,
    p_posting_date: params.postingDate, p_movement_type_code: params.movementTypeCode,
    p_company_id: params.companyId, p_storage_location_id: params.storageLocationId,
    p_material_id: params.materialId, p_quantity: params.quantity,
    p_base_uom_code: params.baseUomCode, p_unit_value: params.unitValue,
    p_stock_type_code: params.stockTypeCode, p_direction: params.direction,
    p_posted_by: params.postedBy, p_reversal_of_id: params.reversalOfId ?? null,
  });
  if (error || !Array.isArray(data) || data.length === 0) {
    throw new Error(`PROD_PACK_STOCK_POST_FAILED: ${params.movementTypeCode}`);
  }
  return data[0] as { stock_document_id: string; stock_ledger_id: string };
}

// GET /api/production/packing-orders?company_id=&process_order_id=&status=&page=&per_page=
export async function listPackingOrdersHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const url = new URL(req.url);
    const companyId = toTrimmedString(url.searchParams.get("company_id") ?? "");
    const processOrderId = toTrimmedString(url.searchParams.get("process_order_id") ?? "");
    const planFeedId = toTrimmedString(url.searchParams.get("plan_feed_id") ?? "");
    const status = toUpperTrimmedString(url.searchParams.get("status") ?? "");
    const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
    const perPage = Math.min(100, Math.max(10, parseInt(url.searchParams.get("per_page") ?? "20", 10)));

    let query = serviceRoleClient
      .schema("erp_production").from("packing_order")
      .select(`
        id, company_id, po_number, po_type, process_order_id, material_id,
        pack_code_id, fill_qty_per_pack, num_packs, planned_qty_kg, actual_qty_kg,
        status, plan_feed_id, segment_code, created_by, created_at,
        finalized_at, last_updated_at,
        pack_code:pack_code_master!pack_code_id(id, pack_code, pack_name, pack_type),
        process_order:process_order!process_order_id(po_number, batch_number, status)
      `, { count: "exact" })
      .order("created_at", { ascending: false });

    if (companyId) query = query.eq("company_id", companyId);
    if (processOrderId) query = query.eq("process_order_id", processOrderId);
    if (planFeedId) query = query.eq("plan_feed_id", planFeedId);
    if (status) query = query.eq("status", status);

    const { data, error, count } = await ((query as typeof query & {
      range: (from: number, to: number) => typeof query;
    }).range((page - 1) * perPage, page * perPage - 1)) as {
      data: unknown;
      error: unknown;
      count?: number;
    };
    if (error) {
      console.error("[packing_order.listPackingOrders] query failed:", JSON.stringify(error));
      throw new Error("PROD_PACK_LIST_FAILED");
    }

    const rows = (data ?? []) as JsonRecord[];
    const materialMap = await getMaterialMapByIds(
      rows.map((row) => String(row.material_id ?? "")),
      "[packing_order.listPackingOrders]",
      "PROD_PACK_LIST_FAILED",
      "id, pace_code, material_name, shade_code",
    );

    return okResponse({
      data: rows.map((row) => ({
        ...row,
        material: materialMap.get(String(row.material_id ?? "")) ?? null,
      })),
      pagination: { page, per_page: perPage, total: count ?? 0, total_pages: Math.ceil((count ?? 0) / perPage) },
    }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PACK_LIST_FAILED";
    return packErr(req, ctx, code, 500, "Packing order list failed");
  }
}

// GET /api/production/packing-orders/:id
export async function getPackingOrderHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const id = getIdFromPath(req);
    if (!id) return packErr(req, ctx, "PROD_PACK_ID_MISSING", 400, "Packing order ID required");

    const { data: po, error } = await serviceRoleClient
      .schema("erp_production").from("packing_order")
      .select(`
        *,
        pack_code:pack_code_master!pack_code_id(id, pack_code, pack_name, pack_type, billing_uom),
        process_order:process_order!process_order_id(id, po_number, batch_number, status, segment_code)
      `)
      .eq("id", id).maybeSingle();

    if (error) {
      console.error("[packing_order.getPackingOrder] query failed:", JSON.stringify(error));
      throw new Error("PROD_PACK_FETCH_FAILED");
    }
    if (!po) return packErr(req, ctx, "PROD_PACK_NOT_FOUND", 404, "Packing order not found");

    const { data: lines, error: lineErr } = await serviceRoleClient
      .schema("erp_production").from("packing_order_line")
      .select(`
        id, line_type, material_id, batch_number, qty_per_pack, total_qty,
        actual_qty, issue_sloc_id, display_order
      `)
      .eq("packing_order_id", id)
      .order("line_type")
      .order("display_order");
    if (lineErr) {
      console.error("[packing_order.getPackingOrder] line query failed:", JSON.stringify(lineErr));
      throw new Error("PROD_PACK_FETCH_FAILED");
    }

    const poRow = po as JsonRecord;
    const lineRows = (lines ?? []) as JsonRecord[];
    const poMaterialMap = await getMaterialMapByIds(
      [String(poRow.material_id ?? "")],
      "[packing_order.getPackingOrder]",
      "PROD_PACK_FETCH_FAILED",
      "id, pace_code, material_name, shade_code",
    );
    const lineMaterialMap = await getMaterialMapByIds(
      lineRows.map((line) => String(line.material_id ?? "")),
      "[packing_order.getPackingOrder]",
      "PROD_PACK_FETCH_FAILED",
      "id, pace_code, material_name, base_uom_code",
    );

    return okResponse({
      data: {
        ...poRow,
        material: poMaterialMap.get(String(poRow.material_id ?? "")) ?? null,
        lines: lineRows.map((line) => ({
          ...line,
          material: lineMaterialMap.get(String(line.material_id ?? "")) ?? null,
        })),
      },
    }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PACK_FETCH_FAILED";
    return packErr(req, ctx, code, 500, "Packing order fetch failed");
  }
}

// POST /api/production/packing-orders
// Creates at STANDARD. Auto-adds SFG line from linked Process Order batch.
export async function createPackingOrderHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const body = await parseBody(req);

    const companyId = toTrimmedString(body.company_id);
    const poType = toUpperTrimmedString(body.po_type);
    const processOrderId = toTrimmedString(body.process_order_id);
    const materialId = toTrimmedString(body.material_id);
    const packCodeId = toTrimmedString(body.pack_code_id);
    const fillQtyPerPack = parsePositiveNumber(body.fill_qty_per_pack);
    const numPacks = parsePositiveInt(body.num_packs);
    const planFeedId = toTrimmedString(body.plan_feed_id) || null;

    if (!companyId || !VALID_PACK_PO_TYPES.has(poType) || !processOrderId || !materialId || !packCodeId) {
      return packErr(req, ctx, "PROD_PACK_INVALID", 400,
        "company_id, po_type, process_order_id, material_id, pack_code_id required");
    }

    // Verify process order exists and is BATCH_STARTED or later
    const { data: procOrder } = await serviceRoleClient
      .schema("erp_production").from("process_order")
      .select("id, status, batch_number, segment_code, material_id, company_id")
      .eq("id", processOrderId).maybeSingle();

    if (!procOrder) return packErr(req, ctx, "PROD_PACK_PROC_ORDER_NOT_FOUND", 404, "Process order not found");
    const procStatus = (procOrder as JsonRecord).status as string;
    if (!["BATCH_STARTED","FINAL","VERIFIED"].includes(procStatus)) {
      return packErr(req, ctx, "PROD_PACK_PROC_ORDER_NOT_READY", 422,
        "Process order must be BATCH_STARTED or later to create Packing Order");
    }

    // Calculate planned qty
    const plannedQtyKg = fillQtyPerPack && numPacks
      ? fillQtyPerPack * numPacks
      : parsePositiveNumber(body.planned_qty_kg) ?? null;

    const poNumber = await generateGlobalDocNumber("PACK_PO");
    const now = new Date().toISOString();

    const { data: packPo, error: insertErr } = await serviceRoleClient
      .schema("erp_production").from("packing_order")
      .insert({
        company_id: companyId,
        po_number: poNumber,
        po_type: poType,
        process_order_id: processOrderId,
        material_id: materialId,
        pack_code_id: packCodeId,
        fill_qty_per_pack: fillQtyPerPack,
        num_packs: numPacks,
        planned_qty_kg: plannedQtyKg,
        status: "STANDARD",
        plan_feed_id: planFeedId,
        segment_code: (procOrder as JsonRecord).segment_code,
        created_by: ctx.auth_user_id,
        created_at: now,
        last_updated_at: now,
        last_updated_by: ctx.auth_user_id,
      })
      .select("id").single();

    if (insertErr) throw new Error("PROD_PACK_CREATE_FAILED");
    const packPoId = (packPo as JsonRecord).id as string;

    // Auto-add SFG line (the batch from process order)
    const batchNumber = (procOrder as JsonRecord).batch_number as string | null;
    if (batchNumber && plannedQtyKg) {
      await serviceRoleClient.schema("erp_production").from("packing_order_line")
        .insert({
          packing_order_id: packPoId,
          line_type: "SFG",
          material_id: (procOrder as JsonRecord).material_id,
          batch_number: batchNumber,
          total_qty: plannedQtyKg,
          actual_qty: null,
          display_order: 0,
        });
    }

    // Add user-supplied PM lines
    const pmLines = Array.isArray(body.pm_lines) ? body.pm_lines : [];
    if (pmLines.length > 0) {
      const pmRows = (pmLines as JsonRecord[]).map((l, idx) => ({
        packing_order_id: packPoId,
        line_type: "PM",
        material_id: toTrimmedString(l.material_id),
        batch_number: null,
        qty_per_pack: parsePositiveNumber(l.qty_per_pack),
        total_qty: parsePositiveNumber(l.total_qty) ?? 0,
        actual_qty: null,
        issue_sloc_id: toTrimmedString(l.issue_sloc_id) || null,
        display_order: 10 + idx,
      }));
      await serviceRoleClient.schema("erp_production").from("packing_order_line").insert(pmRows);
    }

    return createdOkResponse({ id: packPoId, po_number: poNumber }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PACK_CREATE_FAILED";
    return packErr(req, ctx, code, 500, `Packing order create failed: ${err instanceof Error ? err.message : ""}`);
  }
}

// PATCH /api/production/packing-orders/:id/lines
// Update PM lines at STANDARD status.
export async function updatePackingOrderLinesHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const id = getIdFromPath(req);
    if (!id) return packErr(req, ctx, "PROD_PACK_ID_MISSING", 400, "ID required");

    const { data: po } = await serviceRoleClient.schema("erp_production").from("packing_order")
      .select("id, status").eq("id", id).maybeSingle();
    if (!po) return packErr(req, ctx, "PROD_PACK_NOT_FOUND", 404, "Not found");
    if ((po as JsonRecord).status !== "STANDARD") {
      return packErr(req, ctx, "PROD_PACK_STATUS_LOCKED", 422, "Lines editable only at STANDARD status");
    }

    const body = await parseBody(req);
    const pmLines = Array.isArray(body.pm_lines) ? body.pm_lines : [];

    // Remove existing PM lines, keep SFG lines
    await serviceRoleClient.schema("erp_production").from("packing_order_line")
      .delete().eq("packing_order_id", id).eq("line_type", "PM");

    if (pmLines.length > 0) {
      const pmRows = (pmLines as JsonRecord[]).map((l, idx) => ({
        packing_order_id: id,
        line_type: "PM",
        material_id: toTrimmedString(l.material_id),
        batch_number: null,
        qty_per_pack: parsePositiveNumber(l.qty_per_pack),
        total_qty: parsePositiveNumber(l.total_qty) ?? 0,
        actual_qty: null,
        issue_sloc_id: toTrimmedString(l.issue_sloc_id) || null,
        display_order: 10 + idx,
      }));
      const { error } = await serviceRoleClient.schema("erp_production").from("packing_order_line").insert(pmRows);
      if (error) throw new Error("PROD_PACK_LINE_UPDATE_FAILED");
    }

    // Update header if qty changed
    if (body.planned_qty_kg || body.num_packs || body.fill_qty_per_pack) {
      const upd: JsonRecord = { last_updated_at: new Date().toISOString(), last_updated_by: ctx.auth_user_id };
      if (body.planned_qty_kg) upd.planned_qty_kg = parsePositiveNumber(body.planned_qty_kg);
      if (body.num_packs) upd.num_packs = parsePositiveInt(body.num_packs);
      if (body.fill_qty_per_pack) upd.fill_qty_per_pack = parsePositiveNumber(body.fill_qty_per_pack);
      await serviceRoleClient.schema("erp_production").from("packing_order").update(upd).eq("id", id);
    }

    return okResponse({ id }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PACK_LINE_UPDATE_FAILED";
    return packErr(req, ctx, code, 500, "Packing order lines update failed");
  }
}

// POST /api/production/packing-orders/:id/link-fo
// Link or delink a Firm Order to this packing order.
export async function linkFoHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const id = getIdFromPath(req);
    if (!id) return packErr(req, ctx, "PROD_PACK_ID_MISSING", 400, "ID required");

    const { data: po } = await serviceRoleClient.schema("erp_production").from("packing_order")
      .select("id, status").eq("id", id).maybeSingle();
    if (!po) return packErr(req, ctx, "PROD_PACK_NOT_FOUND", 404, "Not found");
    if ((po as JsonRecord).status === "REVERSED") {
      return packErr(req, ctx, "PROD_PACK_REVERSED", 422, "Cannot modify reversed packing order");
    }

    const body = await parseBody(req);
    const planFeedId = toTrimmedString(body.plan_feed_id) || null;

    if (planFeedId) {
      // Verify FO exists and is ACTIVE
      const { data: fo } = await serviceRoleClient.schema("erp_production").from("plan_feed")
        .select("id, status").eq("id", planFeedId).maybeSingle();
      if (!fo || (fo as JsonRecord).status !== "ACTIVE") {
        return packErr(req, ctx, "PROD_PACK_FO_INVALID", 422, "FO not found or not ACTIVE");
      }
    }

    const { error } = await serviceRoleClient.schema("erp_production").from("packing_order")
      .update({ plan_feed_id: planFeedId, last_updated_at: new Date().toISOString(), last_updated_by: ctx.auth_user_id })
      .eq("id", id);
    if (error) throw new Error("PROD_PACK_LINK_FO_FAILED");

    return okResponse({ id, plan_feed_id: planFeedId }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PACK_LINK_FO_FAILED";
    return packErr(req, ctx, code, 500, "Link FO failed");
  }
}

// POST /api/production/packing-orders/:id/finalize
// Enter actual qty, post PM consumption (P261).
export async function finalizePackingOrderHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const id = getIdFromPath(req);
    if (!id) return packErr(req, ctx, "PROD_PACK_ID_MISSING", 400, "ID required");

    const { data: po } = await serviceRoleClient.schema("erp_production").from("packing_order")
      .select("*").eq("id", id).maybeSingle();
    if (!po) return packErr(req, ctx, "PROD_PACK_NOT_FOUND", 404, "Not found");
    if ((po as JsonRecord).status !== "STANDARD") {
      return packErr(req, ctx, "PROD_PACK_STATUS_INVALID", 422, "Must be STANDARD to finalize");
    }

    const body = await parseBody(req);
    const actualQtyKg = parsePositiveNumber(body.actual_qty_kg);
    if (!actualQtyKg) {
      return packErr(req, ctx, "PROD_PACK_ACTUAL_QTY_REQUIRED", 400, "actual_qty_kg required");
    }

    // Update actual_qty on each line
    const lineUpdates = Array.isArray(body.lines) ? body.lines : [];
    for (const lu of lineUpdates as JsonRecord[]) {
      const lineId = toTrimmedString(lu.id);
      if (lineId) {
        await serviceRoleClient.schema("erp_production").from("packing_order_line")
          .update({ actual_qty: parsePositiveNumber(lu.actual_qty) ?? 0 })
          .eq("id", lineId).eq("packing_order_id", id);
      }
    }

    // Fetch PM lines to post stock movements
    const { data: pmLines, error: pmErr } = await serviceRoleClient
      .schema("erp_production").from("packing_order_line")
      .select(`
        id, material_id, actual_qty, total_qty, issue_sloc_id
      `)
      .eq("packing_order_id", id)
      .eq("line_type", "PM");
    if (pmErr) {
      console.error("[packing_order.finalizePackingOrder] PM line query failed:", JSON.stringify(pmErr));
      throw new Error("PROD_PACK_FINALIZE_FAILED");
    }

    const poData = po as JsonRecord;
    const today = todayIso();
    const docNumber = poData.po_number as string;

    // Get PM sloc from segment config if not overridden on line
    const { data: segConfig } = await serviceRoleClient
      .schema("erp_production").from("production_segment_location_config")
      .select("pm_sloc_id")
      .eq("company_id", poData.company_id as string)
      .eq("segment_code", poData.segment_code as string)
      .maybeSingle();

    const defaultPmSlocId = (segConfig as JsonRecord | null)?.pm_sloc_id as string | null;
    const pmLineRows = (pmLines ?? []) as JsonRecord[];
    const materialMap = await getMaterialMapByIds(
      pmLineRows.map((line) => String(line.material_id ?? "")),
      "[packing_order.finalizePackingOrder]",
      "PROD_PACK_FINALIZE_FAILED",
      "id, base_uom_code",
    );

    for (const line of pmLineRows) {
      const qty = Number(line.actual_qty ?? line.total_qty ?? 0);
      if (qty <= 0) continue;

      const slocId = (line.issue_sloc_id || defaultPmSlocId) as string | null;
      if (!slocId) continue; // Skip if no sloc configured (non-fatal for PM)

      const mat = materialMap.get(String(line.material_id ?? "")) ?? null;
      const baseUom = (mat?.base_uom_code ?? "KG") as string;

      const posting = await postStockMovement({
        documentNumber: docNumber, documentDate: today, postingDate: today,
        movementTypeCode: "P261", companyId: poData.company_id,
        storageLocationId: slocId, materialId: line.material_id,
        quantity: qty, baseUomCode: baseUom, unitValue: 0,
        stockTypeCode: "UNRESTRICTED", direction: "OUT", postedBy: ctx.auth_user_id,
      });

      // Track the ledger entry for future reversal (P262)
      await serviceRoleClient.schema("erp_production").from("packing_order_line")
        .update({ stock_ledger_id: posting.stock_ledger_id })
        .eq("id", line.id as string);
    }

    const now = new Date().toISOString();
    await serviceRoleClient.schema("erp_production").from("packing_order")
      .update({ status: "FINAL", actual_qty_kg: actualQtyKg, total_qty_kg: actualQtyKg, finalized_at: now, finalized_by: ctx.auth_user_id, last_updated_at: now, last_updated_by: ctx.auth_user_id })
      .eq("id", id);

    return okResponse({ id, status: "FINAL", actual_qty_kg: actualQtyKg }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PACK_FINALIZE_FAILED";
    return packErr(req, ctx, code, 500, `Finalize failed: ${err instanceof Error ? err.message : ""}`);
  }
}

// POST /api/production/packing-orders/:id/reverse
export async function reversePackingOrderHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const id = getIdFromPath(req);
    if (!id) return packErr(req, ctx, "PROD_PACK_ID_MISSING", 400, "ID required");

    const { data: po } = await serviceRoleClient.schema("erp_production").from("packing_order")
      .select("*").eq("id", id).maybeSingle();
    if (!po) return packErr(req, ctx, "PROD_PACK_NOT_FOUND", 404, "Not found");
    const poData = po as JsonRecord;
    if (poData.status === "REVERSED") {
      return packErr(req, ctx, "PROD_PACK_ALREADY_REVERSED", 409, "Already reversed");
    }

    // If FINAL: reverse PM stock movements (P262 for each posted P261)
    if (poData.status === "FINAL") {
      const { data: pmLines, error: pmErr } = await serviceRoleClient
        .schema("erp_production").from("packing_order_line")
        .select(`
          id, material_id, actual_qty, total_qty, issue_sloc_id, stock_ledger_id
        `)
        .eq("packing_order_id", id)
        .eq("line_type", "PM");
      if (pmErr) {
        console.error("[packing_order.reversePackingOrder] PM line query failed:", JSON.stringify(pmErr));
        throw new Error("PROD_PACK_REVERSE_FAILED");
      }

      // Get segment config for pm_sloc fallback
      const { data: segConfig } = await serviceRoleClient
        .schema("erp_production").from("production_segment_location_config")
        .select("pm_sloc_id")
        .eq("company_id", poData.company_id as string)
        .eq("segment_code", poData.segment_code as string)
        .maybeSingle();

      const defaultPmSlocId = (segConfig as JsonRecord | null)?.pm_sloc_id as string | null;
      const today = todayIso();
      const revDocNum = `${poData.po_number as string}-REV`;
      const pmLineRows = (pmLines ?? []) as JsonRecord[];
      const materialMap = await getMaterialMapByIds(
        pmLineRows.map((line) => String(line.material_id ?? "")),
        "[packing_order.reversePackingOrder]",
        "PROD_PACK_REVERSE_FAILED",
        "id, base_uom_code",
      );

      for (const line of pmLineRows) {
        const qty = Number(line.actual_qty ?? line.total_qty ?? 0);
        if (qty <= 0) continue;

        const slocId = (line.issue_sloc_id || defaultPmSlocId) as string | null;
        if (!slocId) continue;

        const mat = materialMap.get(String(line.material_id ?? "")) ?? null;
        const baseUom = (mat?.base_uom_code ?? "KG") as string;

        await postStockMovement({
          documentNumber: revDocNum, documentDate: today, postingDate: today,
          movementTypeCode: "P262", companyId: poData.company_id,
          storageLocationId: slocId, materialId: line.material_id,
          quantity: qty, baseUomCode: baseUom, unitValue: 0,
          stockTypeCode: "UNRESTRICTED", direction: "IN",
          postedBy: ctx.auth_user_id,
          reversalOfId: (line.stock_ledger_id as string | null) ?? null,
        });
      }
    }

    const now = new Date().toISOString();
    await serviceRoleClient.schema("erp_production").from("packing_order")
      .update({
        status: "REVERSED",
        plan_feed_id: null,
        reversed_by: ctx.auth_user_id,
        reversed_at: now,
        last_updated_at: now,
        last_updated_by: ctx.auth_user_id,
      })
      .eq("id", id);

    return okResponse({ id, status: "REVERSED" }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_PACK_REVERSE_FAILED";
    return packErr(req, ctx, code, 500, "Reverse failed");
  }
}
