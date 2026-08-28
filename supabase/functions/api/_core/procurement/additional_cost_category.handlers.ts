/*
 * File-Path: supabase/functions/api/_core/procurement/additional_cost_category.handlers.ts
 * Domain: PROCUREMENT / Sales
 * Purpose: §133.13 -- "Additional Cost Category" master. Small, standalone,
 *          inline-creatable list used only by the Invoice/PGI (SO02)
 *          per-row Additional Cost drawer -- no separate master page, list
 *          endpoint doubles as the dropdown source, create endpoint doubles
 *          as the "+ New Category" inline action.
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

function toTrimmedString(value: unknown): string {
  return String(value ?? "").trim();
}
function parseBody(req: Request): Promise<JsonRecord> {
  return req.json().catch(() => ({} as JsonRecord));
}
function errResponse(req: Request, ctx: ProcurementHandlerContext, code: string, status: number, message: string): Response {
  return errorResponse(code, message, ctx.request_id, "NONE", status, {}, req);
}

export async function listAdditionalCostCategoriesHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const { data, error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("additional_cost_category")
      .select("id, category_name, is_active")
      .eq("is_active", true)
      .order("category_name", { ascending: true });
    if (error) return errResponse(req, ctx, "ADDITIONAL_COST_CATEGORY_LIST_FAILED", 500, error.message || "Unable to load additional cost categories.");
    return okResponse(data ?? [], ctx.request_id, req);
  } catch {
    return errResponse(req, ctx, "ADDITIONAL_COST_CATEGORY_LIST_FAILED", 500, "Unable to load additional cost categories.");
  }
}

export async function createAdditionalCostCategoryHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const body = await parseBody(req);
    const categoryName = toTrimmedString(body.category_name);
    if (!categoryName) return errResponse(req, ctx, "ADDITIONAL_COST_CATEGORY_NAME_REQUIRED", 400, "category_name is required.");

    const { data: existing } = await serviceRoleClient
      .schema("erp_procurement")
      .from("additional_cost_category")
      .select("id, category_name, is_active")
      .ilike("category_name", categoryName)
      .maybeSingle();
    if (existing) return okResponse(existing, ctx.request_id, req);

    const { data, error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("additional_cost_category")
      .insert({ category_name: categoryName, created_by: ctx.auth_user_id })
      .select("id, category_name, is_active")
      .single();
    if (error || !data) return errResponse(req, ctx, "ADDITIONAL_COST_CATEGORY_CREATE_FAILED", 500, error?.message || "Unable to create additional cost category.");
    return okResponse(data, ctx.request_id, req);
  } catch {
    return errResponse(req, ctx, "ADDITIONAL_COST_CATEGORY_CREATE_FAILED", 500, "Unable to create additional cost category.");
  }
}
