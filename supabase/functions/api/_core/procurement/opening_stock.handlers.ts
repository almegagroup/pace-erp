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
import { isGlobalAdmin, isSuperAdmin } from "../../_shared/role_ladder.ts";
import { generateMaterialDocNumber } from "../../_shared/materialDocument.ts";
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
const CURRENCY_CODES = new Set(["INR", "USD"]);
const OPENING_STOCK_MATERIAL_TYPES = new Set(["RM", "PM", "INT", "SFG", "FG"]);
const OPENING_STOCK_PO_TYPES = new Set(["MTO", "HPS", "MTS", "MTEST"]);

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

const MANAGER_OR_SA_ROLES = new Set(["SA", "GA", "DIRECTOR", "L4_MANAGER", "L3_MANAGER", "L2_MANAGER"]);

function assertManagerOrSARole(ctx: ProcurementHandlerContext): void {
  if (!MANAGER_OR_SA_ROLES.has(ctx.roleCode)) {
    throw new Error("MANAGER_OR_SA_REQUIRED");
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

async function attachRecalculationFlags(_companyId: string, lines: OpeningStockLineRow[]): Promise<OpeningStockLineRow[]> {
  if (lines.length === 0) return lines;

  // §109 — the one-time-use lock now keys on the specific ledger row
  // (target_ledger_id), not the material overall (a material can have many
  // correctable events over its lifetime once SFG/FG cascade exists). Each
  // opening line's own ledger row is the IN posting created when it was
  // posted (posted_stock_document_id -> stock_ledger).
  const documentIds = [...new Set(lines.map((line) => toTrimmedString(line.posted_stock_document_id)).filter(Boolean))];
  if (documentIds.length === 0) return lines.map((line) => ({ ...line, already_recalculated: false }));

  const { data: ledgerRows, error: ledgerErr } = await serviceRoleClient
    .schema("erp_inventory")
    .from("stock_ledger")
    .select("id, stock_document_id")
    .in("stock_document_id", documentIds)
    .eq("direction", "IN");
  if (ledgerErr) throw new Error("OPENING_STOCK_RECALC_FLAG_LOOKUP_FAILED");

  const ledgerIdByDocumentId = new Map(
    ((ledgerRows ?? []) as JsonRecord[]).map((row) => [String(row.stock_document_id), String(row.id)]),
  );
  const ledgerIds = [...ledgerIdByDocumentId.values()];
  if (ledgerIds.length === 0) return lines.map((line) => ({ ...line, already_recalculated: false }));

  const { data: logRows, error: logErr } = await serviceRoleClient
    .schema("erp_inventory")
    .from("valuation_correction_log")
    .select("target_ledger_id")
    .in("target_ledger_id", ledgerIds);
  if (logErr) throw new Error("OPENING_STOCK_RECALC_FLAG_LOOKUP_FAILED");

  const doneLedgerIds = new Set(((logRows ?? []) as JsonRecord[]).map((row) => String(row.target_ledger_id)));

  return lines.map((line) => {
    const ledgerId = ledgerIdByDocumentId.get(toTrimmedString(line.posted_stock_document_id));
    return { ...line, already_recalculated: Boolean(ledgerId && doneLedgerIds.has(ledgerId)) };
  });
}

async function hydrateOpeningStockDocument(documentId: string): Promise<JsonRecord> {
  const [document, rawLines] = await Promise.all([
    fetchOpeningStockDocument(documentId),
    fetchOpeningStockLines(documentId),
  ]);

  const lines = document.status === "POSTED"
    ? await attachRecalculationFlags(String(document.company_id), rawLines)
    : rawLines;

  const totals = lines.reduce(
    (accumulator: { total_lines: number; total_value: number }, line) => {
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

async function fetchMaterialType(materialId: string): Promise<string> {
  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("material_master")
    .select("material_type")
    .eq("id", materialId)
    .single();

  if (error || !data?.material_type) {
    throw new Error("OPENING_STOCK_MATERIAL_NOT_FOUND");
  }

  return toUpperTrimmedString(data.material_type);
}

async function fetchMaterialTypesByIds(materialIds: string[]): Promise<Map<string, string>> {
  const uniqueIds = [...new Set(materialIds.map((id) => toTrimmedString(id)).filter(Boolean))];
  if (uniqueIds.length === 0) {
    return new Map();
  }

  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("material_master")
    .select("id, material_type")
    .in("id", uniqueIds);

  if (error) {
    throw new Error("OPENING_STOCK_MATERIAL_FETCH_FAILED");
  }

  return new Map(
    (data ?? [])
      .filter((row: JsonRecord) => row?.id && row?.material_type)
      .map((row: JsonRecord) => [toTrimmedString(row.id), toUpperTrimmedString(row.material_type)]),
  );
}

function ensureDraftDocument(document: OpeningStockDocumentRow): void {
  if (toUpperTrimmedString(document.status) !== "DRAFT") {
    throw new Error("OPENING_STOCK_DOCUMENT_NOT_DRAFT");
  }
}

function ensureSubmittedDocument(document: OpeningStockDocumentRow): void {
  if (toUpperTrimmedString(document.status) !== "SUBMITTED") {
    throw new Error("OPENING_STOCK_DOCUMENT_NOT_SUBMITTED");
  }
}

function ensureDocumentMaterialScope(document: OpeningStockDocumentRow, materialType: string): void {
  if (toUpperTrimmedString(document.material_type) !== materialType) {
    throw new Error("OPENING_STOCK_DOCUMENT_MATERIAL_SCOPE_MISMATCH");
  }
}

function isAdminBypass(ctx: ProcurementHandlerContext): boolean {
  return ctx.context.isAdmin === true || isSuperAdmin(ctx.roleCode) || isGlobalAdmin(ctx.roleCode);
}

async function assertOpeningStockCompanyScope(
  ctx: ProcurementHandlerContext,
  companyId: string,
): Promise<void> {
  if (isAdminBypass(ctx)) {
    return;
  }

  const normalizedCompanyId = toTrimmedString(companyId);
  if (!normalizedCompanyId) {
    throw new Error("OPENING_STOCK_SCOPE_VIOLATION");
  }

  // Matches the trust model every other create flow in this codebase already uses
  // (e.g. Process PO's own Company dropdown) - any company the user is assigned to
  // via erp_map.user_companies is fair game, not just their current active session
  // context. A user with 4 companies (e.g. DIRECTOR) must be able to create for any
  // of the 4 without first "switching" anything - there is no such switcher today.
  const { data, error } = await serviceRoleClient
    .schema("erp_map")
    .from("user_companies")
    .select("company_id")
    .eq("auth_user_id", ctx.auth_user_id)
    .eq("company_id", normalizedCompanyId)
    .maybeSingle();

  if (error || !data) {
    throw new Error("OPENING_STOCK_SCOPE_VIOLATION");
  }
}

export async function createOpeningStockDocumentHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const body = await parseBody(req);
    const companyId = toTrimmedString(body.company_id);
    const cutOffDate = toTrimmedString(body.cut_off_date);
    const currencyCode = toUpperTrimmedString(body.currency_code || "INR") || "INR";
    const materialType = toUpperTrimmedString(body.material_type);
    const poType = toUpperTrimmedString(body.po_type) || null;
    const notes = toTrimmedString(body.notes);

    if (!companyId || !cutOffDate || !materialType) {
      return openingStockErrorResponse(
        req,
        ctx,
        "OPENING_STOCK_DOCUMENT_CREATE_INVALID",
        400,
        "company_id, cut_off_date, and material_type are required.",
      );
    }

    if (!CURRENCY_CODES.has(currencyCode)) {
      return openingStockErrorResponse(
        req,
        ctx,
        "OPENING_STOCK_CURRENCY_INVALID",
        400,
        "currency_code must be INR or USD.",
      );
    }

    if (!OPENING_STOCK_MATERIAL_TYPES.has(materialType)) {
      return openingStockErrorResponse(
        req,
        ctx,
        "OPENING_STOCK_MATERIAL_TYPE_INVALID",
        400,
        "material_type must be RM, PM, INT, SFG, or FG.",
      );
    }

    if (materialType === "SFG" || materialType === "FG") {
      if (!poType || !OPENING_STOCK_PO_TYPES.has(poType)) {
        return openingStockErrorResponse(
          req,
          ctx,
          "OPENING_STOCK_PO_TYPE_INVALID",
          400,
          "po_type must be MTO, HPS, MTS, or MTEST for SFG/FG opening stock documents.",
        );
      }
    } else if (poType) {
      return openingStockErrorResponse(
        req,
        ctx,
        "OPENING_STOCK_PO_TYPE_INVALID",
        400,
        "po_type is allowed only for SFG/FG opening stock documents.",
      );
    }

    await assertOpeningStockCompanyScope(ctx, companyId);

    let existingQuery = serviceRoleClient
      .schema("erp_procurement")
      .from("opening_stock_document")
      .select("id")
      .eq("company_id", companyId)
      .eq("cut_off_date", cutOffDate)
      .eq("material_type", materialType);

    existingQuery = poType === null ? existingQuery.is("po_type", null) : existingQuery.eq("po_type", poType);

    const { data: existing, error: existingError } = await existingQuery.maybeSingle();

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
        "An opening stock document already exists for this company and cut-off date.",
      );
    }

    const documentNumber = await generateProcurementDocNumber("OS");
    const { data, error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("opening_stock_document")
      .insert({
        document_number: documentNumber,
        company_id: companyId,
        cut_off_date: cutOffDate,
        currency_code: currencyCode,
        material_type: materialType,
        po_type: poType,
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
    const status = code === "SA_REQUIRED" || code === "OPENING_STOCK_SCOPE_VIOLATION" ? 403 : 500;
    return openingStockErrorResponse(req, ctx, code, status, code);
  }
}

export async function listOpeningStockDocumentsHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
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
    assertManagerOrSARole(ctx);
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

export async function getOpeningStockDocumentByNumberHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const url = new URL(req.url);
    const documentNumber = toTrimmedString(url.searchParams.get("document_number"));
    if (!documentNumber) {
      return openingStockErrorResponse(
        req,
        ctx,
        "OPENING_STOCK_DOCUMENT_NUMBER_REQUIRED",
        400,
        "document_number is required.",
      );
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("opening_stock_document")
      .select("id")
      .eq("document_number", documentNumber)
      .maybeSingle();

    if (error) {
      return openingStockErrorResponse(
        req,
        ctx,
        "OPENING_STOCK_DOCUMENT_FETCH_FAILED",
        500,
        "Unable to fetch opening stock document.",
      );
    }

    const documentId = toTrimmedString(data?.id);
    if (!documentId) {
      return openingStockErrorResponse(
        req,
        ctx,
        "OPENING_STOCK_DOCUMENT_NOT_FOUND",
        404,
        "Opening stock document not found.",
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
    assertManagerOrSARole(ctx);
    const documentId = getDocumentIdFromPath(req);
    const body = await parseBody(req);
    const materialId = toTrimmedString(body.material_id);
    const storageLocationId = toTrimmedString(body.storage_location_id);
    const stockType = toUpperTrimmedString(body.stock_type);
    const batchNumber = toTrimmedString(body.batch_number) || null;
    const isZeroStock = body.is_zero_stock === true;
    const quantity = isZeroStock ? 0 : parsePositiveNumber(body.quantity);
    const ratePerUnit = parseNonNegativeNumber(body.rate_per_unit) ?? 0;
    const enteredUomCode = toTrimmedString(body.entered_uom_code) || null;
    const enteredQuantity = parseNonNegativeNumber(body.entered_quantity);

    if (!documentId || !materialId || !storageLocationId || !stockType || quantity === null) {
      return openingStockErrorResponse(
        req,
        ctx,
        "OPENING_STOCK_LINE_CREATE_INVALID",
        400,
        "material_id, storage_location_id, stock_type, and quantity are required (quantity may be 0 only when is_zero_stock is true).",
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
    const materialType = await fetchMaterialType(materialId);
    ensureDocumentMaterialScope(document, materialType);
    const normalizedBatchNumber = materialType === "SFG" || materialType === "FG" ? batchNumber : null;

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
        is_zero_stock: isZeroStock,
        entered_uom_code: enteredUomCode,
        entered_quantity: enteredQuantity,
        batch_number: normalizedBatchNumber,
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
      : code === "OPENING_STOCK_DOCUMENT_MATERIAL_SCOPE_MISMATCH"
      ? 409
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
    assertManagerOrSARole(ctx);
    const documentId = getDocumentIdFromPath(req);
    const lineId = getLineIdFromPath(req);
    const body = await parseBody(req);
    const document = await fetchOpeningStockDocument(documentId);
    ensureDraftDocument(document);

    const patch: JsonRecord = {};
    if (body.is_zero_stock !== undefined) {
      patch.is_zero_stock = body.is_zero_stock === true;
    }
    if (body.storage_location_id !== undefined) {
      patch.storage_location_id = toTrimmedString(body.storage_location_id);
    }
    if (body.quantity !== undefined) {
      const isZeroStock = patch.is_zero_stock === true;
      const quantity = isZeroStock ? 0 : parsePositiveNumber(body.quantity);
      if (quantity === null) {
        return openingStockErrorResponse(req, ctx, "OPENING_STOCK_LINE_QUANTITY_INVALID", 400, "quantity must be > 0 (or 0 when is_zero_stock is true).");
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
    if (body.entered_uom_code !== undefined) {
      patch.entered_uom_code = toTrimmedString(body.entered_uom_code) || null;
    }
    if (body.entered_quantity !== undefined) {
      patch.entered_quantity = parseNonNegativeNumber(body.entered_quantity);
    }
    if (body.batch_number !== undefined) {
      const { data: existingLine, error: existingLineError } = await serviceRoleClient
        .schema("erp_procurement")
        .from("opening_stock_line")
        .select("material_id")
        .eq("id", lineId)
        .eq("document_id", documentId)
        .single();

      if (existingLineError || !existingLine?.material_id) {
        return openingStockErrorResponse(
          req,
          ctx,
          "OPENING_STOCK_LINE_NOT_FOUND",
          404,
          "Opening stock line not found.",
        );
      }

      const materialType = await fetchMaterialType(String(existingLine.material_id));
      patch.batch_number = materialType === "SFG" || materialType === "FG"
        ? toTrimmedString(body.batch_number) || null
        : null;
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
    assertManagerOrSARole(ctx);
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

export async function batchUpdateOpeningStockLinesHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const documentId = getDocumentIdFromPath(req);
    const body = await parseBody(req);
    const linePatches = Array.isArray(body.lines) ? body.lines : [];

    if (!documentId || linePatches.length === 0) {
      return openingStockErrorResponse(
        req,
        ctx,
        "OPENING_STOCK_BATCH_UPDATE_INVALID",
        400,
        "document id and at least one line are required.",
      );
    }

    const document = await fetchOpeningStockDocument(documentId);
    ensureSubmittedDocument(document);

    const lineIds = linePatches
      .map((line) => toTrimmedString((line as JsonRecord).id))
      .filter(Boolean);

    let existingRows: OpeningStockLineRow[] = [];
    if (lineIds.length > 0) {
      const { data, error: existingError } = await serviceRoleClient
        .schema("erp_procurement")
        .from("opening_stock_line")
        .select("*")
        .eq("document_id", documentId)
        .in("id", lineIds);

      if (existingError) {
        return openingStockErrorResponse(
          req,
          ctx,
          "OPENING_STOCK_LINE_FETCH_FAILED",
          500,
          "Unable to load opening stock lines.",
        );
      }

      existingRows = (data ?? []) as OpeningStockLineRow[];
    }

    const existingById = new Map(
      existingRows.map((row) => [toTrimmedString(row.id), row]),
    );
    const materialTypesById = await fetchMaterialTypesByIds(
      linePatches.map((line) => toTrimmedString((line as JsonRecord).material_id)),
    );

    if (existingById.size !== lineIds.length) {
      return openingStockErrorResponse(
        req,
        ctx,
        "OPENING_STOCK_LINE_NOT_FOUND",
        404,
        "One or more opening stock lines were not found.",
      );
    }

    const updates: JsonRecord[] = [];
    const inserts: JsonRecord[] = [];
    let nextLineNumber = 0;

    if (linePatches.some((line) => !toTrimmedString((line as JsonRecord).id))) {
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

      nextLineNumber = Number(lastLine?.line_number ?? 0);
    }

    for (const rawLine of linePatches) {
      const patch = rawLine as JsonRecord;
      const lineId = toTrimmedString(patch.id);
      const existing = lineId ? existingById.get(lineId) : null;
      if (lineId && !existing) {
        return openingStockErrorResponse(
          req,
          ctx,
          "OPENING_STOCK_LINE_NOT_FOUND",
          404,
          "One or more opening stock lines were not found.",
        );
      }

      const stockType = toUpperTrimmedString(patch.stock_type || existing?.stock_type);
      if (!STOCK_TYPES.has(stockType)) {
        return openingStockErrorResponse(req, ctx, "OPENING_STOCK_STOCK_TYPE_INVALID", 400, "Invalid stock_type.");
      }

      const isZeroStock = patch.is_zero_stock !== undefined
        ? patch.is_zero_stock === true
        : existing?.is_zero_stock === true;
      const quantitySource = patch.quantity !== undefined ? patch.quantity : existing?.quantity;
      const quantity = isZeroStock ? 0 : parsePositiveNumber(quantitySource);
      if (quantity === null) {
        return openingStockErrorResponse(
          req,
          ctx,
          "OPENING_STOCK_LINE_QUANTITY_INVALID",
          400,
          "quantity must be > 0 (or 0 when is_zero_stock is true).",
        );
      }

      const rate = parseNonNegativeNumber(
        patch.rate_per_unit !== undefined ? patch.rate_per_unit : existing?.rate_per_unit,
      );
      if (rate === null) {
        return openingStockErrorResponse(req, ctx, "OPENING_STOCK_LINE_RATE_INVALID", 400, "rate_per_unit must be >= 0.");
      }

      const materialId = toTrimmedString(patch.material_id || existing?.material_id);
      const storageLocationId = toTrimmedString(patch.storage_location_id || existing?.storage_location_id);
      if (!materialId || !storageLocationId) {
        return openingStockErrorResponse(
          req,
          ctx,
          "OPENING_STOCK_BATCH_UPDATE_INVALID",
          400,
          "material_id and storage_location_id are required for every saved line.",
        );
      }

      const materialType = materialTypesById.get(materialId) ?? await fetchMaterialType(materialId);
      ensureDocumentMaterialScope(document, materialType);
      const enteredUomCode = patch.entered_uom_code !== undefined
        ? toTrimmedString(patch.entered_uom_code) || null
        : toTrimmedString(existing?.entered_uom_code) || null;
      const enteredQuantity = patch.entered_quantity !== undefined
        ? parseNonNegativeNumber(patch.entered_quantity)
        : parseNonNegativeNumber(existing?.entered_quantity);
      const batchNumber = materialType === "SFG" || materialType === "FG"
        ? (
          patch.batch_number !== undefined
            ? toTrimmedString(patch.batch_number) || null
            : toTrimmedString(existing?.batch_number) || null
        )
        : null;

      const normalizedLine = {
        document_id: documentId,
        material_id: materialId,
        storage_location_id: storageLocationId,
        stock_type: stockType,
        quantity,
        rate_per_unit: rate,
        entered_uom_code: enteredUomCode,
        entered_quantity: enteredQuantity ?? quantity,
        batch_number: batchNumber,
        is_zero_stock: isZeroStock,
        movement_type_code: deriveMovementType(stockType),
      };

      if (lineId && existing) {
        updates.push({
          id: lineId,
          line_number: existing.line_number,
          ...normalizedLine,
        });
      } else {
        nextLineNumber += 1;
        inserts.push({
          line_number: nextLineNumber,
          ...normalizedLine,
        });
      }
    }

    if (updates.length > 0) {
      const { error: updateError } = await serviceRoleClient
        .schema("erp_procurement")
        .from("opening_stock_line")
        .upsert(updates, { onConflict: "id" });

      if (updateError) {
        return openingStockErrorResponse(
          req,
          ctx,
          "OPENING_STOCK_LINE_BATCH_UPDATE_FAILED",
          500,
          "Unable to save opening stock line corrections.",
        );
      }
    }

    if (inserts.length > 0) {
      const { error: insertError } = await serviceRoleClient
        .schema("erp_procurement")
        .from("opening_stock_line")
        .insert(inserts);

      if (insertError) {
        return openingStockErrorResponse(
          req,
          ctx,
          "OPENING_STOCK_LINE_CREATE_FAILED",
          500,
          "Unable to add new opening stock lines during correction.",
        );
      }
    }

    return okResponse(await hydrateOpeningStockDocument(documentId), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "OPENING_STOCK_LINE_BATCH_UPDATE_FAILED";
    const status = code === "SA_REQUIRED"
      ? 403
      : code === "OPENING_STOCK_DOCUMENT_MATERIAL_SCOPE_MISMATCH"
      ? 409
      : code.includes("NOT_SUBMITTED")
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
    assertManagerOrSARole(ctx);
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
    assertManagerOrSARole(ctx);
    const documentId = getDocumentIdFromPath(req);
    const document = await fetchOpeningStockDocument(documentId);
    await assertOpeningStockCompanyScope(ctx, toTrimmedString(document.company_id));
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
    const status = code === "SA_REQUIRED" || code === "OPENING_STOCK_SCOPE_VIOLATION" ? 403 : code.includes("NOT_FOUND") ? 404 : 500;
    return openingStockErrorResponse(req, ctx, code, status, code);
  }
}

export async function postOpeningStockDocumentHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
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

    // §106: one Material Document (MBLNR+MJAHR) per posting event; the OS business number
    // becomes the reference. Generated once, shared by every line's ledger item.
    const matDoc = await generateMaterialDocNumber(String(document.company_id));

    // DEPENDENT: each line posts opening stock and writes back its posting reference, so stock ledger order must remain stable.
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
          p_storage_location_id: line.storage_location_id,
          p_material_id: line.material_id,
          p_quantity: line.quantity,
          p_base_uom_code: baseUomCode,
          p_unit_value: line.rate_per_unit,
          p_stock_type_code: line.stock_type,
          p_direction: "IN",
          p_posted_by: ctx.auth_user_id,
          p_reversal_of_id: null,
          p_batch_number: toTrimmedString(line.batch_number) || null,
          p_material_doc_number: matDoc.docNumber,
          p_material_doc_year: matDoc.docYear,
          p_reference_document_number: document.document_number,
          p_reference_document_type: "OS",
          p_reference_document_id: document.id ?? null,
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

type CascadeNode = { ledgerId: string; newRate: number };
type CascadeStepResult = {
  ledgerId: string;
  ok: boolean;
  materialId?: string;
  oldRate?: number;
  newRate?: number;
  error?: string;
};

async function callRecalculateAtRow(
  ledgerId: string,
  newRate: number,
  actor: string,
  reason: string,
): Promise<{ data: JsonRecord | null; error: string | null }> {
  const { data, error } = await serviceRoleClient
    .schema("erp_inventory")
    .rpc("recalculate_valuation_at_row", {
      p_target_ledger_id: ledgerId,
      p_new_rate: newRate,
      p_actor: actor,
      p_reason: reason,
    });
  if (error) return { data: null, error: error.message };
  return { data: data as JsonRecord, error: null };
}

// §109 — one Process PO line or one Packing PO line's stock_ledger_id may be
// the impacted row; whichever it is determines whether the downstream cost
// recompute is §104-2's (SFG) or §104-3's (FG) formula. A third case (found
// by testing against a real live PO in Dev, 930008): the impacted row can
// also be the QI-release-OUT leg of Verify's own P321 (§83.5 — Verify IS the
// QA release, no separate screen). That leg matches neither line table — the
// release's IN-to-UNRESTRICTED sibling (process_order.qi_release_stock_ledger_id)
// is a DIFFERENT stock_ledger row (own stock_document, per post_document's
// one-document-per-direction pattern) that must get the SAME rate passed
// through, not recomputed — it's the same value moving stock_type, not a new
// cost. Only resolvable via the impacted row's own reference_document_id
// (§106 tagging) — legacy untagged rows (pre-17 July) can't cascade through
// this leg, a known accepted gap (CLAUDE.md §104).
async function findDownstreamGroup(
  impacted: JsonRecord,
): Promise<
  | { kind: "PROCESS_PO"; documentId: string; fgLedgerId: string | null }
  | { kind: "PACKING_PO"; documentId: string; fgLedgerId: string | null }
  | { kind: "PASSTHROUGH"; targetLedgerId: string }
  | null
> {
  const impactedLedgerId = toTrimmedString(impacted.stock_ledger_id);

  const { data: poLine } = await serviceRoleClient
    .schema("erp_production")
    .from("process_order_line")
    .select("process_order_id")
    .eq("stock_ledger_id", impactedLedgerId)
    .maybeSingle();
  if (poLine?.process_order_id) {
    const { data: po } = await serviceRoleClient
      .schema("erp_production")
      .from("process_order")
      .select("fg_stock_ledger_id")
      .eq("id", poLine.process_order_id)
      .maybeSingle();
    return { kind: "PROCESS_PO", documentId: String(poLine.process_order_id), fgLedgerId: (po?.fg_stock_ledger_id as string | null) ?? null };
  }

  const { data: packLine } = await serviceRoleClient
    .schema("erp_production")
    .from("packing_order_line")
    .select("packing_order_id")
    .eq("stock_ledger_id", impactedLedgerId)
    .maybeSingle();
  if (packLine?.packing_order_id) {
    const { data: fgLine } = await serviceRoleClient
      .schema("erp_production")
      .from("packing_order_line")
      .select("stock_ledger_id")
      .eq("packing_order_id", packLine.packing_order_id)
      .eq("line_type", "FG")
      .maybeSingle();
    return { kind: "PACKING_PO", documentId: String(packLine.packing_order_id), fgLedgerId: (fgLine?.stock_ledger_id as string | null) ?? null };
  }

  if (toTrimmedString(impacted.reference_document_type) === "PROC_PO" && toTrimmedString(impacted.reference_document_id)) {
    const { data: po } = await serviceRoleClient
      .schema("erp_production")
      .from("process_order")
      .select("qi_release_stock_ledger_id")
      .eq("id", toTrimmedString(impacted.reference_document_id))
      .maybeSingle();
    if (po?.qi_release_stock_ledger_id) {
      return { kind: "PASSTHROUGH", targetLedgerId: String(po.qi_release_stock_ledger_id) };
    }
  }

  return null; // no known downstream (RTV/STO/legacy untagged rows/etc.) — leaf, nothing more to cascade
}

// §109 full cascade — one click corrects the root material(s), then walks
// impacted OUT-rows level by level (RM/PM -> SFG -> FG), grouping every
// impacted row that shares a downstream Process/Packing PO before
// recomputing that PO's cost ONCE with every relevant correction applied
// together. This grouping matters: correcting two RM lines that both feed
// the same batch in the same action and recomputing that batch's SFG cost
// one line at a time would silently apply only whichever line's cascade
// got there first (one-time-use blocks the second) — the multi-line-aware
// recompute_sfg_cost/recompute_fg_cost + this per-level grouping is what
// makes "system corrects everything automatically" actually correct.
async function cascadeRecalculate(
  roots: CascadeNode[],
  actor: string,
  reason: string,
): Promise<CascadeStepResult[]> {
  const results: CascadeStepResult[] = [];
  let levelImpacted: JsonRecord[] = [];

  for (const root of roots) {
    const { data, error } = await callRecalculateAtRow(root.ledgerId, root.newRate, actor, reason);
    if (error) {
      results.push({ ledgerId: root.ledgerId, ok: false, error });
      continue;
    }
    results.push({
      ledgerId: root.ledgerId, ok: true,
      materialId: toTrimmedString(data?.material_id),
      oldRate: Number(data?.old_rate), newRate: Number(data?.new_rate),
    });
    levelImpacted.push(...((data?.impacted_rows as JsonRecord[]) ?? []));
  }

  while (levelImpacted.length > 0) {
    const processGroups = new Map<string, { fgLedgerId: string | null; corrections: JsonRecord[] }>();
    const packGroups = new Map<string, { fgLedgerId: string | null; corrections: JsonRecord[] }>();
    const nextRoots: CascadeNode[] = [];

    for (const impacted of levelImpacted) {
      const impactedLedgerId = toTrimmedString(impacted.stock_ledger_id);
      if (!impactedLedgerId) continue;
      const group = await findDownstreamGroup(impacted);
      if (!group) continue;
      if (group.kind === "PASSTHROUGH") {
        // Same value, different stock_type bucket (P321 release) — no cost
        // recompute, just carry the corrected rate through.
        nextRoots.push({ ledgerId: group.targetLedgerId, newRate: Number(impacted.corrected_rate) });
        continue;
      }
      const correction = { stock_ledger_id: impactedLedgerId, corrected_rate: Number(impacted.corrected_rate) };
      const target = group.kind === "PROCESS_PO" ? processGroups : packGroups;
      if (!target.has(group.documentId)) target.set(group.documentId, { fgLedgerId: group.fgLedgerId, corrections: [] });
      target.get(group.documentId)!.corrections.push(correction);
    }

    for (const [processOrderId, group] of processGroups) {
      if (!group.fgLedgerId) continue;
      const { data: rate, error } = await serviceRoleClient
        .schema("erp_production")
        .rpc("recompute_sfg_cost", { p_process_order_id: processOrderId, p_corrections: group.corrections });
      if (error || rate == null) continue;
      nextRoots.push({ ledgerId: group.fgLedgerId, newRate: Number(rate) });
    }
    for (const [packingOrderId, group] of packGroups) {
      if (!group.fgLedgerId) continue;
      const { data: rate, error } = await serviceRoleClient
        .schema("erp_production")
        .rpc("recompute_fg_cost", { p_packing_order_id: packingOrderId, p_corrections: group.corrections });
      if (error || rate == null) continue;
      nextRoots.push({ ledgerId: group.fgLedgerId, newRate: Number(rate) });
    }

    levelImpacted = [];
    for (const node of nextRoots) {
      const { data, error } = await callRecalculateAtRow(node.ledgerId, node.newRate, actor, reason);
      if (error) {
        // ALREADY_DONE here means a sibling correction in this same batch already
        // reached this exact SFG/FG row (e.g. two Packing POs sharing one Process
        // PO batch) — not a real failure, just nothing further to do from here.
        results.push({ ledgerId: node.ledgerId, ok: error === "VALUATION_RECALC_ALREADY_DONE", error });
        continue;
      }
      results.push({
        ledgerId: node.ledgerId, ok: true,
        materialId: toTrimmedString(data?.material_id),
        oldRate: Number(data?.old_rate), newRate: Number(data?.new_rate),
      });
      levelImpacted.push(...((data?.impacted_rows as JsonRecord[]) ?? []));
    }
  }

  return results;
}

// Opening Rate "Recalculate" (feasibility §109) — one action, fully
// automatic: corrects every filled-in Opening Stock line's own rate, then
// cascades RM/PM -> SFG -> FG without any further manual step, per business
// owner's explicit direction ("system does everything, user does nothing
// after clicking").
export async function recalculateValuationHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const body = await parseBody(req);
    const reason = toTrimmedString(body.reason);
    const lines = Array.isArray(body.lines) ? body.lines as JsonRecord[] : [];

    if (!reason) {
      return openingStockErrorResponse(req, ctx, "VALUATION_RECALC_REASON_REQUIRED", 400, "A reason is required for this correction.");
    }
    if (lines.length === 0) {
      return openingStockErrorResponse(req, ctx, "VALUATION_RECALC_INVALID", 400, "At least one line with a new_rate is required.");
    }

    const roots: (CascadeNode & { lineId: string })[] = [];
    for (const line of lines) {
      const lineId = toTrimmedString(line.line_id);
      const newRate = parseNonNegativeNumber(line.new_rate);
      const postedStockDocumentId = toTrimmedString(line.posted_stock_document_id);
      if (!lineId || newRate === null || !postedStockDocumentId) {
        return openingStockErrorResponse(req, ctx, "VALUATION_RECALC_INVALID", 400, "Each line requires line_id, posted_stock_document_id and a valid new_rate.");
      }
      const { data: ledgerRow, error: ledgerErr } = await serviceRoleClient
        .schema("erp_inventory")
        .from("stock_ledger")
        .select("id")
        .eq("stock_document_id", postedStockDocumentId)
        .eq("direction", "IN")
        .limit(1)
        .maybeSingle();
      if (ledgerErr || !ledgerRow?.id) {
        return openingStockErrorResponse(req, ctx, "VALUATION_RECALC_LEDGER_NOT_FOUND", 404, `Could not resolve the opening ledger row for line ${lineId}.`);
      }
      roots.push({ lineId, ledgerId: String(ledgerRow.id), newRate });
    }

    const results = await cascadeRecalculate(roots, ctx.auth_user_id, reason);

    // Keep each root opening_stock_line's own rate_per_unit in sync with the
    // corrected snapshot rate, so "Current Rate" reflects reality next load.
    await Promise.all(
      roots.map((root) => {
        const result = results.find((r) => r.ledgerId === root.ledgerId);
        if (!result?.ok || result.newRate === undefined) return Promise.resolve();
        return serviceRoleClient
          .schema("erp_procurement")
          .from("opening_stock_line")
          .update({ rate_per_unit: result.newRate })
          .eq("id", root.lineId);
      }),
    );

    return okResponse({ results }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "VALUATION_RECALC_FAILED";
    const status = code === "MANAGER_OR_SA_REQUIRED" ? 403 : 500;
    return openingStockErrorResponse(req, ctx, code, status, code);
  }
}
