/*
 * File-ID: 12B.3
 * File-Path: supabase/functions/api/_core/om/cost_center.handlers.ts
 * Gate: 12B
 * Phase: 12B
 * Domain: MASTER
 * Purpose: Cost center master CRUD handlers (SA-governed).
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

function costCenterErrorResponse(
  req: Request,
  ctx: OmHandlerContext,
  code: string,
  status: number,
  message: string,
): Response {
  return errorResponse(code, message, ctx.request_id, "NONE", status, {}, req);
}

export async function createCostCenterHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertOmSaContext(ctx);

    const body = await parseBody(req);
    const companyId = toTrimmedString(body.company_id);
    const costCenterCode = toTrimmedString(body.cost_center_code).toUpperCase();
    const costCenterName = toTrimmedString(body.cost_center_name);

    if (!companyId || !costCenterCode || !costCenterName) {
      return costCenterErrorResponse(req, ctx, "OM_CC_CREATE_FAILED", 400, "Invalid cost center input");
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_master")
      .from("cost_center_master")
      .insert({
        company_id: companyId,
        cost_center_code: costCenterCode,
        cost_center_name: costCenterName,
        description: toTrimmedString(body.description) || null,
        active: true,
        created_by: ctx.auth_user_id,
      })
      .select("*")
      .single();

    if (error) {
      if (error.code === "23505") {
        return costCenterErrorResponse(req, ctx, "OM_CC_EXISTS", 409, "Cost center already exists");
      }
      throw new Error("OM_CC_CREATE_FAILED");
    }

    return okResponse({ data }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_CC_CREATE_FAILED";
    const status = code === "OM_SA_REQUIRED" ? 403 : code.includes("EXISTS") ? 409 : code.includes("FAILED") ? 400 : 500;
    return costCenterErrorResponse(req, ctx, code, status, "Cost center create failed");
  }
}

export async function listCostCentersHandler(
  req: Request,
  ctx: OmHandlerContext,
): Promise<Response> {
  try {
    assertOmAdminContext(ctx);

    const url = new URL(req.url);
    const companyId = toTrimmedString(url.searchParams.get("company_id"));
    const active = url.searchParams.get("active");

    let query = serviceRoleClient
      .schema("erp_master")
      .from("cost_center_master")
      .select("*")
      .order("cost_center_code", { ascending: true });

    if (companyId) {
      query = query.eq("company_id", companyId);
    }
    if (active === "true") {
      query = query.eq("active", true);
    } else if (active === "false") {
      query = query.eq("active", false);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error("OM_CC_LIST_FAILED");
    }

    return okResponse({ data: data ?? [] }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "OM_CC_LIST_FAILED";
    const status = code === "OM_ADMIN_REQUIRED" ? 403 : 500;
    return costCenterErrorResponse(req, ctx, code, status, "Cost center list failed");
  }
}
