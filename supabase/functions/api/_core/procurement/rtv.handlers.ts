/*
 * File-ID: 16.7.1
 * File-Path: supabase/functions/api/_core/procurement/rtv.handlers.ts
 * Gate: 16.7
 * Phase: 16
 * Domain: PROCUREMENT
 * Purpose: RTV, debit note, and exchange reference lifecycle handlers.
 * Authority: Backend
 */

import type { ContextResolution } from "../../_pipeline/context.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { errorResponse, okResponse } from "../response.ts";

type JsonRecord = Record<string, unknown>;
type ProcurementHandlerContext = {
  context: Extract<ContextResolution, { status: "RESOLVED" }>;
  request_id: string;
  auth_user_id: string;
  roleCode: string;
};
type RtvRow = Record<string, unknown>;
type RtvLineRow = Record<string, unknown>;

const RTV_STATUSES = new Set(["CREATED", "DISPATCHED", "SETTLED", "CANCELLED"]);
const RTV_SETTLEMENT_MODES = new Set(["DEBIT_NOTE", "NEXT_INVOICE_ADJUST", "EXCHANGE"]);
const RTV_REASON_CATEGORIES = new Set([
  "QA_FAILURE",
  "EXCESS_DELIVERY",
  "WRONG_MATERIAL",
  "DAMAGED",
  "QUALITY_DEVIATION",
  "OTHER",
]);
const DEBIT_NOTE_STATUSES = new Set(["DRAFT", "SENT", "ACKNOWLEDGED", "SETTLED"]);
const EXCHANGE_REF_STATUSES = new Set(["RETURN_DISPATCHED", "REPLACEMENT_RECEIVED", "SETTLED"]);

function parseBody(req: Request): Promise<JsonRecord> {
  return req.json().catch(() => ({} as JsonRecord));
}

function toTrimmedString(value: unknown): string {
  return String(value ?? "").trim();
}

function toUpperTrimmedString(value: unknown): string {
  return toTrimmedString(value).toUpperCase();
}

function parsePositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function parsePositiveNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseNullableNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function getPathSegments(req: Request): string[] {
  return new URL(req.url).pathname.split("/").filter(Boolean);
}

function getIdFromPath(req: Request): string {
  return getPathSegments(req)[3] ?? "";
}

function rtvErrorResponse(
  req: Request,
  ctx: ProcurementHandlerContext,
  code: string,
  status: number,
  message: string,
): Response {
  return errorResponse(code, message, ctx.request_id, "NONE", status, {}, req);
}

function assertProcurementReadRole(_ctx: ProcurementHandlerContext): void {
  // Protected by upstream pipeline.
}

function getCompanyScope(ctx: ProcurementHandlerContext, requestedCompanyId?: string): string {
  const scopedCompanyId = toTrimmedString(ctx.context.companyId);
  const companyId = toTrimmedString(requestedCompanyId);
  return companyId || scopedCompanyId;
}

async function generateProcurementDocNumber(docType: string): Promise<string> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .rpc("generate_doc_number", { p_doc_type: docType });

  if (error || !data) {
    throw new Error("PROCUREMENT_DOC_NUMBER_FAILED");
  }

  return String(data);
}

async function fetchRtv(rtvId: string): Promise<RtvRow> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("return_to_vendor")
    .select("*")
    .eq("id", rtvId)
    .single();

  if (error || !data) {
    throw new Error("RTV_NOT_FOUND");
  }

  return data as RtvRow;
}

function assertRtvVisibleToContext(ctx: ProcurementHandlerContext, rtv: RtvRow): void {
  const scopedCompanyId = toTrimmedString(ctx.context.companyId);
  if (scopedCompanyId && scopedCompanyId !== toTrimmedString(rtv.company_id)) {
    throw new Error("RTV_SCOPE_VIOLATION");
  }
}

async function fetchRtvLines(rtvId: string): Promise<RtvLineRow[]> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("return_to_vendor_line")
    .select("*")
    .eq("rtv_id", rtvId)
    .order("line_number", { ascending: true });

  if (error) {
    throw new Error("RTV_LINE_FETCH_FAILED");
  }

  return (data ?? []) as RtvLineRow[];
}

async function hydrateRtv(rtvId: string, ctx?: ProcurementHandlerContext): Promise<JsonRecord> {
  const rtv = await fetchRtv(rtvId);
  if (ctx) {
    assertRtvVisibleToContext(ctx, rtv);
  }
  const [lines, dnResp, exrResp] = await Promise.all([
    fetchRtvLines(rtvId),
    serviceRoleClient
      .schema("erp_procurement")
      .from("debit_note")
      .select("*")
      .eq("rtv_id", rtvId)
      .order("created_at", { ascending: false }),
    serviceRoleClient
      .schema("erp_procurement")
      .from("exchange_reference")
      .select("*")
      .eq("rtv_id", rtvId)
      .order("created_at", { ascending: false }),
  ]);

  if (dnResp.error) throw new Error("RTV_DN_FETCH_FAILED");
  if (exrResp.error) throw new Error("RTV_EXR_FETCH_FAILED");

  return {
    ...rtv,
    lines,
    debit_notes: dnResp.data ?? [],
    exchange_references: exrResp.data ?? [],
  };
}

