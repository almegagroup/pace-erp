/*
 * File-ID: 18.2.1
 * File-Path: supabase/functions/api/_core/procurement/number_series.handlers.ts
 * Gate: 18
 * Phase: 18
 * Domain: PROCUREMENT
 * Purpose: SA-only handlers for global and company+FY procurement number series administration.
 * Authority: Backend
 */

import type { ContextResolution } from "../../_pipeline/context.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { errorResponse, okResponse } from "../response.ts";
import { assertCompanyScope } from "../../_shared/companyScope.ts";

type JsonRecord = Record<string, unknown>;
type ProcurementHandlerContext = {
  context: Extract<ContextResolution, { status: "RESOLVED" }>;
  request_id: string;
  auth_user_id: string;
  roleCode: string;
};

const COMPANY_DOC_TYPES = new Set(["PO", "STO"]);

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

function numberSeriesErrorResponse(
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

function getPathSegments(req: Request): string[] {
  return new URL(req.url).pathname.split("/").filter(Boolean);
}

function getDocTypeFromPath(req: Request): string {
  return getPathSegments(req)[4] ?? "";
}

function getCompanyIdFromCounterPath(req: Request): string {
  return getPathSegments(req)[4] ?? "";
}

function getDocTypeFromCounterPath(req: Request): string {
  return getPathSegments(req)[5] ?? "";
}

export async function listGlobalSeriesHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertSARole(ctx);
    const { data, error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("document_number_series")
      .select("*")
      .order("doc_type", { ascending: true });

    if (error) {
      return numberSeriesErrorResponse(req, ctx, "NUMBER_SERIES_GLOBAL_LIST_FAILED", 500, "Unable to list global number series.");
    }

    const rows = (data ?? []).map((row) => ({
      ...row,
      current_number: Number(row.last_number ?? 0) > 0
        ? String(row.last_number).padStart(Number(row.pad_width ?? 6), "0")
        : "-",
    }));

    return okResponse(rows, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "NUMBER_SERIES_GLOBAL_LIST_FAILED";
    const status = code === "SA_REQUIRED" ? 403 : 500;
    return numberSeriesErrorResponse(req, ctx, code, status, code);
  }
}

export async function updateGlobalStartingHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertSARole(ctx);
    const docType = toUpperTrimmedString(getDocTypeFromPath(req));
    const body = await parseBody(req);
    const startingNumber = parsePositiveNumber(body.starting_number);

    if (!docType || !startingNumber) {
      return numberSeriesErrorResponse(req, ctx, "NUMBER_SERIES_GLOBAL_STARTING_INVALID", 400, "doc_type and positive starting_number are required.");
    }

    const { data: existing, error: fetchError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("document_number_series")
      .select("*")
      .eq("doc_type", docType)
      .maybeSingle();

    if (fetchError || !existing) {
      return numberSeriesErrorResponse(req, ctx, "NUMBER_SERIES_GLOBAL_NOT_FOUND", 404, "Global number series not found.");
    }

    if (Number(existing.last_number ?? 0) !== 0) {
      return numberSeriesErrorResponse(req, ctx, "NUMBER_SERIES_GLOBAL_ALREADY_USED", 409, "Starting number can only be changed before first document is generated.");
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("document_number_series")
      .update({ starting_number: Number(startingNumber) })
      .eq("doc_type", docType)
      .select("*")
      .single();

    if (error || !data) {
      return numberSeriesErrorResponse(req, ctx, "NUMBER_SERIES_GLOBAL_UPDATE_FAILED", 500, "Unable to update global starting number.");
    }

    return okResponse(data, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "NUMBER_SERIES_GLOBAL_UPDATE_FAILED";
    const status = code === "SA_REQUIRED" ? 403 : 500;
    return numberSeriesErrorResponse(req, ctx, code, status, code);
  }
}

export async function listCompanySeriesHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertSARole(ctx);
    const url = new URL(req.url);
    const companyId = toTrimmedString(url.searchParams.get("company_id"));

    let query = serviceRoleClient
      .schema("erp_procurement")
      .from("company_doc_number_series")
      .select("*")
      .order("company_id", { ascending: true })
      .order("document_type", { ascending: true });

    if (companyId) {
      query = query.eq("company_id", companyId);
    }

    const { data, error } = await query;
    if (error) {
      return numberSeriesErrorResponse(req, ctx, "NUMBER_SERIES_COMPANY_LIST_FAILED", 500, "Unable to list company number series.");
    }

    return okResponse(data ?? [], ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "NUMBER_SERIES_COMPANY_LIST_FAILED";
    const status = code === "SA_REQUIRED" ? 403 : 500;
    return numberSeriesErrorResponse(req, ctx, code, status, code);
  }
}

export async function createCompanySeriesHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertSARole(ctx);
    const body = await parseBody(req);
    const companyId = toTrimmedString(body.company_id);
    const documentType = toUpperTrimmedString(body.document_type);
    const prefix = toTrimmedString(body.prefix);
    const numberPadding = parsePositiveInt(body.number_padding, 5);

    if (!companyId || !COMPANY_DOC_TYPES.has(documentType) || !prefix) {
      return numberSeriesErrorResponse(req, ctx, "NUMBER_SERIES_COMPANY_CREATE_INVALID", 400, "company_id, document_type (PO/STO), and prefix are required.");
    }
    try {
      await assertCompanyScope(ctx, companyId);
    } catch {
      return numberSeriesErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("company_doc_number_series")
      .insert({
        company_id: companyId,
        document_type: documentType,
        prefix,
        number_padding: numberPadding,
        active: body.active !== false,
        created_by: ctx.auth_user_id,
      })
      .select("*")
      .single();

    if (error || !data) {
      return numberSeriesErrorResponse(req, ctx, "NUMBER_SERIES_COMPANY_CREATE_FAILED", 500, "Unable to create company number series.");
    }

    return okResponse(data, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "NUMBER_SERIES_COMPANY_CREATE_FAILED";
    const status = code === "SA_REQUIRED" ? 403 : 500;
    return numberSeriesErrorResponse(req, ctx, code, status, code);
  }
}

export async function updateCompanySeriesHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertSARole(ctx);
    const segments = getPathSegments(req);
    const seriesId = toTrimmedString(segments[4]); // [api, procurement, number-series, company, {id}]
    if (!seriesId) {
      return numberSeriesErrorResponse(req, ctx, "NUMBER_SERIES_COMPANY_ID_MISSING", 400, "Series ID is required.");
    }
    const body = await parseBody(req);
    const prefix = toTrimmedString(body.prefix);
    const numberPadding = parsePositiveInt(body.number_padding, 5);
    if (!prefix) {
      return numberSeriesErrorResponse(req, ctx, "NUMBER_SERIES_COMPANY_UPDATE_INVALID", 400, "prefix is required.");
    }
    const { data, error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("company_doc_number_series")
      .update({ prefix, number_padding: numberPadding })
      .eq("id", seriesId)
      .select("*")
      .single();
    if (error || !data) {
      return numberSeriesErrorResponse(req, ctx, "NUMBER_SERIES_COMPANY_UPDATE_FAILED", 500, "Unable to update series.");
    }
    return okResponse(data, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "NUMBER_SERIES_COMPANY_UPDATE_FAILED";
    const status = code === "SA_REQUIRED" ? 403 : 500;
    return numberSeriesErrorResponse(req, ctx, code, status, code);
  }
}

export async function deleteCompanySeriesHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertSARole(ctx);
    const segments = getPathSegments(req);
    const seriesId = toTrimmedString(segments[4]); // [api, procurement, number-series, company, {id}]
    if (!seriesId) {
      return numberSeriesErrorResponse(req, ctx, "NUMBER_SERIES_COMPANY_ID_MISSING", 400, "Series ID is required.");
    }
    // Fetch series to get company_id + document_type for counter check
    const { data: series } = await serviceRoleClient
      .schema("erp_procurement")
      .from("company_doc_number_series")
      .select("company_id, document_type")
      .eq("id", seriesId)
      .single();
    if (!series) {
      return numberSeriesErrorResponse(req, ctx, "NUMBER_SERIES_COMPANY_NOT_FOUND", 404, "Series not found.");
    }
    // Block delete if any counter has already generated documents
    const { data: usedCounters } = await serviceRoleClient
      .schema("erp_procurement")
      .from("company_doc_number_counter")
      .select("last_number")
      .eq("company_id", series.company_id)
      .eq("document_type", series.document_type)
      .gt("last_number", 0);
    if (usedCounters && usedCounters.length > 0) {
      return numberSeriesErrorResponse(req, ctx, "NUMBER_SERIES_COMPANY_IN_USE", 409, "Cannot delete a series that has already generated documents.");
    }
    const { error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("company_doc_number_series")
      .delete()
      .eq("id", seriesId);
    if (error) {
      return numberSeriesErrorResponse(req, ctx, "NUMBER_SERIES_COMPANY_DELETE_FAILED", 500, "Unable to delete series.");
    }
    return okResponse({ deleted: true }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "NUMBER_SERIES_COMPANY_DELETE_FAILED";
    const status = code === "SA_REQUIRED" ? 403 : 500;
    return numberSeriesErrorResponse(req, ctx, code, status, code);
  }
}

export async function deleteCompanyCounterHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertSARole(ctx);
    const segments = getPathSegments(req);
    // path: api/procurement/number-series/counters/{id}
    const counterId = toTrimmedString(segments[4]);
    if (!counterId) {
      return numberSeriesErrorResponse(req, ctx, "NUMBER_SERIES_COUNTER_ID_MISSING", 400, "Counter ID is required.");
    }
    const { data: counter } = await serviceRoleClient
      .schema("erp_procurement")
      .from("company_doc_number_counter")
      .select("last_number")
      .eq("id", counterId)
      .single();
    if (!counter) {
      return numberSeriesErrorResponse(req, ctx, "NUMBER_SERIES_COUNTER_NOT_FOUND", 404, "Counter not found.");
    }
    if (Number(counter.last_number ?? 0) > 0) {
      return numberSeriesErrorResponse(req, ctx, "NUMBER_SERIES_COUNTER_IN_USE", 409, "Cannot delete a counter that has already generated documents.");
    }
    const { error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("company_doc_number_counter")
      .delete()
      .eq("id", counterId);
    if (error) {
      return numberSeriesErrorResponse(req, ctx, "NUMBER_SERIES_COUNTER_DELETE_FAILED", 500, "Unable to delete counter.");
    }
    return okResponse({ deleted: true }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "NUMBER_SERIES_COUNTER_DELETE_FAILED";
    const status = code === "SA_REQUIRED" ? 403 : 500;
    return numberSeriesErrorResponse(req, ctx, code, status, code);
  }
}

export async function listCompanyCountersHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertSARole(ctx);
    const companyId = toTrimmedString(getCompanyIdFromCounterPath(req));
    const documentType = toUpperTrimmedString(getDocTypeFromCounterPath(req));

    if (!companyId || !COMPANY_DOC_TYPES.has(documentType)) {
      return numberSeriesErrorResponse(req, ctx, "NUMBER_SERIES_COUNTER_LIST_INVALID", 400, "company_id and document_type (PO/STO) are required.");
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("company_doc_number_counter")
      .select("*")
      .eq("company_id", companyId)
      .eq("document_type", documentType)
      .order("financial_year", { ascending: false });

    if (error) {
      return numberSeriesErrorResponse(req, ctx, "NUMBER_SERIES_COUNTER_LIST_FAILED", 500, "Unable to list company FY counters.");
    }

    return okResponse(data ?? [], ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "NUMBER_SERIES_COUNTER_LIST_FAILED";
    const status = code === "SA_REQUIRED" ? 403 : 500;
    return numberSeriesErrorResponse(req, ctx, code, status, code);
  }
}

export async function createCompanyCounterHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertSARole(ctx);
    const companyId = toTrimmedString(getCompanyIdFromCounterPath(req));
    const documentType = toUpperTrimmedString(getDocTypeFromCounterPath(req));
    const body = await parseBody(req);
    const financialYear = toTrimmedString(body.financial_year);
    const startingNumber = parsePositiveNumber(body.starting_number) ?? 1;

    if (!companyId || !COMPANY_DOC_TYPES.has(documentType) || !financialYear) {
      return numberSeriesErrorResponse(req, ctx, "NUMBER_SERIES_COUNTER_CREATE_INVALID", 400, "company_id, document_type (PO/STO), and financial_year are required.");
    }

    const { data: existing, error: fetchError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("company_doc_number_counter")
      .select("id")
      .eq("company_id", companyId)
      .eq("document_type", documentType)
      .eq("financial_year", financialYear)
      .maybeSingle();

    if (fetchError) {
      return numberSeriesErrorResponse(req, ctx, "NUMBER_SERIES_COUNTER_LOOKUP_FAILED", 500, "Unable to validate existing FY counter.");
    }

    // If counter already exists: allow update only if NOT YET USED (last_number = 0)
    if (existing?.id) {
      const { data: existingFull } = await serviceRoleClient
        .schema("erp_procurement")
        .from("company_doc_number_counter")
        .select("last_number")
        .eq("id", existing.id)
        .single();
      if (Number(existingFull?.last_number ?? 0) > 0) {
        return numberSeriesErrorResponse(req, ctx, "NUMBER_SERIES_COUNTER_ALREADY_USED", 409, "Counter already has documents generated. Starting number cannot be changed.");
      }
      // Update starting_number of unused counter
      const { data: updated, error: updateError } = await serviceRoleClient
        .schema("erp_procurement")
        .from("company_doc_number_counter")
        .update({ starting_number: Number(startingNumber) })
        .eq("id", existing.id)
        .select("*")
        .single();
      if (updateError || !updated) {
        return numberSeriesErrorResponse(req, ctx, "NUMBER_SERIES_COUNTER_UPDATE_FAILED", 500, "Unable to update FY counter starting number.");
      }
      return okResponse(updated, ctx.request_id, req);
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("company_doc_number_counter")
      .insert({
        company_id: companyId,
        document_type: documentType,
        financial_year: financialYear,
        starting_number: Number(startingNumber),
        last_number: 0,
        created_by: ctx.auth_user_id,
      })
      .select("*")
      .single();

    if (error || !data) {
      return numberSeriesErrorResponse(req, ctx, "NUMBER_SERIES_COUNTER_CREATE_FAILED", 500, "Unable to create FY counter.");
    }

    return okResponse(data, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "NUMBER_SERIES_COUNTER_CREATE_FAILED";
    const status = code === "SA_REQUIRED" ? 403 : 500;
    return numberSeriesErrorResponse(req, ctx, code, status, code);
  }
}
