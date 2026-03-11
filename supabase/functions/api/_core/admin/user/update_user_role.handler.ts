/*
 * File-ID: 9.6
 * File-Path: supabase/functions/api/_core/admin/user/update_user_role.handler.ts
 * Gate: 9
 * Phase: 9
 * Domain: ADMIN
 * Purpose: Assign or change ERP user role with admin governance protection
 * Authority: Backend
 */

import { getServiceRoleClientWithContext } from "../../../_shared/serviceRoleClient.ts";
import type { ContextResolution } from "../../../_pipeline/context.ts";
import { okResponse } from "../../response.ts";
import {
  normalizeRoleCode,
  getRoleRank,
} from "../../../_shared/role_ladder.ts";
import { assertSelfLockoutSafe } from "./_guards/self_lockout.guard.ts";

/**
 * Update User Role
 *
 * Behaviour:
 * - Admin universe only (enforced upstream)
 * - Context must be RESOLVED
 * - Role normalization enforced
 * - Self-lockout protection enforced via guard
 * - Enumeration-safe
 */
type HandlerContext = {
  context: ContextResolution;
  request_id: string;
  auth_user_id: string; // actor
  roleCode: string;   // actor role (from session)
};

export async function updateUserRoleHandler(
  req: Request,
  ctx: HandlerContext
): Promise<Response> {
  // --------------------------------------------------
  // Context gate
  // --------------------------------------------------
  if (ctx.context.status !== "RESOLVED") {
    return okResponse(null, ctx.request_id);
  }

  const body = await req.json().catch(() => ({}));
  const { target_auth_user_id, next_role } = body ?? {};

  const normalizedRole = normalizeRoleCode(next_role);
  if (!target_auth_user_id || !normalizedRole) {
    return okResponse(null, ctx.request_id);
  }

  const nextRank = getRoleRank(normalizedRole);
  if (nextRank === null) {
    return okResponse(null, ctx.request_id);
  }

  const db = getServiceRoleClientWithContext(ctx.context);

  // --------------------------------------------------
  // Fetch current role of target (for self-lockout guard)
  // --------------------------------------------------
  const { data: currentRoleRow } = await db
    .from("erp_acl.user_roles")
    .select("role_code")
    .eq("auth_user_id", target_auth_user_id)
    .single();

  // --------------------------------------------------
  // Self-lockout protection (ID-9.6A)
  // --------------------------------------------------
  await assertSelfLockoutSafe({
    _actorAuthUserId: ctx.auth_user_id,
    actorRoleCode: ctx.roleCode,
    _targetAuthUserId: target_auth_user_id,
    targetCurrentRole: currentRoleRow?.role_code,
    targetNextRole: normalizedRole,
  });

  // --------------------------------------------------
  // Apply role update (single-role model)
  // --------------------------------------------------
  await db
    .from("erp_acl.user_roles")
    .update({
      role_code: normalizedRole,
      role_rank: nextRank,
      assigned_by: ctx.auth_user_id,
    })
    .eq("auth_user_id", target_auth_user_id);

  return okResponse(null, ctx.request_id);
}
