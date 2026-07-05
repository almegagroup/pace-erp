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
import type { ProdHandlerContext } from "./production.shared.ts";
import {
  assertManagerOrSARole,
  assertProdReadRole,
  parseBody,
  toTrimmedString,
  toUpperTrimmedString,
} from "./production.shared.ts";

const VALID_SEGMENTS = new Set(["ADMIX","HPS","IWC","POWDER","INT"]);

function segErr(req: Request, ctx: ProdHandlerContext, code: string, status: number, msg: string): Response {
  return errorResponse(code, msg, ctx.request_id, "NONE", status, {}, req);
}

// GET /api/production/segment-locations?company_id=
export async function listSegmentLocationsHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const url = new URL(req.url);
    const companyId = toTrimmedString(url.searchParams.get("company_id") ?? "");

    let query = serviceRoleClient
      .schema("erp_production").from("production_segment_location_config")
      .select(`
        id, company_id, segment_code, active, created_at, last_updated_at,
        rm_sloc:erp_inventory.storage_location_master!rm_sloc_id(id, code, name),
        pm_sloc:erp_inventory.storage_location_master!pm_sloc_id(id, code, name),
        shopfloor_sloc:erp_inventory.storage_location_master!shopfloor_sloc_id(id, code, name),
        fg_sloc:erp_inventory.storage_location_master!fg_sloc_id(id, code, name)
      `)
      .order("segment_code");

    if (companyId) query = query.eq("company_id", companyId);
    const { data, error } = await query;
    if (error) throw new Error("PROD_SEG_LOC_LIST_FAILED");
    return okResponse({ data: data ?? [] }, ctx.request_id, req);
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