async function getGrn(grnId: string): Promise<JsonRecord> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("goods_receipt")
    .select("*")
    .eq("id", grnId)
    .single();

  if (error || !data) {
    throw new Error("GRN_NOT_FOUND");
  }

  return data as JsonRecord;
}

async function getGrnLine(grnLineId: string): Promise<JsonRecord> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("goods_receipt_line")
    .select("*")
    .eq("id", grnLineId)
    .single();

  if (error || !data) {
    throw new Error("GRN_LINE_NOT_FOUND");
  }

  return data as JsonRecord;
}

async function getSnapshot(companyId: string, materialId: string, storageLocationId: string, stockTypeCode: string): Promise<JsonRecord | null> {
  const { data, error } = await serviceRoleClient
    .schema("erp_inventory")
    .from("stock_snapshot")
    .select("*")
    .eq("company_id", companyId)
    .eq("material_id", materialId)
    .eq("storage_location_id", storageLocationId)
    .eq("stock_type_code", stockTypeCode)
    .is("batch_id", null)
    .maybeSingle();

  if (error) {
    throw new Error("RTV_STOCK_LOOKUP_FAILED");
  }

  return data as JsonRecord | null;
}

async function getPlantForSnapshot(companyId: string, storageLocationId: string): Promise<string> {
  const { data, error } = await serviceRoleClient
    .schema("erp_inventory")
    .from("storage_location_plant_map")
    .select("plant_id")
    .eq("company_id", companyId)
    .eq("storage_location_id", storageLocationId)
    .eq("active", true)
    .limit(1)
    .maybeSingle();

  if (error || !data?.plant_id) {
    throw new Error("RTV_PLANT_MAP_NOT_FOUND");
  }

  return String(data.plant_id);
}

async function hasPhysicalInventoryBlock(
  materialId: string,
  plantId: string,
  storageLocationId: string,
): Promise<boolean> {
  const { data, error } = await serviceRoleClient
    .schema("erp_inventory")
    .from("physical_inventory_block")
    .select("id")
    .eq("material_id", materialId)
    .eq("plant_id", plantId)
    .eq("storage_location_id", storageLocationId)
    .maybeSingle();

  if (error) {
    throw new Error("MATERIAL_POSTING_BLOCK_LOOKUP_FAILED");
  }

  return Boolean(data?.id);
}

async function getPoFreightTerm(poId: string): Promise<string | null> {
  if (!poId) return null;
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("purchase_order")
    .select("freight_term")
    .eq("id", poId)
    .maybeSingle();

  if (error) {
    throw new Error("RTV_PO_LOOKUP_FAILED");
  }

  return toUpperTrimmedString(data?.freight_term) || null;
}

async function getLandedCostForGRN(grnId: string): Promise<{ header: JsonRecord | null; lines: JsonRecord[] }> {
  const { data: header, error: headerError } = await serviceRoleClient
    .schema("erp_procurement")
    .from("landed_cost")
    .select("*")
    .eq("grn_id", grnId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (headerError) {
    throw new Error("RTV_LC_LOOKUP_FAILED");
  }
  if (!header) {
    return { header: null, lines: [] };
  }

  const { data: lines, error: lineError } = await serviceRoleClient
    .schema("erp_procurement")
    .from("landed_cost_line")
    .select("*")
    .eq("lc_id", String(header.id))
    .order("line_number", { ascending: true });

  if (lineError) {
    throw new Error("RTV_LC_LINE_LOOKUP_FAILED");
  }

  return { header: header as JsonRecord, lines: (lines ?? []) as JsonRecord[] };
}

async function computeRtvTotalValue(rtvId: string): Promise<number> {
  const lines = await fetchRtvLines(rtvId);
  return Number(
    lines.reduce((sum, line) => sum + (parseNullableNumber(line.line_value) ?? 0), 0).toFixed(4),
  );
}

function hasDirectOverride(line: RtvLineRow, directLineIds: Set<string>): boolean {
  return directLineIds.has(String(line.id));
}

export async function createRTVHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const body = await parseBody(req);
    const companyId = getCompanyScope(ctx, toTrimmedString(body.company_id));
    const vendorId = toTrimmedString(body.vendor_id);
    const grnId = toTrimmedString(body.grn_id);
    const settlementMode = toUpperTrimmedString(body.settlement_mode);
    const reasonCategory = toUpperTrimmedString(body.reason_category);

    if (!companyId || !vendorId || !grnId || !RTV_SETTLEMENT_MODES.has(settlementMode) || !RTV_REASON_CATEGORIES.has(reasonCategory)) {
      return rtvErrorResponse(req, ctx, "RTV_CREATE_INVALID", 400, "company_id, vendor_id, grn_id, settlement_mode, and reason_category are required.");
    }

    const grn = await getGrn(grnId);
    if (String(grn.company_id) !== companyId) {
      return rtvErrorResponse(req, ctx, "RTV_SCOPE_VIOLATION", 403, "GRN is outside company scope.");
    }

    const rtvNumber = await generateProcurementDocNumber("RTV");
    const { data: rtv, error: rtvError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("return_to_vendor")
      .insert({
        rtv_number: rtvNumber,
        rtv_date: toTrimmedString(body.rtv_date) || todayIsoDate(),
        company_id: companyId,
        vendor_id: vendorId,
        grn_id: grnId,
        po_id: toTrimmedString(body.po_id) || toTrimmedString(grn.po_id) || null,
        reason_category: reasonCategory,
        reason_text: toTrimmedString(body.reason_text) || null,
        settlement_mode: settlementMode,
        status: "CREATED",
        remarks: toTrimmedString(body.remarks) || null,
        created_by: ctx.auth_user_id,
        last_updated_by: ctx.auth_user_id,
      })
      .select("*")
      .single();

    if (rtvError || !rtv) {
      return rtvErrorResponse(req, ctx, "RTV_CREATE_FAILED", 500, "Unable to create RTV.");
    }

    return okResponse(await hydrateRtv(String(rtv.id), ctx), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "RTV_CREATE_FAILED";
    const status = code === "GRN_NOT_FOUND" ? 404 : code === "RTV_SCOPE_VIOLATION" ? 403 : 500;
    return rtvErrorResponse(req, ctx, code, status, code);
  }
}

export async function listRTVsHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const url = new URL(req.url);
    const companyId = getCompanyScope(ctx, url.searchParams.get("company_id") ?? undefined);
    const status = toUpperTrimmedString(url.searchParams.get("status"));
    const vendorId = toTrimmedString(url.searchParams.get("vendor_id"));
    const settlementMode = toUpperTrimmedString(url.searchParams.get("settlement_mode"));
    const limit = parsePositiveInt(url.searchParams.get("limit"), 50);

    let query = serviceRoleClient
      .schema("erp_procurement")
      .from("return_to_vendor")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (companyId) query = query.eq("company_id", companyId);
    if (status && RTV_STATUSES.has(status)) query = query.eq("status", status);
    if (vendorId) query = query.eq("vendor_id", vendorId);
    if (settlementMode && RTV_SETTLEMENT_MODES.has(settlementMode)) query = query.eq("settlement_mode", settlementMode);

    const { data, error } = await query;
    if (error) {
      return rtvErrorResponse(req, ctx, "RTV_LIST_FAILED", 500, "Unable to list RTVs.");
    }

    return okResponse({ items: data ?? [] }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "RTV_LIST_FAILED";
    return rtvErrorResponse(req, ctx, code, 500, code);
  }
}

