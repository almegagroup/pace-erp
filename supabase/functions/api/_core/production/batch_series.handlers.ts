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
import { todayIsoInKolkata } from "../../_shared/dateUtils.ts";
import { resolveUserDisplayNames } from "../../_shared/resolveUserDisplayNames.ts";
import { okResponse, errorResponse } from "../response.ts";
import { assertCompanyScope } from "../../_shared/companyScope.ts";
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
const NUMBERING_METHODS = new Set(["PLAIN", "CONTINUOUS_DATE", "MONTHLY_RESET_MONYY"]);

type BatchNumberInstanceRow = {
  id: string;
  company_id: string;
  po_type: string;
  prodshade_material_id: string | null;
  batch_number: string;
  status: "ACTIVE" | "VOIDED" | "RELEASED";
  source_process_order_id: string | null;
  voided_at: string | null;
  released_by: string | null;
  released_at: string | null;
  release_reason: string | null;
  created_at: string;
  last_updated_at: string;
  last_updated_by: string | null;
};

function batchError(req: Request, ctx: ProdHandlerContext, code: string, status: number, msg: string): Response {
  return errorResponse(code, msg, ctx.request_id, "NONE", status, {}, req);
}

function createdOkResponse(data: unknown, requestId: string, req?: Request): Response {
  const response = okResponse(data, requestId, req);
  return new Response(response.body, { status: 201, headers: response.headers });
}

function parseSerialPadWidth(value: unknown, fallback = 5): number {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10) {
    throw new Error("PROD_BATCH_SERIES_INVALID");
  }
  return parsed;
}

function parseNumberingMethod(value: unknown, fallback = "PLAIN"): string {
  const normalized = toUpperTrimmedString(value);
  if (!normalized) return fallback;
  if (!NUMBERING_METHODS.has(normalized)) {
    throw new Error("PROD_BATCH_SERIES_INVALID");
  }
  return normalized;
}

