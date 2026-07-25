/*
 * File-ID: 27.4
 * File-Path: supabase/functions/api/_core/production/segment_location.handlers.ts
 * Gate: 27
 * Phase: 27
 * Domain: PRODUCTION
 * Purpose: Production segment → storage location config handlers.
 *          Used to determine rm_sloc / pm_sloc / shopfloor_sloc / fg_sloc per segment.
 * Authority: Backend
 */

import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { okResponse, errorResponse } from "../response.ts";
import { assertCompanyScope } from "../../_shared/companyScope.ts";
import type { ProdHandlerContext } from "./production.shared.ts";
import {
  assertManagerOrSARole,
  assertProdReadRole,
  parseBody,
  toTrimmedString,
  toUpperTrimmedString,
} from "./production.shared.ts";

type JsonRecord = Record<string, unknown>;

const VALID_SEGMENTS = new Set(["ADMIX","HPS","IWC","POWDER","INT"]);

function segErr(req: Request, ctx: ProdHandlerContext, code: string, status: number, msg: string): Response {
  return errorResponse(code, msg, ctx.request_id, "NONE", status, {}, req);
}

async function getStorageLocationMapByIds(
  locationIds: string[],
  logPrefix: string,
  errorCode: string,
): Promise<Map<string, JsonRecord>> {
  const ids = [...new Set(locationIds.filter(Boolean))];
  const slocMap = new Map<string, JsonRecord>();
  if (ids.length === 0) return slocMap;

  const { data, error } = await serviceRoleClient
    .schema("erp_inventory")
    .from("storage_location_master")
    .select("id, code, name")
    .in("id", ids);
  if (error) {
    console.error(`${logPrefix} storage location query failed:`, JSON.stringify(error));
    throw new Error(errorCode);
  }

  for (const row of (data ?? []) as JsonRecord[]) {
    slocMap.set(String(row.id), row);
  }
  return slocMap;
}

// GET /api/production/segment-locations?company_id=
export async function listSegmentLocationsHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const url = new URL(req.url);
    const companyId = toTrimmedString(url.searchParams.get("company_id") ?? "");
    if (companyId) {
      try {
        await assertCompanyScope(ctx, companyId);
      } catch {
        return segErr(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
      }
    }

    let query = serviceRoleClient
      .schema("erp_production").from("production_segment_location_config")
      .select(`
        id, company_id, segment_code, active, created_at, last_updated_at,
        rm_sloc_id, pm_sloc_id, shopfloor_sloc_id, fg_sloc_id
      `)
      .order("segment_code");

    if (companyId) query = query.eq("company_id", companyId);
    const { data, error } = await query;
    if (error) {
      console.error("[segment_location.listSegmentLocations] query failed:", JSON.stringify(error));
      throw new Error("PROD_SEG_LOC_LIST_FAILED");
    }

    const rows = (data ?? []) as JsonRecord[];
    const slocMap = await getStorageLocationMapByIds(
      rows.flatMap((row) => [
        String(row.rm_sloc_id ?? ""),
        String(row.pm_sloc_id ?? ""),
        String(row.shopfloor_sloc_id ?? ""),
        String(row.fg_sloc_id ?? ""),
      ]),
      "[segment_location.listSegmentLocations]",
      "PROD_SEG_LOC_LIST_FAILED",
    );
    return okResponse({
      data: rows.map((row) => ({
        ...row,
        rm_sloc: slocMap.get(String(row.rm_sloc_id ?? "")) ?? null,
        pm_sloc: slocMap.get(String(row.pm_sloc_id ?? "")) ?? null,
        shopfloor_sloc: slocMap.get(String(row.shopfloor_sloc_id ?? "")) ?? null,
        fg_sloc: slocMap.get(String(row.fg_sloc_id ?? "")) ?? null,
      })),
    }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_SEG_LOC_LIST_FAILED";
    return segErr(req, ctx, code, 500, "Segment location list failed");
  }
}

// POST /api/production/segment-locations  (upsert)
export async function upsertSegmentLocationHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertManagerOrSARole(ctx);
    const body = await parseBody(req);
    const companyId = toTrimmedString(body.company_id);
    const segmentCode = toUpperTrimmedString(body.segment_code);

    if (!companyId || !VALID_SEGMENTS.has(segmentCode)) {
      return segErr(req, ctx, "PROD_SEG_LOC_INVALID", 400,
        `company_id required; segment_code must be one of ${[...VALID_SEGMENTS].join(",")}`);
    }
    try {
      await assertCompanyScope(ctx, companyId);
    } catch {
      return segErr(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }

    const nullOrStr = (v: unknown) => toTrimmedString(v) || null;

    const { data, error } = await serviceRoleClient
      .schema("erp_production").from("production_segment_location_config")
      .upsert(
        {
          company_id: companyId,
          segment_code: segmentCode,
          rm_sloc_id: nullOrStr(body.rm_sloc_id),
          pm_sloc_id: nullOrStr(body.pm_sloc_id),
          shopfloor_sloc_id: nullOrStr(body.shopfloor_sloc_id),
          fg_sloc_id: nullOrStr(body.fg_sloc_id),
          active: true,
          created_by: ctx.auth_user_id,
          last_updated_at: new Date().toISOString(),
          last_updated_by: ctx.auth_user_id,
        },
        { onConflict: "company_id,segment_code" }
      )
      .select("id").single();

    if (error) throw new Error("PROD_SEG_LOC_UPSERT_FAILED");
    return okResponse({ id: (data as Record<string, unknown>).id }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_SEG_LOC_UPSERT_FAILED";
    return segErr(req, ctx, code, 500, "Segment location upsert failed");
  }
}
