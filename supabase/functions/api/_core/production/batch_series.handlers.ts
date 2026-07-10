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

function createdOkResponse(data: unknown, requestId: string, req?: Request): Response {
  const response = okResponse(data, requestId, req);
  return new Response(response.body, { status: 201, headers: response.headers });
}

async function getMaterialMapByIds(
  materialIds: string[],
  logPrefix: string,
  errorCode: string,
): Promise<Map<string, JsonRecord>> {
  const matIds = [...new Set(materialIds.filter(Boolean))];
  const matMap = new Map<string, JsonRecord>();
  if (matIds.length === 0) return matMap;

  const { data: mats, error: matErr } = await serviceRoleClient
    .schema("erp_master")
    .from("material_master")
    .select("id, pace_code, material_name, shade_code")
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
        current_count, active, created_at
      `)
      .order("batch_type").order("prefix");

    if (companyId) query = query.eq("company_id", companyId);
    const { data, error } = await query;
    if (error) {
      console.error("[batch_series.listBatchSeries] query failed:", JSON.stringify(error));
      throw new Error("PROD_BATCH_SERIES_LIST_FAILED");
    }

    const rows = (data ?? []) as JsonRecord[];
    const materialMap = await getMaterialMapByIds(
      rows.map((row) => String(row.prodshade_material_id ?? "")),
      "[batch_series.listBatchSeries]",
      "PROD_BATCH_SERIES_LIST_FAILED",
    );
    return okResponse({
      data: rows.map((row) => ({
        ...row,
        material: materialMap.get(String(row.prodshade_material_id ?? "")) ?? null,
      })),
    }, ctx.request_id, req);
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
    // MTS (IWC+Powder) is per-Prodshade; MTO/HPS/MTEST are company-level (83.7, corrected 2026-07-11).
    const isCompanyLevel = batchType === "MTO" || batchType === "HPS" || batchType === "MTEST";
    const materialId = isCompanyLevel ? null : (toTrimmedString(body.prodshade_material_id) || null);

    const VALID_TYPES = new Set(["MTO","HPS","MTS","MTEST"]);
    if (!companyId || !VALID_TYPES.has(batchType) || !prefix) {
      return batchError(req, ctx, "PROD_BATCH_SERIES_INVALID", 400, "company_id, batch_type, prefix required");
    }
    if (!isCompanyLevel && !materialId) {
      return batchError(req, ctx, "PROD_BATCH_SERIES_PRODSHADE_REQUIRED", 400, "prodshade_material_id required for MTS");
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_production").from("batch_number_series")
      .insert({
        company_id: companyId,
        prodshade_material_id: materialId,
        batch_type: batchType,
        prefix,
        current_count: 0,
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
    return createdOkResponse({ id: (data as JsonRecord).id }, ctx.request_id, req);
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
    if (body.active !== undefined) updates.active = body.active === true || body.active === "true";
    if (body.current_count !== undefined) {
      const n = Number(body.current_count);
      if (Number.isInteger(n) && n >= 0 && n <= 99999) updates.current_count = n;
    }

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
// Called from process_order.handlers.ts at Start Batch (MTO/HPS/MTS) or PO
// save (MTEST). Wraps 99999 -> 1 on overflow — no financial-year reset
// (83.7, corrected 2026-07-11, business owner override).
export async function generateBatchNumber(
  companyId: string,
  batchType: string,
  prodshadeId: string | null,
): Promise<string> {
  // MTO/HPS/MTEST: company-level (no prodshade). MTS (IWC+Powder): per-prodshade.
  const isCompanyLevel = batchType === "MTO" || batchType === "HPS" || batchType === "MTEST";
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
  const currentCount = Number(series.current_count);
  const nextCount = currentCount >= 99999 ? 1 : currentCount + 1;
  const paddedCount = String(nextCount).padStart(5, "0");
  const batchNumber = `${series.prefix}${paddedCount}`;

  await serviceRoleClient.schema("erp_production").from("batch_number_series")
    .update({ current_count: nextCount, last_updated_at: new Date().toISOString() })
    .eq("id", series.id);

  return batchNumber;
}
