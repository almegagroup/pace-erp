/*
 * File-ID: 27.3
 * File-Path: supabase/functions/api/_core/production/batch_series.handlers.ts
 * Gate: 27
 * Phase: 27
 * Domain: PRODUCTION
 * Purpose: SA config for batch number series. Also exports generateBatchNumber()
 *          used internally by process_order.handlers.ts at Start Batch.
 * Authority: Backend
 */

import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { okResponse, errorResponse } from "../response.ts";
import type { ProdHandlerContext } from "./production.shared.ts";
import {
  assertSARole,
  assertProdReadRole,
  parseBody,
  toTrimmedString,
  toUpperTrimmedString,
  getIdFromPath,
} from "./production.shared.ts";

type JsonRecord = Record<string, unknown>;

function batchError(req: Request, ctx: ProdHandlerContext, code: string, status: number, msg: string): Response {
  return errorResponse(code, msg, ctx.request_id, "NONE", status, {}, req);
}

// GET /api/production/batch-series?company_id=
export async function listBatchSeriesHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const url = new URL(req.url);
    const companyId = toTrimmedString(url.searchParams.get("company_id") ?? "");

    let query = serviceRoleClient
      .schema("erp_production").from("batch_number_series")
      .select(`
        id, company_id, prodshade_material_id, batch_type, prefix,
        current_count, fy_reset, active, created_at,
        material:erp_master.material_master!prodshade_material_id(
          id, pace_code, material_name, shade_code
        )
      `)
      .order("batch_type").order("prefix");

    if (companyId) query = query.eq("company_id", companyId);
    const { data, error } = await query;
    if (error) throw new Error("PROD_BATCH_SERIES_LIST_FAILED");
    return okResponse({ data: data ?? [] }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_BATCH_SERIES_LIST_FAILED";
    return batchError(req, ctx, code, 500, "Batch series list failed");
  }
}

// POST /api/production/batch-series
export async function createBatchSeriesHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertSARole(ctx);
    const body = await parseBody(req);
    const companyId = toTrimmedString(body.company_id);
    const batchType = toUpperTrimmedString(body.batch_type);
    const prefix = toTrimmedString(body.prefix);
    const materialId = toTrimmedString(body.prodshade_material_id) || null;
    const fyReset = body.fy_reset !== false;

    const VALID_TYPES = new Set(["MTO","HPS","IWC","MTEST"]);
    if (!companyId || !VALID_TYPES.has(batchType) || !prefix) {
      return batchError(req, ctx, "PROD_BATCH_SERIES_INVALID", 400, "company_id, batch_type, prefix required");
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_production").from("batch_number_series")
      .insert({
        company_id: companyId,
        prodshade_material_id: materialId,
        batch_type: batchType,
        prefix,
        current_count: 0,
        fy_reset: fyReset,
        active: true,
        created_by: ctx.auth_user_id,
      })
      .select("id").single();

    if (error) {
      if (error.code === "23505") {
        return batchError(req, ctx, "PROD_BATCH_SERIES_EXISTS", 409, "Batch series already exists for this company/type/prodshade combination");
      }
      throw error;
    }
    return okResponse({ id: (data as JsonRecord).id }, ctx.request_id, req, 201);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_BATCH_SERIES_CREATE_FAILED";
    return batchError(req, ctx, code, 500, "Batch series create failed");
  }
}

// PATCH /api/production/batch-series/:id
export async function updateBatchSeriesHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertSARole(ctx);
    const id = getIdFromPath(req);
    if (!id) return batchError(req, ctx, "PROD_BATCH_SERIES_ID_MISSING", 400, "ID required");

    const body = await parseBody(req);
    const updates: JsonRecord = { last_updated_at: new Date().toISOString() };
    if (body.prefix !== undefined) updates.prefix = toTrimmedString(body.prefix);
    if (body.fy_reset !== undefined) updates.fy_reset = body.fy_reset === true || body.fy_reset === "true";
    if (body.active !== undefined) updates.active = body.active === true || body.active === "true";

    const { error } = await serviceRoleClient
      .schema("erp_production").from("batch_number_series")
      .update(updates).eq("id", id);
    if (error) throw new Error("PROD_BATCH_SERIES_UPDATE_FAILED");
    return okResponse({ id }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_BATCH_SERIES_UPDATE_FAILED";
    return batchError(req, ctx, code, 500, "Batch series update failed");
  }
}

// Internal: generate next batch number for a Process Order.
// Called from process_order.handlers.ts at Start Batch.
export async function generateBatchNumber(
  companyId: string,
  batchType: string,
  prodshadeId: string | null,
): Promise<string> {
  // For MTO and MTEST: company-level (no prodshade)
  // For HPS and IWC: per-prodshade
  const isCompanyLevel = batchType === "MTO" || batchType === "MTEST";
  const effectiveProdshadeId = isCompanyLevel ? null : prodshadeId;

  let query = serviceRoleClient
    .schema("erp_production").from("batch_number_series")
    .select("id, prefix, current_count")
    .eq("company_id", companyId)
    .eq("batch_type", batchType)
    .eq("active", true);

  if (effectiveProdshadeId) {
    query = query.eq("prodshade_material_id", effectiveProdshadeId);
  } else {
    query = query.is("prodshade_material_id", null);
  }

  const { data } = await query.maybeSingle();
  if (!data) {
    throw new Error(`PROD_BATCH_SERIES_NOT_FOUND: type=${batchType}`);
  }

  const series = data as JsonRecord;
  const nextCount = Number(series.current_count) + 1;
  const paddedCount = String(nextCount).padStart(4, "0");
  const batchNumber = `${series.prefix}${paddedCount}`;

  await serviceRoleClient.schema("erp_production").from("batch_number_series")
    .update({ current_count: nextCount, last_updated_at: new Date().toISOString() })
    .eq("id", series.id);

  return batchNumber;
}