function buildPreviewBatchNumber(row: JsonRecord, nextCount: number, today = new Date()): string {
  const prefix = toTrimmedString(row.prefix);
  const numberingMethod = parseNumberingMethod(row.numbering_method, "PLAIN");
  const serialPadWidth = parseSerialPadWidth(row.serial_pad_width, 5);
  const paddedSerial = String(nextCount).padStart(serialPadWidth, "0");
  const day = String(today.getDate()).padStart(2, "0");
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const year = String(today.getFullYear());
  if (numberingMethod === "CONTINUOUS_DATE") {
    return `${prefix}${day}-${month}-${year}/${paddedSerial}`;
  }
  if (numberingMethod === "MONTHLY_RESET_MONYY") {
    return `${prefix}${month}${year.slice(-2)}/${paddedSerial}`;
  }
  return `${prefix}${paddedSerial}`;
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

async function getMachineMapByIds(
  machineIds: string[],
  logPrefix: string,
  errorCode: string,
): Promise<Map<string, JsonRecord>> {
  const ids = [...new Set(machineIds.filter(Boolean))];
  const machineMap = new Map<string, JsonRecord>();
  if (ids.length === 0) return machineMap;

  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("machine_master")
    .select("id, machine_code, machine_name")
    .in("id", ids);
  if (error) {
    console.error(`${logPrefix} machine query failed:`, JSON.stringify(error));
    throw new Error(errorCode);
  }

  for (const row of (data ?? []) as JsonRecord[]) {
    machineMap.set(String(row.id), row);
  }
  return machineMap;
}

async function listBatchNumberInstances(params: {
  companyId?: string | null;
  status?: string | null;
  poType?: string | null;
}): Promise<BatchNumberInstanceRow[]> {
  let query = serviceRoleClient
    .schema("erp_production")
    .from("batch_number_instance")
    .select(`
      id, company_id, po_type, prodshade_material_id, batch_number, status,
      source_process_order_id, voided_at, released_by, released_at, release_reason,
      created_at, last_updated_at, last_updated_by
    `)
    .order("created_at", { ascending: false });

  if (params.companyId) query = query.eq("company_id", params.companyId);
  if (params.status) query = query.eq("status", params.status);
  if (params.poType) query = query.eq("po_type", params.poType);

  const { data, error } = await query;
  if (error) {
    console.error("[batch_series.listBatchNumberInstances] query failed:", JSON.stringify(error));
    throw new Error("PROD_BATCH_NUMBER_LIST_FAILED");
  }
  return ((data ?? []) as JsonRecord[]).map((row) => ({
    id: String(row.id),
    company_id: String(row.company_id),
    po_type: String(row.po_type),
    prodshade_material_id: toTrimmedString(row.prodshade_material_id) || null,
    batch_number: String(row.batch_number),
    status: String(row.status) as BatchNumberInstanceRow["status"],
    source_process_order_id: toTrimmedString(row.source_process_order_id) || null,
    voided_at: toTrimmedString(row.voided_at) || null,
    released_by: toTrimmedString(row.released_by) || null,
    released_at: toTrimmedString(row.released_at) || null,
    release_reason: toTrimmedString(row.release_reason) || null,
    created_at: String(row.created_at),
    last_updated_at: String(row.last_updated_at),
    last_updated_by: toTrimmedString(row.last_updated_by) || null,
  }));
}

export async function findReleasedBatchNumberInstances(
  companyId: string,
  poType: string,
): Promise<BatchNumberInstanceRow[]> {
  return await listBatchNumberInstances({ companyId, status: "RELEASED", poType });
}

export async function activateReleasedBatchNumberInstance(params: {
  instanceId: string;
  companyId: string;
  poType: string;
  prodshadeMaterialId: string | null;
  processOrderId: string;
  authUserId: string;
}): Promise<BatchNumberInstanceRow | null> {
  const now = new Date().toISOString();
  const { data, error } = await serviceRoleClient
    .schema("erp_production")
    .from("batch_number_instance")
    .update({
      status: "ACTIVE",
      source_process_order_id: params.processOrderId,
      prodshade_material_id: params.prodshadeMaterialId,
      released_by: null,
      released_at: null,
      release_reason: null,
      last_updated_at: now,
      last_updated_by: params.authUserId,
    })
    .eq("id", params.instanceId)
    .eq("company_id", params.companyId)
    .eq("po_type", params.poType)
    .eq("status", "RELEASED")
    .select(`
      id, company_id, po_type, prodshade_material_id, batch_number, status,
      source_process_order_id, voided_at, released_by, released_at, release_reason,
      created_at, last_updated_at, last_updated_by
    `)
    .maybeSingle();
  if (error) {
    console.error("[batch_series.activateReleasedBatchNumberInstance] update failed:", JSON.stringify(error));
    throw new Error("PROD_BATCH_NUMBER_RELEASE_USE_FAILED");
  }
  if (!data) return null;
  return {
    id: String((data as JsonRecord).id),
    company_id: String((data as JsonRecord).company_id),
    po_type: String((data as JsonRecord).po_type),
    prodshade_material_id: toTrimmedString((data as JsonRecord).prodshade_material_id) || null,
    batch_number: String((data as JsonRecord).batch_number),
    status: "ACTIVE",
    source_process_order_id: toTrimmedString((data as JsonRecord).source_process_order_id) || null,
    voided_at: toTrimmedString((data as JsonRecord).voided_at) || null,
    released_by: null,
    released_at: null,
    release_reason: null,
    created_at: String((data as JsonRecord).created_at),
    last_updated_at: String((data as JsonRecord).last_updated_at),
    last_updated_by: toTrimmedString((data as JsonRecord).last_updated_by) || null,
  };
}

export async function upsertBatchNumberInstanceForProcessOrder(params: {
  companyId: string;
  poType: string;
  prodshadeMaterialId: string | null;
  batchNumber: string;
  processOrderId: string;
  authUserId: string;
  status: "ACTIVE" | "VOIDED";
  voidedAt?: string | null;
}): Promise<void> {
  const now = new Date().toISOString();
  const payload = {
    company_id: params.companyId,
    po_type: params.poType,
    prodshade_material_id: params.prodshadeMaterialId,
    batch_number: params.batchNumber,
    status: params.status,
    source_process_order_id: params.processOrderId,
    voided_at: params.status === "VOIDED" ? (params.voidedAt ?? now) : null,
    last_updated_at: now,
    last_updated_by: params.authUserId,
  };

  const { data: existing, error: existingErr } = await serviceRoleClient
    .schema("erp_production")
    .from("batch_number_instance")
    .select("id")
    .eq("company_id", params.companyId)
    .eq("batch_number", params.batchNumber)
    .maybeSingle();
  if (existingErr) {
    console.error("[batch_series.upsertBatchNumberInstanceForProcessOrder] lookup failed:", JSON.stringify(existingErr));
    throw new Error("PROD_BATCH_NUMBER_UPSERT_FAILED");
  }

  if (existing) {
    const { error } = await serviceRoleClient
      .schema("erp_production")
      .from("batch_number_instance")
      .update(payload)
      .eq("id", String((existing as JsonRecord).id));
    if (error) {
      console.error("[batch_series.upsertBatchNumberInstanceForProcessOrder] update failed:", JSON.stringify(error));
      throw new Error("PROD_BATCH_NUMBER_UPSERT_FAILED");
    }
    return;
  }

  const { error } = await serviceRoleClient
    .schema("erp_production")
    .from("batch_number_instance")
    .insert({
      ...payload,
      created_at: now,
    });
  if (error) {
    console.error("[batch_series.upsertBatchNumberInstanceForProcessOrder] insert failed:", JSON.stringify(error));
    throw new Error("PROD_BATCH_NUMBER_UPSERT_FAILED");
  }
}

// GET /api/production/batch-series?company_id=
export async function listBatchSeriesHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const url = new URL(req.url);
    const companyId = toTrimmedString(url.searchParams.get("company_id") ?? "");

    if (companyId) {
      try {
        await assertCompanyScope(ctx, companyId);
      } catch {
        return batchError(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
      }
    }
    let allowedCompanyIds: string[] | null = null;
    if (!companyId && ctx.roleCode !== "SA" && ctx.roleCode !== "GA" && ctx.context.isAdmin !== true) {
      const { data: userCompanies, error: userCompaniesError } = await serviceRoleClient
        .schema("erp_map")
        .from("user_companies")
        .select("company_id")
        .eq("auth_user_id", ctx.auth_user_id);
      if (userCompaniesError) {
        console.error("[batch_series.listBatchSeries] user_companies query failed:", JSON.stringify(userCompaniesError));
        throw new Error("PROD_BATCH_SERIES_LIST_FAILED");
      }
      allowedCompanyIds = ((userCompanies ?? []) as JsonRecord[]).map((row) => String(row.company_id ?? ""));
    }

    let query = serviceRoleClient
      .schema("erp_production").from("batch_number_series")
      .select(`
        id, company_id, prodshade_material_id, batch_type, prefix,
        current_count, numbering_method, serial_pad_width, reset_period, active, created_at
      `)
      .order("batch_type").order("prefix");

    if (companyId) query = query.eq("company_id", companyId);
    else if (allowedCompanyIds) query = query.in("company_id", allowedCompanyIds);
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
        next_batch_preview: buildPreviewBatchNumber(
          row,
          Number(row.current_count ?? 0) >= ((10 ** Number(row.serial_pad_width ?? 5)) - 1)
            ? 1
            : Number(row.current_count ?? 0) + 1,
        ),
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
    const rawCurrentCount = body.current_count;
    const numberingMethod = parseNumberingMethod(body.numbering_method, "PLAIN");
    const serialPadWidth = parseSerialPadWidth(body.serial_pad_width, 5);
    // MTS (IWC+Powder) is per-Prodshade; MTO/HPS/MTEST are company-level (83.7, corrected 2026-07-11).
    const isCompanyLevel = batchType === "MTO" || batchType === "HPS" || batchType === "MTEST";
    const materialId = isCompanyLevel ? null : (toTrimmedString(body.prodshade_material_id) || null);
    let currentCount = 0;

    const VALID_TYPES = new Set(["MTO","HPS","MTS","MTEST"]);
    if (!companyId || !VALID_TYPES.has(batchType) || !prefix) {
      return batchError(req, ctx, "PROD_BATCH_SERIES_INVALID", 400, "company_id, batch_type, prefix required");
    }
    if (!isCompanyLevel && !materialId) {
      return batchError(req, ctx, "PROD_BATCH_SERIES_PRODSHADE_REQUIRED", 400, "prodshade_material_id required for MTS");
    }
    if (rawCurrentCount !== undefined && rawCurrentCount !== null && String(rawCurrentCount).trim() !== "") {
      const parsedCurrentCount = Number(rawCurrentCount);
      const maxCount = (10 ** serialPadWidth) - 1;
      if (!Number.isInteger(parsedCurrentCount) || parsedCurrentCount < 0 || parsedCurrentCount > maxCount) {
        return batchError(req, ctx, "PROD_BATCH_SERIES_INVALID", 400, `current_count must be an integer between 0 and ${maxCount}`);
      }
      currentCount = parsedCurrentCount;
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_production").from("batch_number_series")
      .insert({
        company_id: companyId,
        prodshade_material_id: materialId,
        batch_type: batchType,
        prefix,
        current_count: currentCount,
        numbering_method: numberingMethod,
        serial_pad_width: serialPadWidth,
        reset_period: numberingMethod === "MONTHLY_RESET_MONYY" ? null : null,
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

    const { data: existing, error: existingErr } = await serviceRoleClient
      .schema("erp_production")
      .from("batch_number_series")
      .select("id, serial_pad_width")
      .eq("id", id)
      .maybeSingle();
    if (existingErr) {
      console.error("[batch_series.updateBatchSeries] lookup failed:", JSON.stringify(existingErr));
      throw new Error("PROD_BATCH_SERIES_UPDATE_FAILED");
    }
    if (!existing) {
      return batchError(req, ctx, "PROD_BATCH_SERIES_ID_MISSING", 404, "Batch series not found");
    }

    const body = await parseBody(req);
    const updates: JsonRecord = { last_updated_at: new Date().toISOString() };
    if (body.prefix !== undefined) updates.prefix = toTrimmedString(body.prefix);
    if (body.active !== undefined) updates.active = body.active === true || body.active === "true";
    if (body.numbering_method !== undefined) {
      updates.numbering_method = parseNumberingMethod(body.numbering_method, "PLAIN");
      if (updates.numbering_method !== "MONTHLY_RESET_MONYY") {
        updates.reset_period = null;
      }
    }
    if (body.serial_pad_width !== undefined) {
      updates.serial_pad_width = parseSerialPadWidth(body.serial_pad_width, 5);
    }
    if (body.current_count !== undefined) {
      const n = Number(body.current_count);
      const serialPadWidth = parseSerialPadWidth(body.serial_pad_width ?? (existing as JsonRecord).serial_pad_width ?? 5, 5);
      const maxCount = (10 ** serialPadWidth) - 1;
      if (Number.isInteger(n) && n >= 0 && n <= maxCount) updates.current_count = n;
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

export async function listBatchNumbersHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const url = new URL(req.url);
    const companyId = toTrimmedString(url.searchParams.get("company_id") ?? "") || null;
    const status = toUpperTrimmedString(url.searchParams.get("status") ?? "") || null;
    const poType = toUpperTrimmedString(url.searchParams.get("po_type") ?? "") || null;

    if (companyId) {
      try {
        await assertCompanyScope(ctx, companyId);
      } catch {
        return batchError(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
      }
    } else if (ctx.roleCode !== "SA" && ctx.roleCode !== "GA" && ctx.context.isAdmin !== true) {
      return batchError(req, ctx, "PROD_BATCH_NUMBER_COMPANY_REQUIRED", 400, "company_id required");
    }

    const rows = await listBatchNumberInstances({ companyId, status, poType });
    const processOrderIds = [...new Set(rows.map((row) => row.source_process_order_id).filter(Boolean))];
    let orderMap = new Map<string, JsonRecord>();
    if (processOrderIds.length > 0) {
      const { data, error } = await serviceRoleClient
        .schema("erp_production")
        .from("process_order")
        .select("id, material_id, stroke_master_id, machine_id")
        .in("id", processOrderIds);
      if (error) {
        console.error("[batch_series.listBatchNumbers] process-order query failed:", JSON.stringify(error));
        throw new Error("PROD_BATCH_NUMBER_LIST_FAILED");
      }
      orderMap = new Map(((data ?? []) as JsonRecord[]).map((row) => [String(row.id), row]));
    }

    const materialMap = await getMaterialMapByIds(
      rows.map((row) => row.prodshade_material_id || String(orderMap.get(row.source_process_order_id || "")?.material_id ?? "")).filter(Boolean),
      "[batch_series.listBatchNumbers]",
      "PROD_BATCH_NUMBER_LIST_FAILED",
    );

    const strokeIds = [...new Set(rows.map((row) => String(orderMap.get(row.source_process_order_id || "")?.stroke_master_id ?? "")).filter(Boolean))];
    const strokeMap = new Map<string, JsonRecord>();
    if (strokeIds.length > 0) {
      const { data, error } = await serviceRoleClient
        .schema("erp_production")
        .from("stroke_master")
        .select("id, stroke_number")
        .in("id", strokeIds);
      if (error) {
        console.error("[batch_series.listBatchNumbers] stroke query failed:", JSON.stringify(error));
        throw new Error("PROD_BATCH_NUMBER_LIST_FAILED");
      }
      for (const row of (data ?? []) as JsonRecord[]) {
        strokeMap.set(String(row.id), row);
      }
    }

    const machineMap = await getMachineMapByIds(
      rows.map((row) => String(orderMap.get(row.source_process_order_id || "")?.machine_id ?? "")).filter(Boolean),
      "[batch_series.listBatchNumbers]",
      "PROD_BATCH_NUMBER_LIST_FAILED",
    );
    const releasedByDisplayMap = await resolveUserDisplayNames(rows.map((row) => row.released_by || "").filter(Boolean));

    return okResponse({
      data: rows.map((row) => {
        const sourceOrder = row.source_process_order_id ? orderMap.get(row.source_process_order_id) ?? null : null;
        const prodshadeMaterialId = row.prodshade_material_id || toTrimmedString(sourceOrder?.material_id) || "";
        return {
          id: row.id,
          batch_number: row.batch_number,
          po_type: row.po_type,
          voided_date: row.voided_at,
          status: row.status,
          released_at: row.released_at,
          released_by: row.released_by,
          released_by_display: row.released_by ? (releasedByDisplayMap.get(row.released_by) || null) : null,
          reason: row.release_reason,
          previous_prodshade: materialMap.get(prodshadeMaterialId) ?? null,
          previous_stroke_number: toTrimmedString(strokeMap.get(String(sourceOrder?.stroke_master_id ?? ""))?.stroke_number) || null,
          machine: machineMap.get(String(sourceOrder?.machine_id ?? "")) ?? null,
        };
      }),
    }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_BATCH_NUMBER_LIST_FAILED";
    return batchError(req, ctx, code, 500, "Batch number list failed");
  }
}

export async function releaseBatchNumberHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    // ACL-gated via route-acl-registry (PROD_BATCH_RELEASE:WRITE) — no longer a
    // blanket Manager/SA rank check; department grants are actually enforced.
    const id = getIdFromPath(req);
    if (!id) return batchError(req, ctx, "PROD_BATCH_NUMBER_ID_MISSING", 400, "ID required");

    const body = await parseBody(req);
    const reason = toTrimmedString(body.reason);
    if (!reason) {
      return batchError(req, ctx, "PROD_BATCH_NUMBER_REASON_REQUIRED", 400, "reason required");
    }

    const { data: existing, error: existingErr } = await serviceRoleClient
      .schema("erp_production")
      .from("batch_number_instance")
      .select("id, company_id")
      .eq("id", id)
      .maybeSingle();
    if (existingErr) {
      console.error("[batch_series.releaseBatchNumber] lookup failed:", JSON.stringify(existingErr));
      throw new Error("PROD_BATCH_NUMBER_RELEASE_FAILED");
    }
    if (!existing) return batchError(req, ctx, "PROD_BATCH_NUMBER_NOT_FOUND", 404, "Not found");
    try {
      await assertCompanyScope(ctx, String((existing as JsonRecord).company_id ?? ""));
    } catch {
      return batchError(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }

    const now = new Date().toISOString();
    const { data, error } = await serviceRoleClient
      .schema("erp_production")
      .from("batch_number_instance")
      .update({
        status: "RELEASED",
        released_by: ctx.auth_user_id,
        released_at: now,
        release_reason: reason,
        last_updated_at: now,
        last_updated_by: ctx.auth_user_id,
      })
      .eq("id", id)
      .eq("status", "VOIDED")
      .select("id, batch_number, status, released_by, released_at, release_reason")
      .maybeSingle();
    if (error) {
      console.error("[batch_series.releaseBatchNumber] update failed:", JSON.stringify(error));
      throw new Error("PROD_BATCH_NUMBER_RELEASE_FAILED");
    }
    if (!data) {
      return batchError(req, ctx, "PROD_BATCH_NUMBER_NOT_VOIDED", 422, "Only VOIDED batch numbers can be released");
    }

    let releasedByDisplay: string | null = null;
    try {
      const displayMap = await resolveUserDisplayNames([ctx.auth_user_id]);
      releasedByDisplay = displayMap.get(ctx.auth_user_id) || null;
    } catch (displayErr) {
      console.error("[batch_series.releaseBatchNumber] display-name resolution failed:", JSON.stringify(displayErr));
    }

    return okResponse({
      id: String((data as JsonRecord).id),
      batch_number: String((data as JsonRecord).batch_number),
      status: String((data as JsonRecord).status),
      released_by: ctx.auth_user_id,
      released_by_display: releasedByDisplay,
      released_at: String((data as JsonRecord).released_at),
      reason: String((data as JsonRecord).release_reason ?? reason),
    }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_BATCH_NUMBER_RELEASE_FAILED";
    return batchError(req, ctx, code, 500, "Batch number release failed");
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
  const { data, error } = await serviceRoleClient
    .schema("erp_production")
    .rpc("generate_batch_series_number", {
      p_company_id: companyId,
      p_batch_type: batchType,
      p_prodshade_material_id: effectiveProdshadeId,
      p_today: todayIsoInKolkata(),
    });
  if (error) {
    console.error("[batch_series.generateBatchNumber] rpc failed:", JSON.stringify(error));
    throw new Error("PROD_BATCH_SERIES_GENERATE_FAILED");
  }
  const row = (Array.isArray(data) ? data[0] : data) as JsonRecord | undefined;
  if (!row || !toTrimmedString(row.batch_number)) {
    throw new Error(`PROD_BATCH_SERIES_NOT_FOUND: type=${batchType}`);
  }
  return String(row.batch_number);
}
