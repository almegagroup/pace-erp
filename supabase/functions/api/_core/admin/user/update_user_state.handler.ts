/*
 * File-ID: 9.6
 * File-Path: supabase/functions/api/_core/admin/user/update_user_state.handler.ts
 * Gate: 9
 * Phase: 9
 * Domain: ADMIN
 * Purpose: Activate or suspend ERP user with admin governance invariants
 * Authority: Backend
 */

import { getServiceRoleClientWithContext } from "../../../_shared/serviceRoleClient.ts";
import type { ContextResolution } from "../../../_pipeline/context.ts";
import { okResponse } from "../../response.ts";
import { adminForceRevokeSessions } from "../../session/session.admin_revoke.ts";
import { assertSelfLockoutSafe } from "./_guards/self_lockout.guard.ts";

/**
 * Update User State (ACTIVE / DISABLED)
 *
 * Behaviour:
 * - Admin universe only (enforced upstream)
 * - Context must be RESOLVED
 * - Self-lockout prevention enforced via guard
 * - DISABLED ⇒ force revoke all sessions
 * - Enumeration-safe
 */
type HandlerContext = {
  context: ContextResolution;
  request_id: string;
  auth_user_id: string; // actor
  roleCode: string;    // actor role (from session)
};

export async function updateUserStateHandler(
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
  const { target_auth_user_id, next_state } = body ?? {};

  if (
    !target_auth_user_id ||
    (next_state !== "ACTIVE" && next_state !== "DISABLED")
  ) {
    return okResponse(null, ctx.request_id);
  }

  const db = getServiceRoleClientWithContext(ctx.context);

  // --------------------------------------------------
  // Fetch target current role (for self-lockout guard)
  // --------------------------------------------------
  const { data: roleRow } = await db
    .schema("erp_acl").from("user_roles")
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
    targetCurrentRole: roleRow?.role_code,
    targetNextState: next_state,
  });

  // --------------------------------------------------
  // Apply state change (idempotent)
  // --------------------------------------------------
  await db
    .schema("erp_core").from("users")
    .update({ state: next_state })
    .eq("auth_user_id", target_auth_user_id);

  // --------------------------------------------------
  // Force session revoke on DISABLED
  // --------------------------------------------------
  if (next_state === "DISABLED") {
    await adminForceRevokeSessions(
      target_auth_user_id,
      ctx.auth_user_id
    );
  }

  return okResponse(null, ctx.request_id);
}
