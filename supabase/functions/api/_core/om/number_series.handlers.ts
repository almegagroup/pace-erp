/*
 * File-ID: 14.8
 * File-Path: supabase/functions/api/_core/om/number_series.handlers.ts
 * Gate: 14
 * Phase: 14
 * Domain: MASTER
 * Purpose: Implement SA-only number series create and list handlers.
 * Authority: Backend
 */

import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { okResponse, errorResponse } from "../response.ts";
import type { OmHandlerContext } from "./shared.ts";
import { assertOmAdminContext, assertOmSaContext } from "./shared.ts";

type JsonRecord = Record<string, unknown>;

function parseBody(req: Request): Promise<JsonRecord> {
  return req.json().catch(() => ({} as JsonRecord));
}

function toTrimmedString(value: unknown): string {
  return String(value ?? "").trim();
}

function numberSeriesErrorResponse(
  req: Request,
  ctx: OmHandlerContext,
  code: string,
  status: number,
  message: string,
): Response {
  return errorResponse(code, message, ctx.request_id, "NONE", status, {}, req);
}

function determineFinancialYear(fyStartMonth: number): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;

  if (fyStartMonth === 4) {
    if (month >= 4) {
      return `${year}-${String(year + 1).slice(-2)}`;
    }
    return `${year - 1}-${String(year).slice(-2)}`;
  }

  return String(year);
}

export async function createNumberSeriesHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertOmSaContext(ctx);

    const body = await parseBody(req);
    const companyId = toTrimmedString(body.company_id);
    const sectionId = toTrimmedString(body.plant_id || body.section_id) || null;
    const documentType = toTrimmedString(body.document_type).toUpperCase();
    const prefix = toTrimmedString(body.prefix || body.series_code);
    const suffix = toTrimmedString(body.suffix) || null;
    const separator = toTrimmedString(body.separator) || "/";
    const numberPadding = Number(body.padding ?? body.number_padding ?? 5);
    const financialYearReset = body.fiscal_year_reset !== false && body.financial_year_reset !== false;
    const fyStartMonth = Number(body.fy_start_month ?? 4);
    const includeFyInNumber = body.include_fy_in_number !== false;
    const startNumber = Number(body.start_number ?? 1);
    const step = Number(body.step ?? 1);

    if (!companyId || !documentType || !prefix || !Number.isFinite(numberPadding) || numberPadding < 1) {
      return numberSeriesErrorResponse(req, ctx, "OM_NUMBER_SERIES_CREATE_FAILED", 400, "Invalid number series input");
    }

    const { data: existing, error: existingError } = await serviceRoleClient
      .schema("erp_inventory")
      .from("number_series_master")
      .select("id")
      .eq("company_id", companyId)
      .eq("document_type", documentType)
      .maybeSingle();

    if (existingError) {
      throw new Error("OM_NUMBER_SERIES_LOOKUP_FAILED");
    }
    if (existing?.id && !sectionId) {
      return numberSeriesErrorResponse(req, ctx, "OM_NUMBER_SERIES_EXISTS", 409, "Number series already exists");
    }

    const { data: seriesRow, error: seriesError } = await serviceRoleClient
      .schema("erp_inventory")
      .from("number_series_master")
      .insert({
        company_id: companyId,
        section_id: sectionId,
        document_type: documentType,
        prefix,
        suffix,
        separator,
        number_padding: numberPadding,
        financial_year_reset: financialYearReset,
        fy_start_month: fyStartMonth,
        include_fy_in_number: includeFyInNumber,
        active: true,
        created_by: ctx.auth_user_id,
      })
      .select("*")
      .single();

    if (seriesError || !seriesRow) {
      if (seriesError?.code === "23505") {
        return numberSeriesErrorResponse(req, ctx, "OM_NUMBER_SERIES_EXISTS", 409, "Number series already exists");
      }
      throw new Error("OM_NUMBER_SERIES_CREATE_FAILED");
    }

    const initialLastNumber = startNumber - step;
    const { data: counterRow, error: counterError } = await serviceRoleClient
      .schema("erp_inventory")
      .from("number_series_counter")
      .insert({
        series_id: seriesRow.id,
        financial_year: determineFinancialYear(fyStartMonth),
        last_number: initialLastNumber,
        last_generated: null,
      })
      .select("*")
      .single();

    if (counterError || !counterRow) {
      throw new Error("OM_NUMBER_SERIES_CREATE_FAILED");
    }

    return okResponse({ data: { series: seriesRow, counter: counterRow } }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_NUMBER_SERIES_CREATE_FAILED";
    const status = code === "OM_SA_REQUIRED" ? 403 : code.includes("EXISTS") ? 409 : code.includes("FAILED") ? 400 : 500;
    return numberSeriesErrorResponse(req, ctx, code, status, "Number series create failed");
  }
}

export async function listNumberSeriesHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertOmAdminContext(ctx);

    const url = new URL(req.url);
    const documentType = toTrimmedString(url.searchParams.get("document_type")).toUpperCase();
    const companyId = toTrimmedString(url.searchParams.get("company_id"));

    let query = serviceRoleClient
      .schema("erp_inventory")
      .from("number_series_master")
      .select("*")
      .order("created_at", { ascending: false });

    if (documentType) {
      query = query.eq("document_type", documentType);
    }
    if (companyId) {
      query = query.eq("company_id", companyId);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error("OM_NUMBER_SERIES_LIST_FAILED");
    }

    return okResponse({ data: data ?? [] }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_NUMBER_SERIES_LIST_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : 500;
    return numberSeriesErrorResponse(req, ctx, code, status, "Number series list failed");
  }
}