export async function getRTVHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const rtvId = getIdFromPath(req);
    if (!rtvId) {
      return rtvErrorResponse(req, ctx, "RTV_ID_REQUIRED", 400, "RTV id is required.");
    }
    return okResponse(await hydrateRtv(rtvId, ctx), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "RTV_FETCH_FAILED";
    const status = code === "RTV_NOT_FOUND" ? 404 : code === "RTV_SCOPE_VIOLATION" ? 403 : 500;
    return rtvErrorResponse(req, ctx, code, status, code);
  }
}

export async function addRTVLineHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const rtvId = getIdFromPath(req);
    const body = await parseBody(req);
    const rtv = await fetchRtv(rtvId);
    assertRtvVisibleToContext(ctx, rtv);

    if (toUpperTrimmedString(rtv.status) !== "CREATED") {
      return rtvErrorResponse(req, ctx, "RTV_NOT_EDITABLE", 400, "Only CREATED RTV can accept lines.");
    }

    const grnLineId = toTrimmedString(body.grn_line_id);
    const storageLocationId = toTrimmedString(body.storage_location_id);
    const returnQty = parsePositiveNumber(body.return_qty);
    if (!grnLineId || !storageLocationId || !returnQty) {
      return rtvErrorResponse(req, ctx, "RTV_LINE_INVALID", 400, "grn_line_id, storage_location_id, and return_qty are required.");
    }

    const grnLine = await getGrnLine(grnLineId);
    const companyId = String(rtv.company_id);
    const stockTypeOverride = toUpperTrimmedString(body.stock_type_override);
    const stockTypeToCheck = stockTypeOverride === "DIRECT" ? "UNRESTRICTED" : "BLOCKED";
    const snapshot = await getSnapshot(companyId, String(grnLine.material_id), storageLocationId, stockTypeToCheck);
    const availableQty = parseNullableNumber(snapshot?.quantity) ?? 0;
    if (availableQty < returnQty) {
      return rtvErrorResponse(req, ctx, "INSUFFICIENT_STOCK", 400, `Insufficient ${stockTypeToCheck} stock for RTV line.`);
    }

    const existingLines = await fetchRtvLines(rtvId);
    const { data, error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("return_to_vendor_line")
      .insert({
        rtv_id: rtvId,
        line_number: existingLines.length + 1,
        grn_line_id: grnLineId,
        material_id: grnLine.material_id,
        storage_location_id: storageLocationId,
        original_grn_qty: grnLine.received_qty,
        return_qty: returnQty,
        uom_code: grnLine.uom_code,
        grn_rate: grnLine.grn_rate,
        line_value: Number((returnQty * (parseNullableNumber(grnLine.grn_rate) ?? 0)).toFixed(4)),
      })
      .select("*")
      .single();

    if (error || !data) {
      return rtvErrorResponse(req, ctx, "RTV_LINE_CREATE_FAILED", 500, "Unable to add RTV line.");
    }

    return okResponse(data, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "RTV_LINE_CREATE_FAILED";
    const status = code === "RTV_NOT_FOUND" || code === "GRN_LINE_NOT_FOUND" ? 404 : code === "RTV_SCOPE_VIOLATION" ? 403 : code === "INSUFFICIENT_STOCK" ? 400 : 500;
    return rtvErrorResponse(req, ctx, code, status, code);
  }
}

