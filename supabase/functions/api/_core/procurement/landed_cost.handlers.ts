/*
 * File-ID: 16.8.2
 * File-Path: supabase/functions/api/_core/procurement/landed_cost.handlers.ts
 * Gate: 16.8
 * Phase: 16
 * Domain: PROCUREMENT
 * Purpose: Landed cost draft, line maintenance, posting, and GRN lookup handlers.
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
type LandedCostRow = Record<string, unknown>;

const LC_STATUSES = new Set(["DRAFT", "POSTED"]);
const COST_TYPES = new Set([
  "FREIGHT",
  "INSURANCE",
  "CUSTOMS_DUTY",
  "CHA_CHARGES",
  "LOADING",
  "UNLOADING",
  "PORT_CHARGES",
  "OTHER",
]);

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

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function getPathSegments(req: Request): string[] {
  return new URL(req.url).pathname.split("/").filter(Boolean);
}

function getIdFromPath(req: Request): string {
  return getPathSegments(req)[3] ?? "";
}

function getLineIdFromPath(req: Request): string {
  return getPathSegments(req)[5] ?? "";
}

function getGrnIdFromByGrnPath(req: Request): string {
  return getPathSegments(req)[5] ?? "";
}

function lcErrorResponse(
  req: Request,
  ctx: ProcurementHandlerContext,
  code: string,
  status: number,
  message: string,
): Response {
  return errorResponse(code, message, ctx.request_id, "NONE", status, {}, req);
}

function assertAccountsRole(_ctx: ProcurementHandlerContext): void {
  // Protected by upstream pipeline/ACL layer.
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

async function fetchLandedCost(lcId: string): Promise<LandedCostRow> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("landed_cost")
    .select("*")
    .eq("id", lcId)
    .single();

  if (error || !data) {
    throw new Error("LC_NOT_FOUND");
  }

  return data as LandedCostRow;
}

function assertLcVisibleToContext(ctx: ProcurementHandlerContext, lc: LandedCostRow): void {
  const scopedCompanyId = toTrimmedString(ctx.context.companyId);
  if (scopedCompanyId && scopedCompanyId !== toTrimmedString(lc.company_id)) {
    throw new Error("LC_SCOPE_VIOLATION");
  }
}

async function fetchLandedCostLines(lcId: string): Promise<JsonRecord[]> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("landed_cost_line")
    .select("*")
    .eq("lc_id", lcId)
    .order("line_number", { ascending: true });

  if (error) {
    throw new Error("LC_LINE_FETCH_FAILED");
  }

  return (data ?? []) as JsonRecord[];
}

async function hydrateLandedCost(
  lcId: string,
  ctx?: ProcurementHandlerContext,
): Promise<JsonRecord> {
  const lc = await fetchLandedCost(lcId);
  if (ctx) {
    assertLcVisibleToContext(ctx, lc);
  }
  const lines = await fetchLandedCostLines(lcId);
  return { ...lc, lines };
}

export async function createLandedCostHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertAccountsRole(ctx);
    const body = await parseBody(req);
    const companyId = getCompanyScope(ctx, toTrimmedString(body.company_id));
    const vendorId = toTrimmedString(body.vendor_id);
    const grnId = toTrimmedString(body.grn_id) || null;
    const csnId = toTrimmedString(body.csn_id) || null;

    if (!companyId || !vendorId) {
      return lcErrorResponse(req, ctx, "LC_CREATE_INVALID", 400, "company_id and vendor_id are required.");
    }

    if (!grnId && !csnId) {
      return lcErrorResponse(req, ctx, "LC_REFERENCE_REQUIRED", 400, "At least one of grn_id or csn_id is required.");
    }

    const lcNumber = await generateProcurementDocNumber("LC");
    const { data, error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("landed_cost")
      .insert({
        lc_number: lcNumber,
        lc_date: toTrimmedString(body.lc_date) || todayIsoDate(),
        company_id: companyId,
        vendor_id: vendorId,
        grn_id: grnId,
        csn_id: csnId,
        po_id: toTrimmedString(body.po_id) || null,
        status: "DRAFT",
        remarks: toTrimmedString(body.remarks) || null,
        created_by: ctx.auth_user_id,
      })
      .select("*")
      .single();

    if (error || !data) {
      return lcErrorResponse(req, ctx, "LC_CREATE_FAILED", 500, "Unable to create landed cost draft.");
    }

    return okResponse(await hydrateLandedCost(String(data.id), ctx), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "LC_CREATE_FAILED";
    return lcErrorResponse(req, ctx, code, 500, code);
  }
}

export async function listLandedCostsHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertAccountsRole(ctx);
    const url = new URL(req.url);
    const companyId = getCompanyScope(ctx, url.searchParams.get("company_id") ?? undefined);
    const grnId = toTrimmedString(url.searchParams.get("grn_id"));
    const csnId = toTrimmedString(url.searchParams.get("csn_id"));
    const status = toUpperTrimmedString(url.searchParams.get("status"));
    const limit = parsePositiveInt(url.searchParams.get("limit"), 50);

    let query = serviceRoleClient
      .schema("erp_procurement")
      .from("landed_cost")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (companyId) query = query.eq("company_id", companyId);
    if (grnId) query = query.eq("grn_id", grnId);
    if (csnId) query = query.eq("csn_id", csnId);
    if (status && LC_STATUSES.has(status)) query = query.eq("status", status);

    const { data, error } = await query;
    if (error) {
      return lcErrorResponse(req, ctx, "LC_LIST_FAILED", 500, "Unable to list landed cost documents.");
    }

    return okResponse({ items: data ?? [] }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "LC_LIST_FAILED";
    return lcErrorResponse(req, ctx, code, 500, code);
  }
}

export async function getLandedCostHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertAccountsRole(ctx);
    const lcId = getIdFromPath(req);
    if (!lcId) {
      return lcErrorResponse(req, ctx, "LC_ID_REQUIRED", 400, "Landed cost id is required.");
    }
    return okResponse(await hydrateLandedCost(lcId, ctx), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "LC_FETCH_FAILED";
    const status = code === "LC_NOT_FOUND" ? 404 : code === "LC_SCOPE_VIOLATION" ? 403 : 500;
    return lcErrorResponse(req, ctx, code, status, code);
  }
}

export async function addLCLineHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertAccountsRole(ctx);
    const lcId = getIdFromPath(req);
    const body = await parseBody(req);
    const lc = await fetchLandedCost(lcId);
    assertLcVisibleToContext(ctx, lc);

    if (toUpperTrimmedString(lc.status) !== "DRAFT") {
      return lcErrorResponse(req, ctx, "LC_NOT_EDITABLE", 400, "Only DRAFT landed cost documents can accept lines.");
    }

    const costType = toUpperTrimmedString(body.cost_type);
    const billReference = toTrimmedString(body.bill_reference);
    const billDate = toTrimmedString(body.bill_date);
    const amount = parsePositiveNumber(body.amount);

    if (!COST_TYPES.has(costType) || !billReference || !billDate || !amount) {
      return lcErrorResponse(req, ctx, "LC_LINE_INVALID", 400, "cost_type, bill_reference, bill_date, and amount are required.");
    }

    const existingLines = await fetchLandedCostLines(lcId);
    const lineNumber = existingLines.length + 1;

    const { data, error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("landed_cost_line")
      .insert({
        lc_id: lcId,
        line_number: lineNumber,
        cost_type: costType,
        cha_id: toTrimmedString(body.cha_id) || null,
        bill_reference: billReference,
        bill_date: billDate,
        description: toTrimmedString(body.description) || null,
        amount,
      })
      .select("*")
      .single();

    if (error || !data) {
      return lcErrorResponse(req, ctx, "LC_LINE_CREATE_FAILED", 500, "Unable to add landed cost line.");
    }

    return okResponse(data, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "LC_LINE_CREATE_FAILED";
    const status = code === "LC_NOT_FOUND" ? 404 : code === "LC_SCOPE_VIOLATION" ? 403 : 500;
    return lcErrorResponse(req, ctx, code, status, code);
  }
}

export async function updateLCLineHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertAccountsRole(ctx);
    const lcId = getIdFromPath(req);
    const lineId = getLineIdFromPath(req);
    const body = await parseBody(req);
    const lc = await fetchLandedCost(lcId);
    assertLcVisibleToContext(ctx, lc);

    if (toUpperTrimmedString(lc.status) !== "DRAFT") {
      return lcErrorResponse(req, ctx, "LC_LINE_UPDATE_BLOCKED", 400, "Only DRAFT landed cost documents can update lines.");
    }

    const patch: JsonRecord = {};
    const costType = toUpperTrimmedString(body.cost_type);
    const amount = parsePositiveNumber(body.amount);
    const billReference = toTrimmedString(body.bill_reference);
    const billDate = toTrimmedString(body.bill_date);
    const description = body.description === null ? null : toTrimmedString(body.description);
    const chaId = body.cha_id === null ? null : toTrimmedString(body.cha_id);

    if (costType) {
      if (!COST_TYPES.has(costType)) {
        return lcErrorResponse(req, ctx, "LC_LINE_INVALID_COST_TYPE", 400, "Invalid landed cost cost_type.");
      }
      patch.cost_type = costType;
    }
    if (amount !== null) patch.amount = amount;
    if (billReference) patch.bill_reference = billReference;
    if (billDate) patch.bill_date = billDate;
    if (body.description !== undefined) patch.description = description || null;
    if (body.cha_id !== undefined) patch.cha_id = chaId || null;

    if (Object.keys(patch).length === 0) {
      return lcErrorResponse(req, ctx, "LC_LINE_NO_CHANGES", 400, "At least one landed cost line field must be provided.");
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("landed_cost_line")
      .update(patch)
      .eq("id", lineId)
      .eq("lc_id", lcId)
      .select("*")
      .single();

    if (error || !data) {
      return lcErrorResponse(req, ctx, "LC_LINE_UPDATE_FAILED", 500, "Unable to update landed cost line.");
    }

    return okResponse(data, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "LC_LINE_UPDATE_FAILED";
    const status = code === "LC_NOT_FOUND" ? 404 : code === "LC_SCOPE_VIOLATION" ? 403 : 500;
    return lcErrorResponse(req, ctx, code, status, code);
  }
}

export async function deleteLCLineHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertAccountsRole(ctx);
    const lcId = getIdFromPath(req);
    const lineId = getLineIdFromPath(req);
    const lc = await fetchLandedCost(lcId);
    assertLcVisibleToContext(ctx, lc);

    if (toUpperTrimmedString(lc.status) !== "DRAFT") {
      return lcErrorResponse(req, ctx, "LC_LINE_DELETE_BLOCKED", 400, "Only DRAFT landed cost documents can delete lines.");
    }

    const { error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("landed_cost_line")
      .delete()
      .eq("id", lineId)
      .eq("lc_id", lcId);

    if (error) {
      return lcErrorResponse(req, ctx, "LC_LINE_DELETE_FAILED", 500, "Unable to delete landed cost line.");
    }

    return new Response(null, { status: 204 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "LC_LINE_DELETE_FAILED";
    const status = code === "LC_NOT_FOUND" ? 404 : code === "LC_SCOPE_VIOLATION" ? 403 : 500;
    return lcErrorResponse(req, ctx, code, status, code);
  }
}

export async function postLandedCostHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertAccountsRole(ctx);
    const lcId = getIdFromPath(req);
    const lc = await fetchLandedCost(lcId);
    assertLcVisibleToContext(ctx, lc);

    if (toUpperTrimmedString(lc.status) !== "DRAFT") {
      return lcErrorResponse(req, ctx, "LC_POST_BLOCKED", 400, "Only DRAFT landed cost documents can be posted.");
    }

    const lines = await fetchLandedCostLines(lcId);
    const totalCost = Number(
      lines.reduce((sum, line) => sum + (parsePositiveNumber(line.amount) ?? 0), 0).toFixed(4),
    );

    const { error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("landed_cost")
      .update({
        total_cost: totalCost,
        status: "POSTED",
        posted_by: ctx.auth_user_id,
        posted_at: new Date().toISOString(),
        last_updated_at: new Date().toISOString(),
      })
      .eq("id", lcId);

    if (error) {
      return lcErrorResponse(req, ctx, "LC_POST_FAILED", 500, "Unable to post landed cost document.");
    }

    return okResponse(await hydrateLandedCost(lcId, ctx), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "LC_POST_FAILED";
    const status = code === "LC_NOT_FOUND" ? 404 : code === "LC_SCOPE_VIOLATION" ? 403 : 500;
    return lcErrorResponse(req, ctx, code, status, code);
  }
}

export async function getLandedCostForGRNHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertAccountsRole(ctx);
    const grnId = getGrnIdFromByGrnPath(req);
    if (!grnId) {
      return lcErrorResponse(req, ctx, "LC_GRN_ID_REQUIRED", 400, "GRN id is required.");
    }

    const companyId = toTrimmedString(ctx.context.companyId);
    let query = serviceRoleClient
      .schema("erp_procurement")
      .from("landed_cost")
      .select("*")
      .eq("grn_id", grnId)
      .order("created_at", { ascending: false });

    if (companyId) {
      query = query.eq("company_id", companyId);
    }

    const { data, error } = await query;
    if (error) {
      return lcErrorResponse(req, ctx, "LC_BY_GRN_FAILED", 500, "Unable to fetch landed cost documents for GRN.");
    }

    return okResponse({ items: data ?? [] }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "LC_BY_GRN_FAILED";
    return lcErrorResponse(req, ctx, code, 500, code);
  }
}
