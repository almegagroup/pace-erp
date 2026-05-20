/*
 * File-ID: 16.6.1
 * File-Path: supabase/functions/api/_core/procurement/sto.handlers.ts
 * Gate: 16.6
 * Phase: 16
 * Domain: PROCUREMENT
 * Purpose: STO lifecycle handlers including dispatch, receipt confirmation, and sub-CSN transform.
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
type StoRow = Record<string, unknown>;
type StoLineRow = Record<string, unknown>;

const STO_TYPES = new Set(["CONSIGNMENT_DISTRIBUTION", "INTER_PLANT"]);
const STO_STATUSES = new Set(["CREATED", "DISPATCHED", "RECEIVED", "CLOSED", "CANCELLED"]);
const STO_LINE_STATUSES = new Set(["OPEN", "RECEIVED", "KNOCKED_OFF"]);

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

function stoErrorResponse(
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

async function generateCompanyDocNumber(companyId: string, docType: string): Promise<string> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .rpc("generate_company_doc_number", {
      p_company_id: companyId,
      p_doc_type: docType,
    });

  if (error || !data) {
    throw new Error("PROCUREMENT_DOC_NUMBER_FAILED");
  }

  return String(data);
}

async function fetchSto(stoId: string): Promise<StoRow> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("stock_transfer_order")
    .select("*")
    .eq("id", stoId)
    .single();

  if (error || !data) {
    throw new Error("STO_NOT_FOUND");
  }

  return data as StoRow;
}

function assertStoVisibleToContext(ctx: ProcurementHandlerContext, sto: StoRow): void {
  const scopedCompanyId = toTrimmedString(ctx.context.companyId);
  if (
    scopedCompanyId
    && scopedCompanyId !== toTrimmedString(sto.sending_company_id)
    && scopedCompanyId !== toTrimmedString(sto.receiving_company_id)
  ) {
    throw new Error("STO_SCOPE_VIOLATION");
  }
}

async function fetchStoLines(stoId: string): Promise<StoLineRow[]> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("stock_transfer_order_line")
    .select("*")
    .eq("sto_id", stoId)
    .order("line_number", { ascending: true });

  if (error) {
    throw new Error("STO_LINE_FETCH_FAILED");
  }

  return (data ?? []) as StoLineRow[];
}

async function hydrateSto(stoId: string, ctx?: ProcurementHandlerContext): Promise<JsonRecord> {
  const sto = await fetchSto(stoId);
  if (ctx) {
    assertStoVisibleToContext(ctx, sto);
  }
  const [lines, dcResp, gateExitResp] = await Promise.all([
    fetchStoLines(stoId),
    serviceRoleClient
      .schema("erp_procurement")
      .from("delivery_challan")
      .select("*")
      .eq("sto_id", stoId)
      .order("created_at", { ascending: false }),
    serviceRoleClient
      .schema("erp_procurement")
      .from("gate_exit_outbound")
      .select("*")
      .eq("sto_id", stoId)
      .order("created_at", { ascending: false }),
  ]);

  if (dcResp.error) throw new Error("STO_DC_FETCH_FAILED");
  if (gateExitResp.error) throw new Error("STO_GXO_FETCH_FAILED");

  return {
    ...sto,
    lines,
    delivery_challans: dcResp.data ?? [],
    gate_exit_outbound: gateExitResp.data ?? [],
  };
}

async function getPlantForLocation(companyId: string, storageLocationId: string): Promise<string> {
  const { data, error } = await serviceRoleClient
    .schema("erp_inventory")
    .from("storage_location_plant_map")
    .select("plant_id")
    .eq("company_id", companyId)
    .eq("storage_location_id", storageLocationId)
    .eq("active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error || !data?.plant_id) {
    throw new Error("STO_PLANT_MAP_NOT_FOUND");
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

async function getSnapshotForLine(companyId: string, line: StoLineRow): Promise<JsonRecord> {
  const sendingLocationId = toTrimmedString(line.sending_storage_location_id);
  if (!sendingLocationId) {
    throw new Error("STO_SENDING_LOCATION_REQUIRED");
  }

  const plantId = await getPlantForLocation(companyId, sendingLocationId);
  const { data, error } = await serviceRoleClient
    .schema("erp_inventory")
    .from("stock_snapshot")
    .select("*")
    .eq("company_id", companyId)
    .eq("plant_id", plantId)
    .eq("storage_location_id", sendingLocationId)
    .eq("material_id", String(line.material_id))
    .eq("stock_type_code", "UNRESTRICTED")
    .is("batch_id", null)
    .maybeSingle();

  if (error || !data) {
    throw new Error("INSUFFICIENT_STOCK");
  }

  return { ...data, plant_id: plantId };
}

async function getSubCsnById(csnId: string, companyId: string): Promise<JsonRecord> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("consignment_note")
    .select("*")
    .eq("id", csnId)
    .eq("company_id", companyId)
    .single();

  if (error || !data) {
    throw new Error("CSN_NOT_FOUND");
  }

  return data as JsonRecord;
}

export async function createSTOHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const body = await parseBody(req);
    const stoType = toUpperTrimmedString(body.sto_type);
    const sendingCompanyId = getCompanyScope(ctx, toTrimmedString(body.sending_company_id));
    const receivingCompanyId = toTrimmedString(body.receiving_company_id);
    const stoDate = toTrimmedString(body.sto_date) || todayIsoDate();
    const relatedCsnId = toTrimmedString(body.related_csn_id) || null;
    const lines = Array.isArray(body.lines) ? (body.lines as JsonRecord[]) : [];

    if (!STO_TYPES.has(stoType) || !sendingCompanyId || !receivingCompanyId || lines.length === 0) {
      return stoErrorResponse(req, ctx, "STO_CREATE_INVALID", 400, "sto_type, sending_company_id, receiving_company_id, and lines are required.");
    }

    const stoNumber = await generateCompanyDocNumber(sendingCompanyId, "STO");
    const { data: sto, error: stoError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("stock_transfer_order")
      .insert({
        sto_number: stoNumber,
        sto_date: stoDate,
        sto_type: stoType,
        sending_company_id: sendingCompanyId,
        receiving_company_id: receivingCompanyId,
        related_csn_id: relatedCsnId,
        status: "CREATED",
        remarks: toTrimmedString(body.remarks) || null,
        created_by: ctx.auth_user_id,
        last_updated_by: ctx.auth_user_id,
      })
      .select("*")
      .single();

    if (stoError || !sto) {
      return stoErrorResponse(req, ctx, "STO_CREATE_FAILED", 500, "Unable to create STO.");
    }

    const linePayload = [];
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const quantity = parsePositiveNumber(line.quantity);
      const materialId = toTrimmedString(line.material_id);
      const uomCode = toTrimmedString(line.uom_code);
      if (!quantity || !materialId || !uomCode) {
        return stoErrorResponse(req, ctx, "STO_LINE_INVALID", 400, `Line ${index + 1} is missing required fields.`);
      }
      linePayload.push({
        sto_id: sto.id,
        line_number: index + 1,
        material_id: materialId,
        sending_storage_location_id: toTrimmedString(line.sending_storage_location_id) || null,
        receiving_storage_location_id: toTrimmedString(line.receiving_storage_location_id) || null,
        quantity,
        uom_code: uomCode,
        transfer_price: parseNullableNumber(line.transfer_price),
        transfer_price_currency: toTrimmedString(line.transfer_price_currency) || "BDT",
        balance_qty: quantity,
      });
    }

    const { error: lineError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("stock_transfer_order_line")
      .insert(linePayload);

    if (lineError) {
      return stoErrorResponse(req, ctx, "STO_LINE_CREATE_FAILED", 500, "Unable to create STO lines.");
    }

    return okResponse(await hydrateSto(String(sto.id), ctx), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "STO_CREATE_FAILED";
    const status = code.includes("INVALID") ? 400 : 500;
    return stoErrorResponse(req, ctx, code, status, code);
  }
}

export async function listSTOsHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const url = new URL(req.url);
    const companyId = getCompanyScope(ctx, url.searchParams.get("company_id") ?? undefined);
    const status = toUpperTrimmedString(url.searchParams.get("status"));
    const stoType = toUpperTrimmedString(url.searchParams.get("sto_type"));
    const limit = parsePositiveInt(url.searchParams.get("limit"), 50);

    let query = serviceRoleClient
      .schema("erp_procurement")
      .from("stock_transfer_order")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (companyId) {
      query = query.or(`sending_company_id.eq.${companyId},receiving_company_id.eq.${companyId}`);
    }
    if (status && STO_STATUSES.has(status)) {
      query = query.eq("status", status);
    }
    if (stoType && STO_TYPES.has(stoType)) {
      query = query.eq("sto_type", stoType);
    }

    const { data, error } = await query;
    if (error) {
      return stoErrorResponse(req, ctx, "STO_LIST_FAILED", 500, "Unable to list STOs.");
    }

    return okResponse({ items: data ?? [] }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "STO_LIST_FAILED";
    return stoErrorResponse(req, ctx, code, 500, code);
  }
}

export async function getSTOHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const stoId = getIdFromPath(req);
    if (!stoId) {
      return stoErrorResponse(req, ctx, "STO_ID_REQUIRED", 400, "STO id is required.");
    }
    return okResponse(await hydrateSto(stoId, ctx), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "STO_FETCH_FAILED";
    const status = code === "STO_NOT_FOUND" ? 404 : code === "STO_SCOPE_VIOLATION" ? 403 : 500;
    return stoErrorResponse(req, ctx, code, status, code);
  }
}

export async function updateSTOHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const stoId = getIdFromPath(req);
    const body = await parseBody(req);
    const sto = await fetchSto(stoId);
    assertStoVisibleToContext(ctx, sto);

    if (toUpperTrimmedString(sto.status) !== "CREATED") {
      return stoErrorResponse(req, ctx, "STO_NOT_EDITABLE", 400, "Only CREATED STO can be updated.");
    }

    const patch: JsonRecord = {
      sto_date: toTrimmedString(body.sto_date) || sto.sto_date,
      remarks: body.remarks !== undefined ? (toTrimmedString(body.remarks) || null) : sto.remarks,
      last_updated_at: new Date().toISOString(),
      last_updated_by: ctx.auth_user_id,
    };

    const { error: headerError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("stock_transfer_order")
      .update(patch)
      .eq("id", stoId);

    if (headerError) {
      return stoErrorResponse(req, ctx, "STO_UPDATE_FAILED", 500, "Unable to update STO.");
    }

    if (Array.isArray(body.lines)) {
      const lines = body.lines as JsonRecord[];
      for (const line of lines) {
        const lineId = toTrimmedString(line.id);
        if (!lineId) continue;
        const quantity = parsePositiveNumber(line.quantity);
        const receivedQty = parseNullableNumber(line.received_qty) ?? 0;
        const balanceQty = quantity !== null ? Number((quantity - receivedQty).toFixed(6)) : undefined;
        const linePatch: JsonRecord = {
          sending_storage_location_id: line.sending_storage_location_id !== undefined ? (toTrimmedString(line.sending_storage_location_id) || null) : undefined,
          receiving_storage_location_id: line.receiving_storage_location_id !== undefined ? (toTrimmedString(line.receiving_storage_location_id) || null) : undefined,
          quantity: quantity ?? undefined,
          uom_code: line.uom_code !== undefined ? toTrimmedString(line.uom_code) : undefined,
          transfer_price: line.transfer_price !== undefined ? parseNullableNumber(line.transfer_price) : undefined,
          transfer_price_currency: line.transfer_price_currency !== undefined ? (toTrimmedString(line.transfer_price_currency) || "BDT") : undefined,
          balance_qty: balanceQty,
          last_updated_at: new Date().toISOString(),
        };
        const { error: lineError } = await serviceRoleClient
          .schema("erp_procurement")
          .from("stock_transfer_order_line")
          .update(linePatch)
          .eq("id", lineId)
          .eq("sto_id", stoId);
        if (lineError) {
          return stoErrorResponse(req, ctx, "STO_LINE_UPDATE_FAILED", 500, "Unable to update STO line.");
        }
      }
    }

    return okResponse(await hydrateSto(stoId, ctx), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "STO_UPDATE_FAILED";
    const status = code === "STO_NOT_FOUND" ? 404 : code === "STO_SCOPE_VIOLATION" ? 403 : 500;
    return stoErrorResponse(req, ctx, code, status, code);
  }
}

export async function cancelSTOHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const stoId = getIdFromPath(req);
    const body = await parseBody(req);
    const reason = toTrimmedString(body.cancellation_reason);
    const sto = await fetchSto(stoId);
    assertStoVisibleToContext(ctx, sto);

    if (!reason) {
      return stoErrorResponse(req, ctx, "STO_CANCEL_REASON_REQUIRED", 400, "cancellation_reason is required.");
    }
    if (toUpperTrimmedString(sto.status) !== "CREATED") {
      return stoErrorResponse(req, ctx, "STO_CANCEL_BLOCKED", 400, "Only CREATED STO can be cancelled.");
    }

    const { error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("stock_transfer_order")
      .update({
        status: "CANCELLED",
        cancellation_reason: reason,
        cancelled_at: new Date().toISOString(),
        cancelled_by: ctx.auth_user_id,
        last_updated_at: new Date().toISOString(),
        last_updated_by: ctx.auth_user_id,
      })
      .eq("id", stoId);

    if (error) {
      return stoErrorResponse(req, ctx, "STO_CANCEL_FAILED", 500, "Unable to cancel STO.");
    }

    return okResponse(await hydrateSto(stoId, ctx), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "STO_CANCEL_FAILED";
    const status = code === "STO_NOT_FOUND" ? 404 : code === "STO_SCOPE_VIOLATION" ? 403 : 500;
    return stoErrorResponse(req, ctx, code, status, code);
  }
}

export async function transformSubCSNToSTOHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const csnId = getIdFromPath(req);
    const body = await parseBody(req);
    const companyId = getCompanyScope(ctx, toTrimmedString(body.company_id));
    const subCsn = await getSubCsnById(csnId, companyId);

    if (!toTrimmedString(subCsn.mother_csn_id)) {
      return stoErrorResponse(req, ctx, "SUB_CSN_REQUIRED", 400, "Only sub CSN can be transformed to STO.");
    }
    if (toTrimmedString(subCsn.sto_id)) {
      return stoErrorResponse(req, ctx, "CSN_ALREADY_LINKED_TO_STO", 400, "CSN is already linked to an STO.");
    }

    const sendingCompanyId = toTrimmedString(body.sending_company_id) || companyId;
    const receivingCompanyId = toTrimmedString(body.receiving_company_id) || companyId;
    const transferPrice = parseNullableNumber(body.transfer_price);
    const stoNumber = await generateCompanyDocNumber(sendingCompanyId, "STO");

    const { data: sto, error: stoError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("stock_transfer_order")
      .insert({
        sto_number: stoNumber,
        sto_date: todayIsoDate(),
        sto_type: "CONSIGNMENT_DISTRIBUTION",
        sending_company_id: sendingCompanyId,
        receiving_company_id: receivingCompanyId,
        related_csn_id: csnId,
        status: "CREATED",
        remarks: `Auto-created from sub CSN ${subCsn.csn_number ?? csnId}`,
        created_by: ctx.auth_user_id,
        last_updated_by: ctx.auth_user_id,
      })
      .select("*")
      .single();

    if (stoError || !sto) {
      return stoErrorResponse(req, ctx, "STO_TRANSFORM_CREATE_FAILED", 500, "Unable to create STO from sub CSN.");
    }

    const dispatchQty = parsePositiveNumber(subCsn.dispatch_qty) ?? parsePositiveNumber(subCsn.po_qty) ?? 0;
    const { error: lineError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("stock_transfer_order_line")
      .insert({
        sto_id: sto.id,
        line_number: 1,
        material_id: subCsn.material_id,
        sending_storage_location_id: toTrimmedString(body.sending_storage_location_id) || null,
        receiving_storage_location_id: toTrimmedString(body.receiving_storage_location_id) || null,
        quantity: dispatchQty,
        uom_code: subCsn.po_uom_code,
        transfer_price: transferPrice,
        transfer_price_currency: toTrimmedString(body.transfer_price_currency) || "BDT",
        balance_qty: dispatchQty,
      });

    if (lineError) {
      return stoErrorResponse(req, ctx, "STO_TRANSFORM_LINE_FAILED", 500, "Unable to create STO line from sub CSN.");
    }

    const { error: csnUpdateError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("consignment_note")
      .update({
        sto_id: sto.id,
        last_updated_at: new Date().toISOString(),
        last_updated_by: ctx.auth_user_id,
      })
      .eq("id", csnId);

    if (csnUpdateError) {
      return stoErrorResponse(req, ctx, "CSN_STO_LINK_FAILED", 500, "Unable to link CSN to STO.");
    }

    return okResponse(await hydrateSto(String(sto.id), ctx), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "STO_TRANSFORM_FAILED";
    const status = code === "CSN_NOT_FOUND" ? 404 : 500;
    return stoErrorResponse(req, ctx, code, status, code);
  }
}

export async function dispatchSTOHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const stoId = getIdFromPath(req);
    const body = await parseBody(req);
    const sto = await fetchSto(stoId);
    assertStoVisibleToContext(ctx, sto);

    if (toUpperTrimmedString(sto.status) !== "CREATED") {
      return stoErrorResponse(req, ctx, "STO_DISPATCH_BLOCKED", 400, "Only CREATED STO can be dispatched.");
    }

    const lines = await fetchStoLines(stoId);
    if (lines.length === 0) {
      return stoErrorResponse(req, ctx, "STO_EMPTY", 400, "STO has no lines.");
    }

    const dispatchedLineResults: Array<{ line: StoLineRow; stockDocumentId: string }> = [];
    let totalDispatchQty = 0;

    for (const line of lines) {
      const snapshot = await getSnapshotForLine(String(sto.sending_company_id), line);
      const requiredQty = parsePositiveNumber(line.quantity) ?? 0;
      const availableQty = parseNullableNumber(snapshot.quantity) ?? 0;
      if (availableQty < requiredQty) {
        return stoErrorResponse(req, ctx, "INSUFFICIENT_STOCK", 400, `Insufficient stock for STO line ${line.line_number}.`);
      }

      const postingBlocked = await hasPhysicalInventoryBlock(
        String(line.material_id),
        String(snapshot.plant_id),
        String(line.sending_storage_location_id),
      );
      if (postingBlocked) {
        return stoErrorResponse(
          req,
          ctx,
          "MATERIAL_POSTING_BLOCKED",
          409,
          "Material has an active physical inventory count in progress.",
        );
      }

      const posting = await serviceRoleClient
        .schema("erp_inventory")
        .rpc("post_stock_movement", {
          p_document_number: sto.sto_number,
          p_document_date: sto.sto_date,
          p_posting_date: todayIsoDate(),
          p_movement_type_code: "STO_ISSUE",
          p_company_id: sto.sending_company_id,
          p_plant_id: snapshot.plant_id,
          p_storage_location_id: line.sending_storage_location_id,
          p_material_id: line.material_id,
          p_quantity: requiredQty,
          p_base_uom_code: line.uom_code,
          p_unit_value: parseNullableNumber(snapshot.valuation_rate) ?? 0,
          p_stock_type_code: "UNRESTRICTED",
          p_direction: "OUT",
          p_posted_by: ctx.auth_user_id,
          p_reversal_of_id: null,
        });

      if (posting.error || !Array.isArray(posting.data) || posting.data.length === 0) {
        return stoErrorResponse(req, ctx, "STO_DISPATCH_POST_FAILED", 500, "Unable to post STO issue movement.");
      }

      const stockDocumentId = String(posting.data[0].stock_document_id);
      const issuedQty = requiredQty;
      const balanceQty = Number(((parsePositiveNumber(line.quantity) ?? 0) - issuedQty).toFixed(6));
      const lineStatus = balanceQty <= 0 ? "RECEIVED" : "OPEN";

      const { error: lineUpdateError } = await serviceRoleClient
        .schema("erp_procurement")
        .from("stock_transfer_order_line")
        .update({
          dispatched_qty: issuedQty,
          balance_qty: balanceQty,
          line_status: lineStatus,
          last_updated_at: new Date().toISOString(),
        })
        .eq("id", String(line.id));

      if (lineUpdateError) {
        return stoErrorResponse(req, ctx, "STO_LINE_DISPATCH_UPDATE_FAILED", 500, "Unable to update STO line dispatch state.");
      }

      dispatchedLineResults.push({ line, stockDocumentId });
      totalDispatchQty += issuedQty;
    }

    const dcNumber = await generateProcurementDocNumber("DC");
    const { data: dc, error: dcError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("delivery_challan")
      .insert({
        dc_number: dcNumber,
        dc_date: todayIsoDate(),
        dc_type: "STO",
        selling_company_id: sto.sending_company_id,
        receiving_company_id: sto.receiving_company_id,
        sto_id: stoId,
        delivery_address: toTrimmedString(body.delivery_address) || null,
        transporter_id: toTrimmedString(body.transporter_id) || null,
        transporter_name_freetext: toTrimmedString(body.transporter_name_freetext) || null,
        vehicle_number: toTrimmedString(body.vehicle_number) || null,
        lr_number: toTrimmedString(body.lr_number) || null,
        driver_name: toTrimmedString(body.driver_name) || null,
        status: "AUTO_GENERATED",
        total_value: dispatchedLineResults.reduce((sum, item) => sum + ((parseNullableNumber(item.line.transfer_price) ?? 0) * (parsePositiveNumber(item.line.quantity) ?? 0)), 0),
        remarks: toTrimmedString(body.remarks) || null,
      })
      .select("*")
      .single();

    if (dcError || !dc) {
      return stoErrorResponse(req, ctx, "STO_DC_CREATE_FAILED", 500, "Unable to create delivery challan.");
    }

    const dcLinePayload = dispatchedLineResults.map(({ line, stockDocumentId }, index) => ({
      dc_id: dc.id,
      line_number: index + 1,
      material_id: line.material_id,
      sto_line_id: line.id,
      quantity: line.quantity,
      uom_code: line.uom_code,
      unit_value: line.transfer_price,
      line_total: (parseNullableNumber(line.transfer_price) ?? 0) * (parsePositiveNumber(line.quantity) ?? 0),
      stock_document_id: stockDocumentId,
    }));

    const { error: dcLineError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("delivery_challan_line")
      .insert(dcLinePayload);

    if (dcLineError) {
      return stoErrorResponse(req, ctx, "STO_DC_LINE_CREATE_FAILED", 500, "Unable to create delivery challan lines.");
    }

    const gxoNumber = await generateProcurementDocNumber("GXO");
    const { error: gateExitError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("gate_exit_outbound")
      .insert({
        exit_number: gxoNumber,
        exit_date: todayIsoDate(),
        exit_time: toTrimmedString(body.exit_time) || null,
        exit_type: "STO",
        company_id: sto.sending_company_id,
        plant_id: null,
        sto_id: stoId,
        dc_id: dc.id,
        vehicle_number: toTrimmedString(body.vehicle_number) || "STO-VEHICLE",
        driver_name: toTrimmedString(body.driver_name) || null,
        gate_staff_id: ctx.auth_user_id,
        transporter_id: toTrimmedString(body.transporter_id) || null,
        transporter_freetext: toTrimmedString(body.transporter_name_freetext) || null,
        lr_number: toTrimmedString(body.lr_number) || null,
        rst_number: toTrimmedString(body.rst_number) || null,
        gross_weight: parseNullableNumber(body.gross_weight),
        tare_weight: parseNullableNumber(body.tare_weight),
        net_weight: parseNullableNumber(body.gross_weight) !== null && parseNullableNumber(body.tare_weight) !== null
          ? Number(((parseNullableNumber(body.gross_weight) ?? 0) - (parseNullableNumber(body.tare_weight) ?? 0)).toFixed(6))
          : null,
        dispatch_qty: totalDispatchQty,
        remarks: toTrimmedString(body.remarks) || null,
      });

    if (gateExitError) {
      return stoErrorResponse(req, ctx, "STO_GXO_CREATE_FAILED", 500, "Unable to create outbound gate exit.");
    }

    const { error: stoUpdateError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("stock_transfer_order")
      .update({
        status: "DISPATCHED",
        last_updated_at: new Date().toISOString(),
        last_updated_by: ctx.auth_user_id,
      })
      .eq("id", stoId);

    if (stoUpdateError) {
      return stoErrorResponse(req, ctx, "STO_DISPATCH_STATUS_FAILED", 500, "Unable to update STO status.");
    }

    return okResponse(await hydrateSto(stoId, ctx), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "STO_DISPATCH_FAILED";
    const status = code === "INSUFFICIENT_STOCK" || code.includes("REQUIRED") ? 400 : code === "STO_NOT_FOUND" ? 404 : 500;
    return stoErrorResponse(req, ctx, code, status, code);
  }
}

export async function updateGateExitOutboundWeightHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const gateExitId = getPathSegments(req)[4] ?? "";
    const body = await parseBody(req);
    const tareWeight = parsePositiveNumber(body.tare_weight);
    if (!gateExitId || !tareWeight) {
      return stoErrorResponse(req, ctx, "GXO_WEIGHT_INVALID", 400, "gate exit id and tare_weight are required.");
    }

    const { data: gateExit, error: fetchError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("gate_exit_outbound")
      .select("*")
      .eq("id", gateExitId)
      .single();

    if (fetchError || !gateExit) {
      return stoErrorResponse(req, ctx, "GXO_NOT_FOUND", 404, "Outbound gate exit not found.");
    }

    const grossWeight = parseNullableNumber(gateExit.gross_weight);
    const netWeight = grossWeight !== null ? Number((grossWeight - tareWeight).toFixed(6)) : null;
    const { data, error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("gate_exit_outbound")
      .update({
        tare_weight: tareWeight,
        net_weight: netWeight,
      })
      .eq("id", gateExitId)
      .select("*")
      .single();

    if (error || !data) {
      return stoErrorResponse(req, ctx, "GXO_WEIGHT_UPDATE_FAILED", 500, "Unable to update gate exit outbound weight.");
    }

    return okResponse(data, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "GXO_WEIGHT_UPDATE_FAILED";
    const status = code === "GXO_NOT_FOUND" ? 404 : 500;
    return stoErrorResponse(req, ctx, code, status, code);
  }
}

export async function confirmSTOReceiptHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const stoId = getIdFromPath(req);
    const sto = await fetchSto(stoId);
    assertStoVisibleToContext(ctx, sto);

    const { data: grn, error: grnError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("goods_receipt")
      .select("*")
      .eq("sto_id", stoId)
      .eq("status", "POSTED")
      .order("posted_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (grnError) {
      return stoErrorResponse(req, ctx, "STO_RECEIPT_GRN_CHECK_FAILED", 500, "Unable to validate STO receipt GRN.");
    }
    if (!grn) {
      return stoErrorResponse(req, ctx, "STO_RECEIPT_GRN_MISSING", 400, "No POSTED GRN found for this STO.");
    }

    const { data: grnLines, error: grnLineError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("goods_receipt_line")
      .select("*")
      .eq("grn_id", String(grn.id))
      .not("sto_line_id", "is", null);

    if (grnLineError) {
      return stoErrorResponse(req, ctx, "STO_RECEIPT_LINE_FETCH_FAILED", 500, "Unable to fetch STO GRN lines.");
    }

    for (const grnLine of grnLines ?? []) {
      const stoLineId = toTrimmedString((grnLine as JsonRecord).sto_line_id);
      if (!stoLineId) continue;
      const stoLine = (await fetchStoLines(stoId)).find((line) => String(line.id) === stoLineId);
      if (!stoLine) continue;
      const receivedQty = parsePositiveNumber((grnLine as JsonRecord).received_qty) ?? 0;
      const totalReceivedQty = Number(((parseNullableNumber(stoLine.received_qty) ?? 0) + receivedQty).toFixed(6));
      const balanceQty = Number(((parsePositiveNumber(stoLine.quantity) ?? 0) - totalReceivedQty).toFixed(6));
      const lineStatus = balanceQty <= 0 ? "RECEIVED" : "OPEN";
      await serviceRoleClient
        .schema("erp_procurement")
        .from("stock_transfer_order_line")
        .update({
          received_qty: totalReceivedQty,
          balance_qty: balanceQty < 0 ? 0 : balanceQty,
          line_status: lineStatus,
          last_updated_at: new Date().toISOString(),
        })
        .eq("id", stoLineId);
    }

    const { error: updateError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("stock_transfer_order")
      .update({
        status: "RECEIVED",
        last_updated_at: new Date().toISOString(),
        last_updated_by: ctx.auth_user_id,
      })
      .eq("id", stoId);

    if (updateError) {
      return stoErrorResponse(req, ctx, "STO_RECEIPT_CONFIRM_FAILED", 500, "Unable to confirm STO receipt.");
    }

    return okResponse(await hydrateSto(stoId, ctx), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "STO_RECEIPT_CONFIRM_FAILED";
    const status = code === "STO_NOT_FOUND" ? 404 : code === "STO_RECEIPT_GRN_MISSING" ? 400 : 500;
    return stoErrorResponse(req, ctx, code, status, code);
  }
}

export async function closeSTOHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const stoId = getIdFromPath(req);
    const sto = await fetchSto(stoId);
    assertStoVisibleToContext(ctx, sto);

    if (toUpperTrimmedString(sto.status) !== "RECEIVED") {
      return stoErrorResponse(req, ctx, "STO_CLOSE_BLOCKED", 400, "Only RECEIVED STO can be closed.");
    }

    const lines = await fetchStoLines(stoId);
    const hasOpenBalance = lines.some((line) => {
      const balanceQty = parseNullableNumber(line.balance_qty) ?? 0;
      const lineStatus = toUpperTrimmedString(line.line_status);
      return balanceQty > 0 && lineStatus !== "KNOCKED_OFF";
    });

    if (hasOpenBalance) {
      return stoErrorResponse(req, ctx, "STO_CLOSE_BALANCE_REMAINING", 400, "All STO lines must have zero balance or be knocked off before closing.");
    }

    const { error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("stock_transfer_order")
      .update({
        status: "CLOSED",
        last_updated_at: new Date().toISOString(),
        last_updated_by: ctx.auth_user_id,
      })
      .eq("id", stoId);

    if (error) {
      return stoErrorResponse(req, ctx, "STO_CLOSE_FAILED", 500, "Unable to close STO.");
    }

    return okResponse(await hydrateSto(stoId, ctx), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "STO_CLOSE_FAILED";
    const status = code === "STO_NOT_FOUND" ? 404 : 500;
    return stoErrorResponse(req, ctx, code, status, code);
  }
}
