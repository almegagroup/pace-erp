/*
 * File-Path: supabase/functions/api/_core/production/shift_master.handlers.ts
 * Domain: PRODUCTION
 * Purpose: MTS Process PO Create (Page 3) "Shift" field -- company-wise,
 *          inline-create-as-you-go list (no dedicated SA config screen).
 * Authority: Backend
 */

import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { okResponse, errorResponse } from "../response.ts";
import { assertCompanyScope } from "../../_shared/companyScope.ts";
import { canMaintainCompanyResource } from "../../_shared/companyResourceAccess.ts";
import type { ProdHandlerContext } from "./production.shared.ts";
import { assertProdReadRole, parseBody, toTrimmedString } from "./production.shared.ts";

type JsonRecord = Record<string, unknown>;

function shiftError(req: Request, ctx: ProdHandlerContext, code: string, status: number, msg: string): Response {
  return errorResponse(code, msg, ctx.request_id, "NONE", status, {}, req);
}

function createdOkResponse(data: unknown, requestId: string, req?: Request): Response {
  const response = okResponse(data, requestId, req);
  return new Response(response.body, { status: 201, headers: response.headers });
}

// GET /api/production/shifts?company_id=
export async function listShiftsHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const url = new URL(req.url);
    const companyId = toTrimmedString(url.searchParams.get("company_id") ?? "");
    if (!companyId) {
      return shiftError(req, ctx, "PROD_SHIFT_COMPANY_REQUIRED", 400, "company_id required");
    }
    try {
      await assertCompanyScope(ctx, companyId);
    } catch {
      return shiftError(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_production")
      .from("shift_master")
      .select("id, company_id, shift_name, active")
      .eq("company_id", companyId)
      .eq("active", true)
      .order("shift_name");
    if (error) {
      console.error("[shift_master.listShifts] query failed:", JSON.stringify(error));
      throw new Error("PROD_SHIFT_LIST_FAILED");
    }
    return okResponse({ data: data ?? [] }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_SHIFT_LIST_FAILED";
    return shiftError(req, ctx, code, 500, "Shift list failed");
  }
}

// POST /api/production/shifts { company_id, shift_name }
export async function createShiftHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const body = await parseBody(req);
    const companyId = toTrimmedString(body.company_id);
    const shiftName = toTrimmedString(body.shift_name);
    if (!companyId || !shiftName) {
      return shiftError(req, ctx, "PROD_SHIFT_INVALID", 400, "company_id and shift_name required");
    }
    try {
      await assertCompanyScope(ctx, companyId);
    } catch {
      return shiftError(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }
    // Company-scope write-ACL guard (2026-09-18): assertCompanyScope only proves
    // MEMBERSHIP at companyId (which comes from the request body, not
    // ctx.context.companyId -- so it can legitimately differ from the company the
    // route-registry's stepAcl() already checked). A multi-company user with a
    // WRITE grant at their session's active company but only a lesser grant (or
    // none) at this specific companyId must not be able to create a Shift there.
    // Rides the same PROD_PO_CREATE:WRITE resource the route itself is registered
    // under (route-acl-registry.ts).
    if (!(await canMaintainCompanyResource(ctx, companyId, "PROD_PO_CREATE", "WRITE"))) {
      return shiftError(req, ctx, "PROD_SHIFT_COMPANY_ACCESS_DENIED", 403, "You do not have access to create a Shift for this company.");
    }

    // Case-insensitive dedupe so "Day" and "day" typed on two different POs
    // don't create two rows -- inline-create-as-you-go has no separate admin
    // screen to clean this up later.
    const { data: existing, error: existingErr } = await serviceRoleClient
      .schema("erp_production")
      .from("shift_master")
      .select("id, active, shift_name")
      .eq("company_id", companyId)
      .ilike("shift_name", shiftName)
      .maybeSingle();
    if (existingErr) {
      console.error("[shift_master.createShift] lookup failed:", JSON.stringify(existingErr));
      throw new Error("PROD_SHIFT_CREATE_FAILED");
    }
    if (existing) {
      if ((existing as JsonRecord).active === false) {
        const { error: reactivateErr } = await serviceRoleClient
          .schema("erp_production")
          .from("shift_master")
          .update({ active: true })
          .eq("id", String((existing as JsonRecord).id));
        if (reactivateErr) {
          console.error("[shift_master.createShift] reactivate failed:", JSON.stringify(reactivateErr));
          throw new Error("PROD_SHIFT_CREATE_FAILED");
        }
      }
      return createdOkResponse(
        { id: (existing as JsonRecord).id, shift_name: (existing as JsonRecord).shift_name },
        ctx.request_id,
        req,
      );
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_production")
      .from("shift_master")
      .insert({ company_id: companyId, shift_name: shiftName, active: true, created_by: ctx.auth_user_id })
      .select("id, shift_name")
      .single();
    if (error) {
      if ((error as { code?: string }).code === "23505") {
        return shiftError(req, ctx, "PROD_SHIFT_EXISTS", 409, "Shift already exists for this company");
      }
      console.error("[shift_master.createShift] insert failed:", JSON.stringify(error));
      throw new Error("PROD_SHIFT_CREATE_FAILED");
    }
    return createdOkResponse(data, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_SHIFT_CREATE_FAILED";
    return shiftError(req, ctx, code, 500, "Shift create failed");
  }
}
