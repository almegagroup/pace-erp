/*
 * File-ID: PHASE3D-SET-PRIMARY-COMPANY
 * File-Path: supabase/functions/api/_core/admin/user/set_primary_company.handler.ts
 * Gate: 9
 * Phase: 3
 * Domain: ADMIN
 * Purpose: SA sets the primary work company for a user. Used from User Management UI.
 * Authority: Backend
 *
 * Rules:
 *   - SA only
 *   - Target company must already exist in user's user_companies rows
 *   - Resets all other companies to is_primary = false
 *   - Does NOT change which companies the user has access to
 *   - Affects default company at next login only (workspace_mode is session-bound)
 */

import { getServiceRoleClientWithContext } from "../../../_shared/serviceRoleClient.ts";
import type { ContextResolution } from "../../../_pipeline/context.ts";
import { okResponse, errorResponse } from "../../response.ts";

type HandlerContext = {
  context: ContextResolution;
  request_id: string;
  auth_user_id: string;
};

function blocked(
  code: string,
  message: string,
  ctx: HandlerContext,
  status = 403,
): Response {
  return errorResponse(
    code,
    message,
    ctx.request_id,
    "NONE",
    status,
    {
      gateId: "SA.SET_PRIMARY_COMPANY",
      routeKey: "PATCH:/api/admin/users/scope/primary-company",
      decisionTrace: code,
    },
  );
}

export async function setPrimaryCompanyHandler(
  req: Request,
  ctx: HandlerContext,
): Promise<Response> {
  if (ctx.context.status !== "RESOLVED" || ctx.context.isAdmin !== true) {
    return blocked("ADMIN_ONLY", "SA access required", ctx, 403);
  }

  const body = await req.json().catch(() => null);
  const targetAuthUserId = typeof body?.auth_user_id === "string"
    ? body.auth_user_id.trim()
    : null;
  const targetCompanyId = typeof body?.company_id === "string"
    ? body.company_id.trim()
    : null;

  if (!targetAuthUserId || !targetCompanyId) {
    return blocked(
      "SET_PRIMARY_INPUT_INVALID",
      "auth_user_id and company_id required",
      ctx,
      400,
    );
  }

  const db = getServiceRoleClientWithContext(ctx.context);

  // 1. Verify target user exists
  const { data: user, error: userError } = await db
    .schema("erp_core")
    .from("users")
    .select("auth_user_id")
    .eq("auth_user_id", targetAuthUserId)
    .maybeSingle();

  if (userError) {
    return blocked("SET_PRIMARY_USER_LOOKUP_FAILED", "user lookup failed", ctx, 500);
  }

  if (!user) {
    return blocked("SET_PRIMARY_USER_NOT_FOUND", "user not found", ctx, 404);
  }

  // 2. Verify the target company is already assigned to this user
  const { data: membership, error: membershipError } = await db
    .schema("erp_map")
    .from("user_companies")
    .select("company_id")
    .eq("auth_user_id", targetAuthUserId)
    .eq("company_id", targetCompanyId)
    .maybeSingle();

  if (membershipError) {
    return blocked("SET_PRIMARY_MEMBERSHIP_LOOKUP_FAILED", "membership lookup failed", ctx, 500);
  }

  if (!membership) {
    return blocked(
      "SET_PRIMARY_COMPANY_NOT_ASSIGNED",
      "company is not assigned to this user",
      ctx,
      403,
    );
  }

  // 3. Reset all is_primary = false for this user
  const { error: resetError } = await db
    .schema("erp_map")
    .from("user_companies")
    .update({ is_primary: false })
    .eq("auth_user_id", targetAuthUserId)
    .eq("is_primary", true);

  if (resetError) {
    return blocked("SET_PRIMARY_RESET_FAILED", "primary reset failed", ctx, 500);
  }

  // 4. Set is_primary = true for the target company
  const { error: setError } = await db
    .schema("erp_map")
    .from("user_companies")
    .update({ is_primary: true })
    .eq("auth_user_id", targetAuthUserId)
    .eq("company_id", targetCompanyId);

  if (setError) {
    return blocked("SET_PRIMARY_SET_FAILED", "primary set failed", ctx, 500);
  }

  console.info("SET_PRIMARY_COMPANY_APPLIED", {
    request_id: ctx.request_id,
    actor_auth_user_id: ctx.auth_user_id,
    target_auth_user_id: targetAuthUserId,
    primary_company_id: targetCompanyId,
  });

  return okResponse(
    {
      auth_user_id: targetAuthUserId,
      primary_company_id: targetCompanyId,
      updated_by: ctx.auth_user_id,
      note: "Change takes effect at user's next login",
    },
    ctx.request_id,
  );
}