export async function postRTVHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const rtvId = getIdFromPath(req);
    const body = await parseBody(req);
    const directLineIds = new Set(
      Array.isArray(body.direct_line_ids)
        ? (body.direct_line_ids as unknown[]).map((value) => String(value))
        : [],
    );

    const rtv = await fetchRtv(rtvId);
    assertRtvVisibleToContext(ctx, rtv);
    if (toUpperTrimmedString(rtv.status) !== "CREATED") {
      return rtvErrorResponse(req, ctx, "RTV_POST_BLOCKED", 400, "Only CREATED RTV can be posted.");
    }

    const lines = await fetchRtvLines(rtvId);
    if (lines.length === 0) {
      return rtvErrorResponse(req, ctx, "RTV_EMPTY", 400, "RTV has no lines.");
    }

    let totalDispatchQty = 0;
    let totalLineValue = 0;
    for (const line of lines) {
      const companyId = String(rtv.company_id);
      const storageLocationId = toTrimmedString(line.storage_location_id);
      const materialId = String(line.material_id);
      const returnQty = parsePositiveNumber(line.return_qty) ?? 0;
      const uomCode = toTrimmedString(line.uom_code);
      const unitValue = parseNullableNumber(line.grn_rate) ?? 0;
      const isDirectPath = hasDirectOverride(line, directLineIds);
      const blockedSnapshot = await getSnapshot(companyId, materialId, storageLocationId, "BLOCKED");
      const blockedPlantId = await getPlantForSnapshot(companyId, storageLocationId);
      const postingBlocked = await hasPhysicalInventoryBlock(
        materialId,
        blockedPlantId,
        storageLocationId,
      );
      if (postingBlocked) {
        return rtvErrorResponse(
          req,
          ctx,
          "MATERIAL_POSTING_BLOCKED",
          409,
          "Material has an active physical inventory count in progress.",
        );
      }

      if (isDirectPath) {
        const unrestrictedSnapshot = await getSnapshot(companyId, materialId, storageLocationId, "UNRESTRICTED");
        const unrestrictedQty = parseNullableNumber(unrestrictedSnapshot?.quantity) ?? 0;
        if (unrestrictedQty < returnQty) {
          return rtvErrorResponse(req, ctx, "INSUFFICIENT_STOCK", 400, `Insufficient UNRESTRICTED stock for RTV line ${line.line_number}.`);
        }

        const blockOut = await serviceRoleClient
          .schema("erp_inventory")
          .rpc("post_stock_movement", {
            p_document_number: rtv.rtv_number,
            p_document_date: rtv.rtv_date,
            p_posting_date: todayIsoDate(),
            p_movement_type_code: "P344",
            p_company_id: companyId,
            p_plant_id: blockedPlantId,
            p_storage_location_id: storageLocationId,
            p_material_id: materialId,
            p_quantity: returnQty,
            p_base_uom_code: uomCode,
            p_unit_value: parseNullableNumber(unrestrictedSnapshot?.valuation_rate) ?? unitValue,
            p_stock_type_code: "UNRESTRICTED",
            p_direction: "OUT",
            p_posted_by: ctx.auth_user_id,
            p_reversal_of_id: null,
          });

        if (blockOut.error || !Array.isArray(blockOut.data) || blockOut.data.length === 0) {
          return rtvErrorResponse(req, ctx, "RTV_DIRECT_BLOCK_OUT_FAILED", 500, "Unable to move UNRESTRICTED stock to BLOCKED.");
        }

        const blockIn = await serviceRoleClient
          .schema("erp_inventory")
          .rpc("post_stock_movement", {
            p_document_number: rtv.rtv_number,
            p_document_date: rtv.rtv_date,
            p_posting_date: todayIsoDate(),
            p_movement_type_code: "P344",
            p_company_id: companyId,
            p_plant_id: blockedPlantId,
            p_storage_location_id: storageLocationId,
            p_material_id: materialId,
            p_quantity: returnQty,
            p_base_uom_code: uomCode,
            p_unit_value: parseNullableNumber(unrestrictedSnapshot?.valuation_rate) ?? unitValue,
            p_stock_type_code: "BLOCKED",
            p_direction: "IN",
            p_posted_by: ctx.auth_user_id,
            p_reversal_of_id: null,
          });

        if (blockIn.error || !Array.isArray(blockIn.data) || blockIn.data.length === 0) {
          return rtvErrorResponse(req, ctx, "RTV_DIRECT_BLOCK_IN_FAILED", 500, "Unable to create BLOCKED stock for direct RTV.");
        }
      } else {
        const blockedQty = parseNullableNumber(blockedSnapshot?.quantity) ?? 0;
        if (blockedQty < returnQty) {
          return rtvErrorResponse(req, ctx, "INSUFFICIENT_STOCK", 400, `Insufficient BLOCKED stock for RTV line ${line.line_number}.`);
        }
      }

      const posting = await serviceRoleClient
        .schema("erp_inventory")
        .rpc("post_stock_movement", {
          p_document_number: rtv.rtv_number,
          p_document_date: rtv.rtv_date,
          p_posting_date: todayIsoDate(),
          p_movement_type_code: "P122",
          p_company_id: companyId,
          p_plant_id: blockedPlantId,
          p_storage_location_id: storageLocationId,
          p_material_id: materialId,
          p_quantity: returnQty,
          p_base_uom_code: uomCode,
          p_unit_value: parseNullableNumber(blockedSnapshot?.valuation_rate) ?? unitValue,
          p_stock_type_code: "BLOCKED",
          p_direction: "OUT",
          p_posted_by: ctx.auth_user_id,
          p_reversal_of_id: null,
        });

      if (posting.error || !Array.isArray(posting.data) || posting.data.length === 0) {
        return rtvErrorResponse(req, ctx, "RTV_POST_FAILED", 500, "Unable to post RTV stock movement.");
      }

      const { error: lineUpdateError } = await serviceRoleClient
        .schema("erp_procurement")
        .from("return_to_vendor_line")
        .update({
          stock_document_id: posting.data[0].stock_document_id,
          stock_ledger_id: posting.data[0].stock_ledger_id,
        })
        .eq("id", String(line.id));

      if (lineUpdateError) {
        return rtvErrorResponse(req, ctx, "RTV_LINE_POST_UPDATE_FAILED", 500, "Unable to update RTV line posting references.");
      }

      totalDispatchQty += returnQty;
      totalLineValue += parseNullableNumber(line.line_value) ?? 0;
    }

    const gxoNumber = await generateProcurementDocNumber("GXO");
    const { data: gateExit, error: gateExitError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("gate_exit_outbound")
      .insert({
        exit_number: gxoNumber,
        exit_date: todayIsoDate(),
        exit_time: toTrimmedString(body.exit_time) || null,
        exit_type: "RTV",
        company_id: rtv.company_id,
        plant_id: null,
        rtv_id: rtvId,
        dc_id: null,
        vehicle_number: toTrimmedString(body.vehicle_number) || "RTV-VEHICLE",
        driver_name: toTrimmedString(body.driver_name) || null,
        gate_staff_id: ctx.auth_user_id,
        transporter_id: toTrimmedString(body.transporter_id) || null,
        transporter_freetext: toTrimmedString(body.transporter_freetext) || null,
        lr_number: toTrimmedString(body.lr_number) || null,
        rst_number: toTrimmedString(body.rst_number) || null,
        gross_weight: parseNullableNumber(body.gross_weight),
        tare_weight: parseNullableNumber(body.tare_weight),
        net_weight: parseNullableNumber(body.gross_weight) !== null && parseNullableNumber(body.tare_weight) !== null
          ? Number(((parseNullableNumber(body.gross_weight) ?? 0) - (parseNullableNumber(body.tare_weight) ?? 0)).toFixed(6))
          : null,
        dispatch_qty: totalDispatchQty,
        remarks: toTrimmedString(body.remarks) || null,
      })
      .select("*")
      .single();

    if (gateExitError || !gateExit) {
      return rtvErrorResponse(req, ctx, "RTV_GXO_CREATE_FAILED", 500, "Unable to create RTV outbound gate exit.");
    }

    const headerPatch: JsonRecord = {
      status: "DISPATCHED",
      gate_exit_id: gateExit.id,
      last_updated_at: new Date().toISOString(),
      last_updated_by: ctx.auth_user_id,
    };
    if (toUpperTrimmedString(rtv.settlement_mode) === "NEXT_INVOICE_ADJUST") {
      headerPatch.pending_credit_amount = Number(totalLineValue.toFixed(4));
    }

    const { error: rtvUpdateError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("return_to_vendor")
      .update(headerPatch)
      .eq("id", rtvId);

    if (rtvUpdateError) {
      return rtvErrorResponse(req, ctx, "RTV_HEADER_POST_UPDATE_FAILED", 500, "Unable to update RTV post state.");
    }

    return okResponse(await hydrateRtv(rtvId, ctx), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "RTV_POST_FAILED";
    const status = code === "RTV_NOT_FOUND" ? 404 : code === "RTV_SCOPE_VIOLATION" ? 403 : code === "INSUFFICIENT_STOCK" ? 400 : 500;
    return rtvErrorResponse(req, ctx, code, status, code);
  }
}

export async function createDebitNoteHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const body = await parseBody(req);
    const rtvId = toTrimmedString(body.rtv_id);
    if (!rtvId) {
      return rtvErrorResponse(req, ctx, "DN_RTV_REQUIRED", 400, "rtv_id is required.");
    }

    const rtv = await fetchRtv(rtvId);
    assertRtvVisibleToContext(ctx, rtv);
    if (toUpperTrimmedString(rtv.settlement_mode) !== "DEBIT_NOTE") {
      return rtvErrorResponse(req, ctx, "DN_SETTLEMENT_MODE_INVALID", 400, "RTV settlement_mode must be DEBIT_NOTE.");
    }

    const existingDn = await serviceRoleClient
      .schema("erp_procurement")
      .from("debit_note")
      .select("id")
      .eq("rtv_id", rtvId)
      .maybeSingle();
    if (existingDn.error) {
      return rtvErrorResponse(req, ctx, "DN_EXISTING_CHECK_FAILED", 500, "Unable to validate existing debit note.");
    }
    if (existingDn.data) {
      return rtvErrorResponse(req, ctx, "DN_ALREADY_EXISTS", 400, "Debit note already exists for this RTV.");
    }

    const lines = await fetchRtvLines(rtvId);
    const grn = await getGrn(String(rtv.grn_id));
    const materialValue = Number(lines.reduce((sum, line) => sum + (parseNullableNumber(line.line_value) ?? 0), 0).toFixed(4));
    const returnQty = Number(lines.reduce((sum, line) => sum + (parsePositiveNumber(line.return_qty) ?? 0), 0).toFixed(6));
    const { lines: lcLines } = await getLandedCostForGRN(String(rtv.grn_id));
    const grnLinesResp = await serviceRoleClient
      .schema("erp_procurement")
      .from("goods_receipt_line")
      .select("received_qty")
      .eq("grn_id", String(rtv.grn_id));
    if (grnLinesResp.error) {
      return rtvErrorResponse(req, ctx, "DN_GRN_TOTAL_LOOKUP_FAILED", 500, "Unable to calculate GRN total quantity.");
    }
    const grnTotalQty = Number(((grnLinesResp.data ?? []).reduce((sum, row) => sum + (parsePositiveNumber((row as JsonRecord).received_qty) ?? 0), 0)).toFixed(6));
    const ratio = grnTotalQty > 0 ? returnQty / grnTotalQty : 0;
    const freightTerm = await getPoFreightTerm(toTrimmedString(rtv.po_id) || toTrimmedString(grn.po_id));

    let freightAmount = 0;
    let insuranceAmount = 0;
    let customsDutyAmount = 0;
    let chaChargesAmount = 0;
    let loadingCharges = 0;
    let unloadingCharges = 0;
    let otherCharges = 0;

    for (const line of lcLines) {
      const apportioned = Number(((parseNullableNumber(line.amount) ?? 0) * ratio).toFixed(4));
      switch (toUpperTrimmedString(line.cost_type)) {
        case "FREIGHT":
          freightAmount += apportioned;
          break;
        case "INSURANCE":
          insuranceAmount += apportioned;
          break;
        case "CUSTOMS_DUTY":
          customsDutyAmount += apportioned;
          break;
        case "CHA_CHARGES":
          chaChargesAmount += apportioned;
          break;
        case "LOADING":
          loadingCharges += apportioned;
          break;
        case "UNLOADING":
          unloadingCharges += apportioned;
          break;
        default:
          otherCharges += apportioned;
          break;
      }
    }

    if (freightTerm === "FOR") {
      freightAmount = 0;
    }

    const totalValue = Number((
      materialValue
      + freightAmount
      + insuranceAmount
      + customsDutyAmount
      + chaChargesAmount
      + loadingCharges
      + unloadingCharges
      + otherCharges
    ).toFixed(4));

    const dnNumber = await generateProcurementDocNumber("DN");
    const { data, error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("debit_note")
      .insert({
        dn_number: dnNumber,
        dn_date: toTrimmedString(body.dn_date) || todayIsoDate(),
        company_id: rtv.company_id,
        vendor_id: rtv.vendor_id,
        rtv_id: rtvId,
        material_value: materialValue,
        freight_amount: Number(freightAmount.toFixed(4)),
        insurance_amount: Number(insuranceAmount.toFixed(4)),
        customs_duty_amount: Number(customsDutyAmount.toFixed(4)),
        cha_charges_amount: Number(chaChargesAmount.toFixed(4)),
        loading_charges: Number(loadingCharges.toFixed(4)),
        unloading_charges: Number(unloadingCharges.toFixed(4)),
        other_charges: Number(otherCharges.toFixed(4)),
        total_value: totalValue,
        remarks: toTrimmedString(body.remarks) || null,
        created_by: ctx.auth_user_id,
      })
      .select("*")
      .single();

    if (error || !data) {
      return rtvErrorResponse(req, ctx, "DN_CREATE_FAILED", 500, "Unable to create debit note.");
    }

    return okResponse(data, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "DN_CREATE_FAILED";
    const status = code === "RTV_NOT_FOUND" ? 404 : code === "RTV_SCOPE_VIOLATION" ? 403 : code === "DN_SETTLEMENT_MODE_INVALID" || code === "DN_ALREADY_EXISTS" ? 400 : 500;
    return rtvErrorResponse(req, ctx, code, status, code);
  }
}

export async function listDebitNotesHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const url = new URL(req.url);
    const companyId = getCompanyScope(ctx, url.searchParams.get("company_id") ?? undefined);
    const vendorId = toTrimmedString(url.searchParams.get("vendor_id"));
    const status = toUpperTrimmedString(url.searchParams.get("status"));
    const limit = parsePositiveInt(url.searchParams.get("limit"), 50);

    let query = serviceRoleClient
      .schema("erp_procurement")
      .from("debit_note")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (companyId) query = query.eq("company_id", companyId);
    if (vendorId) query = query.eq("vendor_id", vendorId);
    if (status && DEBIT_NOTE_STATUSES.has(status)) query = query.eq("status", status);

    const { data, error } = await query;
    if (error) {
      return rtvErrorResponse(req, ctx, "DN_LIST_FAILED", 500, "Unable to list debit notes.");
    }

    return okResponse({ items: data ?? [] }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "DN_LIST_FAILED";
    return rtvErrorResponse(req, ctx, code, 500, code);
  }
}

