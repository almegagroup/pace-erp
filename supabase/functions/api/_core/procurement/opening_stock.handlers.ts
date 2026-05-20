/*
 * File-ID: 19.2.1
 * File-Path: supabase/functions/api/_core/procurement/opening_stock.handlers.ts
 * Gate: 19
 * Phase: 19
 * Domain: PROCUREMENT
 * Purpose: SA-only opening stock document lifecycle and posting handlers.
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
type OpeningStockDocumentRow = Record<string, unknown>;
type OpeningStockLineRow = Record<string, unknown>;

const DOCUMENT_STATUSES = new Set(["DRAFT", "SUBMITTED", "APPROVED", "POSTED"]);
const STOCK_TYPES = new Set(["UNRESTRICTED", "QUALITY_INSPECTION", "BLOCKED"]);

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

function parseNonNegativeNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function getPathSegments(req: Request): string[] {
  return new URL(req.url).pathname.split("/").filter(Boolean);
}

function getDocumentIdFromPath(req: Request): string {
  return getPathSegments(req)[3] ?? "";
}

function getLineIdFromPath(req: Request): string {
  return getPathSegments(req)[5] ?? "";
}

function openingStockErrorResponse(
  req: Request,
  ctx: ProcurementHandlerContext,
  code: string,
  status: number,
  message: string,
): Response {
  return errorResponse(code, message, ctx.request_id, "NONE", status, {}, req);
}

function assertSARole(ctx: ProcurementHandlerContext): void {
  if (ctx.roleCode !== "SA") {
    throw new Error("SA_REQUIRED");
  }
}

function deriveMovementType(stockType: string): string {
  switch (toUpperTrimmedString(stockType)) {
    case "QUALITY_INSPECTION":
      return "P563";
    case "BLOCKED":
      return "P565";
    default:
      return "P561";
  }
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

async function fetchOpeningStockDocument(documentId: string): Promise<OpeningStockDocumentRow> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("opening_stock_document")
    .select("*")
    .eq("id", documentId)
    .single();

  if (error || !data) {
    throw new Error("OPENING_STOCK_DOCUMENT_NOT_FOUND");
  }

  return data as OpeningStockDocumentRow;
}

async function fetchOpeningStockLines(documentId: string): Promise<OpeningStockLineRow[]> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("opening_stock_line")
    .select("*")
    .eq("document_id", documentId)
    .order("line_number", { ascending: true });

  if (error) {
    throw new Error("OPENING_STOCK_LINE_FETCH_FAILED");
  }

  return (data ?? []) as OpeningStockLineRow[];
}

async function hydrateOpeningStockDocument(documentId: string): Promise<JsonRecord> {
  const [document, lines] = await Promise.all([
    fetchOpeningStockDocument(documentId),
    fetchOpeningStockLines(documentId),
  ]);

  const totals = lines.reduce(
    (accumulator, line) => {
      accumulator.total_lines += 1;
      accumulator.total_value += Number(line.total_value ?? 0);
      return accumulator;
    },
    { total_lines: 0, total_value: 0 },
  );

  return {
    ...document,
    lines,
    total_lines: totals.total_lines,
    total_value: Number(totals.total_value.toFixed(4)),
  };
}

async function fetchMaterialBaseUom(materialId: string): Promise<string> {
  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("material_master")
    .select("base_uom_code")
    .eq("id", materialId)
    .single();

  if (error || !data?.base_uom_code) {
    throw new Error("OPENING_STOCK_MATERIAL_NOT_FOUND");
  }

  return String(data.base_uom_code);
}

function ensureDraftDocument(document: OpeningStockDocumentRow): void {
  if (toUpperTrimmedString(document.status) !== "DRAFT") {
    throw new Error("OPENING_STOCK_DOCUMENT_NOT_DRAFT");
  }
}

export async function createOpeningStockDocumentHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertSARole(ctx);
    const body = await parseBody(req);
    const companyId = toTrimmedString(body.company_id);
    const plantId = toTrimmedString(body.plant_id);
    const cutOffDate = toTrimmedString(body.cut_off_date);
    const notes = toTrimmedString(body.notes);

    if (!companyId || !plantId || !cutOffDate) {
      return openingStockErrorResponse(
        req,
        ctx,
        "OPENING_STOCK_DOCUMENT_CREATE_INVALID",
        400,
        "company_id, plant_id, and cut_off_date are required.",
      );
    }

    const { data: existing, error: existingError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("opening_stock_document")
      .select("id")
      .eq("company_id", companyId)
      .eq("plant_id", plantId)
      .eq("cut_off_date", cutOffDate)
      .maybeSingle();

    if (existingError) {
      return openingStockErrorResponse(
        req,
        ctx,
        "OPENING_STOCK_DOCUMENT_LOOKUP_FAILED",
        500,
        "Unable to validate opening stock uniqueness.",
      );
    }

    if (existing?.id) {
      return openingStockErrorResponse(
        req,
        ctx,
        "OPENING_STOCK_DOCUMENT_ALREADY_EXISTS",
        409,
        "An opening stock document already exists for this company, plant, and cut-off date.",
      );
    }

    const documentNumber = await generateProcurementDocNumber("OS");
    const { data, error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("opening_stock_document")
      .insert({
        document_number: documentNumber,
        company_id: companyId,
        plant_id: plantId,
        cut_off_date: cutOffDate,
        status: "DRAFT",
        notes: notes || null,
        created_by: ctx.auth_user_id,
      })
      .select("*")
      .single();

    if (error || !data) {
      return openingStockErrorResponse(
        req,
        ctx,
        "OPENING_STOCK_DOCUMENT_CREATE_FAILED",
        500,
        "Unable to create opening stock document.",
      );
    }

    return okResponse(await hydrateOpeningStockDocument(String(data.id)), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "OPENING_STOCK_DOCUMENT_CREATE_FAILED";
    const status = code === "SA_REQUIRED" ? 403 : 500;
    return openingStockErrorResponse(req, ctx, code, status, code);
  }
}

export async function listOpeningStockDocumentsHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertSARole(ctx);
    const url = new URL(req.url);
    const companyId = toTrimmedString(url.searchParams.get("company_id"));
    const status = toUpperTrimmedString(url.searchParams.get("status"));
    const limit = parsePositiveInt(url.searchParams.get("limit"), 100);

    let query = serviceRoleClient
      .schema("erp_procurement")
      .from("opening_stock_document")
      .select("*")
      .order("cut_off_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(limit);

    if (companyId) {
      query = query.eq("company_id", companyId);
    }
    if (status && DOCUMENT_STATUSES.has(status)) {
      query = query.eq("status", status);
    }

    const { data, error } = await query;
    if (error) {
      return openingStockErrorResponse(
        req,
        ctx,
        "OPENING_STOCK_DOCUMENT_LIST_FAILED",
        500,
        "Unable to list opening stock documents.",
      );
    }

    const rows = (data ?? []) as OpeningStockDocumentRow[];
    const lineCounts = new Map<string, number>();
    const ids = rows.map((row) => String(row.id)).filter(Boolean);

    if (ids.length > 0) {
      const { data: lineRows, error: lineError } = await serviceRoleClient
        .schema("erp_procurement")
        .from("opening_stock_line")
        .select("document_id")
        .in("document_id", ids);

      if (lineError) {
        return openingStockErrorResponse(
          req,
          ctx,
          "OPENING_STOCK_LINE_COUNT_FAILED",
          500,
          "Unable to load opening stock line counts.",
        );
      }

      for (const line of lineRows ?? []) {
        const documentId = String(line.document_id ?? "");
        if (!documentId) continue;
        lineCounts.set(documentId, (lineCounts.get(documentId) ?? 0) + 1);
      }
    }

    return okResponse(
      {
        items: rows.map((row) => ({
          ...row,
          line_count: lineCounts.get(String(row.id)) ?? 0,
        })),
      },
      ctx.request_id,
      req,
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "OPENING_STOCK_DOCUMENT_LIST_FAILED";
    const status = code === "SA_REQUIRED" ? 403 : 500;
    return openingStockErrorResponse(req, ctx, code, status, code);
  }
}

export async function getOpeningStockDocumentHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertSARole(ctx);
    const documentId = getDocumentIdFromPath(req);
    if (!documentId) {
      return openingStockErrorResponse(
        req,
        ctx,
        "OPENING_STOCK_DOCUMENT_ID_REQUIRED",
        400,
        "Opening stock document id is required.",
      );
    }

    return okResponse(await hydrateOpeningStockDocument(documentId), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "OPENING_STOCK_DOCUMENT_FETCH_FAILED";
    const status = code === "SA_REQUIRED" ? 403 : code.includes("NOT_FOUND") ? 404 : 500;
    return openingStockErrorResponse(req, ctx, code, status, code);
  }
}

export async function addOpeningStockLineHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertSARole(ctx);
    const documentId = getDocumentIdFromPath(req);
    const body = await parseBody(req);
    const materialId = toTrimmedString(body.material_id);
    const storageLocationId = toTrimmedString(body.storage_location_id);
    const stockType = toUpperTrimmedString(body.stock_type);
    const quantity = parsePositiveNumber(body.quantity);
    const ratePerUnit = parseNonNegativeNumber(body.rate_per_unit);

    if (!documentId || !materialId || !storageLocationId || !stockType || quantity === null || ratePerUnit === null) {
      return openingStockErrorResponse(
        req,
        ctx,
        "OPENING_STOCK_LINE_CREATE_INVALID",
        400,
        "material_id, storage_location_id, stock_type, quantity, and rate_per_unit are required.",
      );
    }

    if (!STOCK_TYPES.has(stockType)) {
      return openingStockErrorResponse(
        req,
        ctx,
        "OPENING_STOCK_STOCK_TYPE_INVALID",
        400,
        "Invalid stock_type.",
      );
    }

    const document = await fetchOpeningStockDocument(documentId);
    ensureDraftDocument(document);

    const { data: lastLine, error: lastLineError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("opening_stock_line")
      .select("line_number")
      .eq("document_id", documentId)
      .order("line_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastLineError) {
      return openingStockErrorResponse(
        req,
        ctx,
        "OPENING_STOCK_LINE_NUMBER_FAILED",
        500,
        "Unable to derive next line number.",
      );
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("opening_stock_line")
      .insert({
        document_id: documentId,
        line_number: Number(lastLine?.line_number ?? 0) + 1,
        material_id: materialId,
        storage_location_id: storageLocationId,
        stock_type: stockType,
        quantity,
        rate_per_unit: ratePerUnit,
        movement_type_code: deriveMovementType(stockType),
      })
      .select("*")
      .single();

    if (error || !data) {
      return openingStockErrorResponse(
        req,
        ctx,
        "OPENING_STOCK_LINE_CREATE_FAILED",
        500,
        "Unable to add opening stock line.",
      );
    }

    return okResponse(data, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "OPENING_STOCK_LINE_CREATE_FAILED";
    const status = code === "SA_REQUIRED"
      ? 403
      : code.includes("NOT_DRAFT")
      ? 409
      : code.includes("NOT_FOUND")
      ? 404
      : 500;
    return openingStockErrorResponse(req, ctx, code, status, code);
  }
}

export async function updateOpeningStockLineHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertSARole(ctx);
    const documentId = getDocumentIdFromPath(req);
    const lineId = getLineIdFromPath(req);
    const body = await parseBody(req);
    const document = await fetchOpeningStockDocument(documentId);
    ensureDraftDocument(document);

    const patch: JsonRecord = {};
    if (body.storage_location_id !== undefined) {
      patch.storage_location_id = toTrimmedString(body.storage_location_id);
    }
    if (body.quantity !== undefined) {
      const quantity = parsePositiveNumber(body.quantity);
      if (quantity === null) {
        return openingStockErrorResponse(req, ctx, "OPENING_STOCK_LINE_QUANTITY_INVALID", 400, "quantity must be > 0.");
      }
      patch.quantity = quantity;
    }
    if (body.rate_per_unit !== undefined) {
      const rate = Number(body.rate_per_unit);
      if (!Number.isFinite(rate) || rate < 0) {
        return openingStockErrorResponse(req, ctx, "OPENING_STOCK_LINE_RATE_INVALID", 400, "rate_per_unit must be >= 0.");
      }
      patch.rate_per_unit = rate;
    }
    if (body.stock_type !== undefined) {
      const stockType = toUpperTrimmedString(body.stock_type);
      if (!STOCK_TYPES.has(stockType)) {
        return openingStockErrorResponse(req, ctx, "OPENING_STOCK_STOCK_TYPE_INVALID", 400, "Invalid stock_type.");
      }
      patch.stock_type = stockType;
      patch.movement_type_code = deriveMovementType(stockType);
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("opening_stock_line")
      .update(patch)
      .eq("id", lineId)
      .eq("document_id", documentId)
      .select("*")
      .single();

    if (error || !data) {
      return openingStockErrorResponse(
        req,
        ctx,
        "OPENING_STOCK_LINE_UPDATE_FAILED",
        500,
        "Unable to update opening stock line.",
      );
    }

    return okResponse(data, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "OPENING_STOCK_LINE_UPDATE_FAILED";
    const status = code === "SA_REQUIRED"
      ? 403
      : code.includes("NOT_DRAFT")
      ? 409
      : code.includes("NOT_FOUND")
      ? 404
      : 500;
    return openingStockErrorResponse(req, ctx, code, status, code);
  }
}

export async function removeOpeningStockLineHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertSARole(ctx);
    const documentId = getDocumentIdFromPath(req);
    const lineId = getLineIdFromPath(req);
    const document = await fetchOpeningStockDocument(documentId);
    ensureDraftDocument(document);

    const { error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("opening_stock_line")
      .delete()
      .eq("id", lineId)
      .eq("document_id", documentId);

    if (error) {
      return openingStockErrorResponse(
        req,
        ctx,
        "OPENING_STOCK_LINE_DELETE_FAILED",
        500,
        "Unable to remove opening stock line.",
      );
    }

    return okResponse({ deleted: true }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "OPENING_STOCK_LINE_DELETE_FAILED";
    const status = code === "SA_REQUIRED"
      ? 403
      : code.includes("NOT_DRAFT")
      ? 409
      : code.includes("NOT_FOUND")
      ? 404
      : 500;
    return openingStockErrorResponse(req, ctx, code, status, code);
  }
}

export async function submitOpeningStockDocumentHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertSARole(ctx);
    const documentId = getDocumentIdFromPath(req);
    const document = await fetchOpeningStockDocument(documentId);
    if (toUpperTrimmedString(document.status) !== "DRAFT") {
      return openingStockErrorResponse(
        req,
        ctx,
        "OPENING_STOCK_DOCUMENT_SUBMIT_INVALID",
        409,
        "Only DRAFT opening stock documents can be submitted.",
      );
    }

    const lines = await fetchOpeningStockLines(documentId);
    if (lines.length === 0) {
      return openingStockErrorResponse(
        req,
        ctx,
        "OPENING_STOCK_DOCUMENT_SUBMIT_EMPTY",
        400,
        "At least one line is required before submission.",
      );
    }

    const { error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("opening_stock_document")
      .update({
        status: "SUBMITTED",
        submitted_by: ctx.auth_user_id,
        submitted_at: new Date().toISOString(),
      })
      .eq("id", documentId);

    if (error) {
      return openingStockErrorResponse(
        req,
        ctx,
        "OPENING_STOCK_DOCUMENT_SUBMIT_FAILED",
        500,
        "Unable to submit opening stock document.",
      );
    }

    return okResponse(await hydrateOpeningStockDocument(documentId), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "OPENING_STOCK_DOCUMENT_SUBMIT_FAILED";
    const status = code === "SA_REQUIRED" ? 403 : code.includes("NOT_FOUND") ? 404 : 500;
    return openingStockErrorResponse(req, ctx, code, status, code);
  }
}

export async function approveOpeningStockDocumentHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertSARole(ctx);
    const documentId = getDocumentIdFromPath(req);
    const document = await fetchOpeningStockDocument(documentId);
    if (toUpperTrimmedString(document.status) !== "SUBMITTED") {
      return openingStockErrorResponse(
        req,
        ctx,
        "OPENING_STOCK_DOCUMENT_APPROVE_INVALID",
        409,
        "Only SUBMITTED opening stock documents can be approved.",
      );
    }

    const { error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("opening_stock_document")
      .update({
        status: "APPROVED",
        approved_by: ctx.auth_user_id,
        approved_at: new Date().toISOString(),
      })
      .eq("id", documentId);

    if (error) {
      return openingStockErrorResponse(
        req,
        ctx,
        "OPENING_STOCK_DOCUMENT_APPROVE_FAILED",
        500,
        "Unable to approve opening stock document.",
      );
    }

    return okResponse(await hydrateOpeningStockDocument(documentId), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "OPENING_STOCK_DOCUMENT_APPROVE_FAILED";
    const status = code === "SA_REQUIRED" ? 403 : code.includes("NOT_FOUND") ? 404 : 500;
    return openingStockErrorResponse(req, ctx, code, status, code);
  }
}

export async function postOpeningStockDocumentHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertSARole(ctx);
    const documentId = getDocumentIdFromPath(req);
    const document = await fetchOpeningStockDocument(documentId);
    if (toUpperTrimmedString(document.status) !== "APPROVED") {
      return openingStockErrorResponse(
        req,
        ctx,
        "OPENING_STOCK_DOCUMENT_POST_INVALID",
        409,
        "Only APPROVED opening stock documents can be posted.",
      );
    }

    const lines = await fetchOpeningStockLines(documentId);
    if (lines.length === 0) {
      return openingStockErrorResponse(
        req,
        ctx,
        "OPENING_STOCK_DOCUMENT_POST_EMPTY",
        400,
        "At least one line is required before posting.",
      );
    }

    for (const line of lines) {
      if (line.posted_stock_document_id) {
        continue;
      }

      const baseUomCode = await fetchMaterialBaseUom(String(line.material_id));
      const rpcResult = await serviceRoleClient
        .schema("erp_inventory")
        .rpc("post_stock_movement", {
          p_document_number: document.document_number,
          p_document_date: document.cut_off_date,
          p_posting_date: document.cut_off_date,
          p_movement_type_code: line.movement_type_code,
          p_company_id: document.company_id,
          p_plant_id: document.plant_id,
          p_storage_location_id: line.storage_location_id,
          p_material_id: line.material_id,
          p_quantity: line.quantity,
          p_base_uom_code: baseUomCode,
          p_unit_value: line.rate_per_unit,
          p_stock_type_code: line.stock_type,
          p_direction: "IN",
          p_posted_by: ctx.auth_user_id,
          p_reversal_of_id: null,
        });

      if (rpcResult.error || !Array.isArray(rpcResult.data) || rpcResult.data.length === 0) {
        return openingStockErrorResponse(
          req,
          ctx,
          "OPENING_STOCK_POST_RPC_FAILED",
          500,
          "Unable to post opening stock line to inventory ledger.",
        );
      }

      const postingRow = rpcResult.data[0] as JsonRecord;
      const { error: lineUpdateError } = await serviceRoleClient
        .schema("erp_procurement")
        .from("opening_stock_line")
        .update({
          posted_stock_document_id: postingRow.stock_document_id ?? null,
        })
        .eq("id", String(line.id));

      if (lineUpdateError) {
        return openingStockErrorResponse(
          req,
          ctx,
          "OPENING_STOCK_LINE_POST_UPDATE_FAILED",
          500,
          "Unable to update opening stock line posting reference.",
        );
      }
    }

    const { error: documentUpdateError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("opening_stock_document")
      .update({
        status: "POSTED",
        posted_by: ctx.auth_user_id,
        posted_at: new Date().toISOString(),
      })
      .eq("id", documentId);

    if (documentUpdateError) {
      return openingStockErrorResponse(
        req,
        ctx,
        "OPENING_STOCK_DOCUMENT_POST_FAILED",
        500,
        "Unable to update opening stock document posting status.",
      );
    }

    return okResponse(await hydrateOpeningStockDocument(documentId), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "OPENING_STOCK_DOCUMENT_POST_FAILED";
    const status = code === "SA_REQUIRED" ? 403 : code.includes("NOT_FOUND") ? 404 : 500;
    return openingStockErrorResponse(req, ctx, code, status, code);
  }
}