export async function getDebitNoteHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const dnId = getIdFromPath(req);
    const { data, error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("debit_note")
      .select("*")
      .eq("id", dnId)
      .single();

    if (error || !data) {
      return rtvErrorResponse(req, ctx, "DN_NOT_FOUND", 404, "Debit note not found.");
    }
    if (getCompanyScope(ctx) && getCompanyScope(ctx) !== toTrimmedString(data.company_id)) {
      return rtvErrorResponse(req, ctx, "DN_SCOPE_VIOLATION", 403, "Debit note is outside company scope.");
    }

    return okResponse(data, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "DN_FETCH_FAILED";
    return rtvErrorResponse(req, ctx, code, 500, code);
  }
}

export async function markDebitNoteSentHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const dnId = getIdFromPath(req);
    const { data, error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("debit_note")
      .select("*")
      .eq("id", dnId)
      .single();

    if (error || !data) {
      return rtvErrorResponse(req, ctx, "DN_NOT_FOUND", 404, "Debit note not found.");
    }
    if (toUpperTrimmedString(data.status) !== "DRAFT") {
      return rtvErrorResponse(req, ctx, "DN_MARK_SENT_BLOCKED", 400, "Only DRAFT debit notes can be marked sent.");
    }

    const { data: updated, error: updateError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("debit_note")
      .update({
        status: "SENT",
        sent_at: new Date().toISOString(),
        last_updated_at: new Date().toISOString(),
      })
      .eq("id", dnId)
      .select("*")
      .single();

    if (updateError || !updated) {
      return rtvErrorResponse(req, ctx, "DN_MARK_SENT_FAILED", 500, "Unable to mark debit note as sent.");
    }

    return okResponse(updated, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "DN_MARK_SENT_FAILED";
    return rtvErrorResponse(req, ctx, code, 500, code);
  }
}

export async function acknowledgeDebitNoteHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const dnId = getIdFromPath(req);
    const { data, error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("debit_note")
      .select("*")
      .eq("id", dnId)
      .single();

    if (error || !data) {
      return rtvErrorResponse(req, ctx, "DN_NOT_FOUND", 404, "Debit note not found.");
    }
    if (toUpperTrimmedString(data.status) !== "SENT") {
      return rtvErrorResponse(req, ctx, "DN_ACK_BLOCKED", 400, "Only SENT debit notes can be acknowledged.");
    }

    const { data: updated, error: updateError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("debit_note")
      .update({
        status: "ACKNOWLEDGED",
        acknowledged_at: new Date().toISOString(),
        last_updated_at: new Date().toISOString(),
      })
      .eq("id", dnId)
      .select("*")
      .single();

    if (updateError || !updated) {
      return rtvErrorResponse(req, ctx, "DN_ACK_FAILED", 500, "Unable to acknowledge debit note.");
    }

    return okResponse(updated, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "DN_ACK_FAILED";
    return rtvErrorResponse(req, ctx, code, 500, code);
  }
}

export async function settleDebitNoteHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const dnId = getIdFromPath(req);
    const { data, error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("debit_note")
      .select("*")
      .eq("id", dnId)
      .single();

    if (error || !data) {
      return rtvErrorResponse(req, ctx, "DN_NOT_FOUND", 404, "Debit note not found.");
    }
    if (toUpperTrimmedString(data.status) !== "ACKNOWLEDGED") {
      return rtvErrorResponse(req, ctx, "DN_SETTLE_BLOCKED", 400, "Only ACKNOWLEDGED debit notes can be settled.");
    }

    const { data: updated, error: updateError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("debit_note")
      .update({
        status: "SETTLED",
        settled_at: new Date().toISOString(),
        last_updated_at: new Date().toISOString(),
      })
      .eq("id", dnId)
      .select("*")
      .single();

    if (updateError || !updated) {
      return rtvErrorResponse(req, ctx, "DN_SETTLE_FAILED", 500, "Unable to settle debit note.");
    }

    const { error: rtvUpdateError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("return_to_vendor")
      .update({
        status: "SETTLED",
        last_updated_at: new Date().toISOString(),
        last_updated_by: ctx.auth_user_id,
      })
      .eq("id", String(updated.rtv_id));

    if (rtvUpdateError) {
      return rtvErrorResponse(req, ctx, "DN_RTV_SETTLE_FAILED", 500, "Unable to update RTV settlement state.");
    }

    return okResponse(updated, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "DN_SETTLE_FAILED";
    return rtvErrorResponse(req, ctx, code, 500, code);
  }
}

export async function createExchangeRefHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const body = await parseBody(req);
    const rtvId = toTrimmedString(body.rtv_id);
    if (!rtvId) {
      return rtvErrorResponse(req, ctx, "EXR_RTV_REQUIRED", 400, "rtv_id is required.");
    }

    const rtv = await fetchRtv(rtvId);
    assertRtvVisibleToContext(ctx, rtv);
    if (toUpperTrimmedString(rtv.settlement_mode) !== "EXCHANGE") {
      return rtvErrorResponse(req, ctx, "EXR_SETTLEMENT_MODE_INVALID", 400, "RTV settlement_mode must be EXCHANGE.");
    }

    const existing = await serviceRoleClient
      .schema("erp_procurement")
      .from("exchange_reference")
      .select("id")
      .eq("rtv_id", rtvId)
      .maybeSingle();
    if (existing.error) {
      return rtvErrorResponse(req, ctx, "EXR_EXISTING_CHECK_FAILED", 500, "Unable to validate existing exchange reference.");
    }
    if (existing.data) {
      return rtvErrorResponse(req, ctx, "EXR_ALREADY_EXISTS", 400, "Exchange reference already exists for this RTV.");
    }

    const exchangeRefNumber = await generateProcurementDocNumber("EXR");
    const { data, error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("exchange_reference")
      .insert({
        exchange_ref_number: exchangeRefNumber,
        company_id: rtv.company_id,
        vendor_id: rtv.vendor_id,
        rtv_id: rtvId,
        status: "RETURN_DISPATCHED",
        remarks: toTrimmedString(body.remarks) || null,
      })
      .select("*")
      .single();

    if (error || !data) {
      return rtvErrorResponse(req, ctx, "EXR_CREATE_FAILED", 500, "Unable to create exchange reference.");
    }

    await serviceRoleClient
      .schema("erp_procurement")
      .from("return_to_vendor")
      .update({
        exchange_ref_number: exchangeRefNumber,
        last_updated_at: new Date().toISOString(),
        last_updated_by: ctx.auth_user_id,
      })
      .eq("id", rtvId);

    return okResponse(data, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "EXR_CREATE_FAILED";
    const status = code === "RTV_NOT_FOUND" ? 404 : code === "RTV_SCOPE_VIOLATION" ? 403 : code === "EXR_SETTLEMENT_MODE_INVALID" || code === "EXR_ALREADY_EXISTS" ? 400 : 500;
    return rtvErrorResponse(req, ctx, code, status, code);
  }
}

export async function listExchangeRefsHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const url = new URL(req.url);
    const companyId = getCompanyScope(ctx, url.searchParams.get("company_id") ?? undefined);
    const rtvId = toTrimmedString(url.searchParams.get("rtv_id"));
    const status = toUpperTrimmedString(url.searchParams.get("status"));
    const limit = parsePositiveInt(url.searchParams.get("limit"), 50);

    let query = serviceRoleClient
      .schema("erp_procurement")
      .from("exchange_reference")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (companyId) query = query.eq("company_id", companyId);
    if (rtvId) query = query.eq("rtv_id", rtvId);
    if (status && EXCHANGE_REF_STATUSES.has(status)) query = query.eq("status", status);

    const { data, error } = await query;
    if (error) {
      return rtvErrorResponse(req, ctx, "EXR_LIST_FAILED", 500, "Unable to list exchange references.");
    }

    return okResponse({ items: data ?? [] }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "EXR_LIST_FAILED";
    return rtvErrorResponse(req, ctx, code, 500, code);
  }
}

export async function linkReplacementGRNHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const exchangeRefId = getIdFromPath(req);
    const body = await parseBody(req);
    const replacementGrnId = toTrimmedString(body.replacement_grn_id);
    if (!exchangeRefId || !replacementGrnId) {
      return rtvErrorResponse(req, ctx, "EXR_LINK_INVALID", 400, "exchange reference id and replacement_grn_id are required.");
    }

    const { data: exchangeRef, error: exchangeRefError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("exchange_reference")
      .select("*")
      .eq("id", exchangeRefId)
      .single();

    if (exchangeRefError || !exchangeRef) {
      return rtvErrorResponse(req, ctx, "EXR_NOT_FOUND", 404, "Exchange reference not found.");
    }

    const grn = await getGrn(replacementGrnId);
    if (toUpperTrimmedString(grn.status) !== "POSTED") {
      return rtvErrorResponse(req, ctx, "EXR_REPLACEMENT_GRN_INVALID", 400, "Replacement GRN must be POSTED.");
    }

    const { data: updated, error: updateError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("exchange_reference")
      .update({
        replacement_grn_id: replacementGrnId,
        status: "REPLACEMENT_RECEIVED",
        last_updated_at: new Date().toISOString(),
      })
      .eq("id", exchangeRefId)
      .select("*")
      .single();

    if (updateError || !updated) {
      return rtvErrorResponse(req, ctx, "EXR_LINK_FAILED", 500, "Unable to link replacement GRN.");
    }

    return okResponse(updated, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "EXR_LINK_FAILED";
    const status = code === "EXR_NOT_FOUND" || code === "GRN_NOT_FOUND" ? 404 : code === "EXR_REPLACEMENT_GRN_INVALID" ? 400 : 500;
    return rtvErrorResponse(req, ctx, code, status, code);
  }
}
