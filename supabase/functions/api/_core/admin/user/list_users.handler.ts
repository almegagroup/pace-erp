/*
 * File-ID: 9.6
 * File-Path: supabase/functions/api/_core/admin/user/list_users.handler.ts
 * Gate: 9
 * Phase: 9
 * Domain: ADMIN
 * Purpose: List governable ERP users for Admin Universe governance
 * Authority: Backend
 */

import { getServiceRoleClientWithContext } from "../../../_shared/serviceRoleClient.ts";
import type { ContextResolution } from "../../../_pipeline/context.ts";
import { okResponse } from "../../response.ts";

/**
 * List Users (Admin Governance)
 *
 * Behaviour:
 * - Admin universe only (enforced upstream)
 * - Context must be RESOLVED
 * - Returns ACTIVE + DISABLED users
 * - Enumeration-safe
 * - No role inference
 * - No ACL materialization
 */
type HandlerContext = {
  context: ContextResolution;
  request_id: string;
};

export async function listUsersHandler(
  _req: Request,
  ctx: HandlerContext
): Promise<Response> {
  // --------------------------------------------------
  // Context gate (NO resolution here)
  // --------------------------------------------------
  if (ctx.context.status !== "RESOLVED") {
    return okResponse([], ctx.request_id);
  }

  // --------------------------------------------------
  // Context-aware DB client
  // --------------------------------------------------
  const db = getServiceRoleClientWithContext(ctx.context);

  // --------------------------------------------------
  // Fetch governable users
  // --------------------------------------------------
  const { data: users } = await db
    .schema("erp_core").from("users")
    .select(
      "auth_user_id, user_code, state, created_at"
    )
    .in("state", ["ACTIVE", "DISABLED"])
    .order("created_at", { ascending: true });

  const authUserIds = (users ?? []).map((user) => user.auth_user_id);

  const { data: roleRows } = authUserIds.length === 0
    ? { data: [] }
    : await db
      .schema("erp_acl").from("user_roles")
      .select("auth_user_id, role_code, role_rank")
      .in("auth_user_id", authUserIds);

  const { data: signupRows } = authUserIds.length === 0
    ? { data: [] }
    : await db
      .schema("erp_core").from("signup_requests")
      .select(
        "auth_user_id, name, parent_company_name, designation_hint, phone_number, decision, submitted_at"
      )
      .in("auth_user_id", authUserIds);

  const roleMap = new Map(
    (roleRows ?? []).map((row) => [row.auth_user_id, row])
  );
  const signupMap = new Map(
    (signupRows ?? []).map((row) => [row.auth_user_id, row])
  );

  const payload = (users ?? []).map((user) => {
    const roleRow = roleMap.get(user.auth_user_id);
    const signupRow = signupMap.get(user.auth_user_id);

    return {
      ...user,
      role_code: roleRow?.role_code ?? null,
      role_rank: roleRow?.role_rank ?? null,
      is_acl_user: Boolean(roleRow?.role_code),
      name: signupRow?.name ?? null,
      parent_company_name: signupRow?.parent_company_name ?? null,
      designation_hint: signupRow?.designation_hint ?? null,
      phone_number: signupRow?.phone_number ?? null,
      signup_decision: signupRow?.decision ?? null,
      signup_submitted_at: signupRow?.submitted_at ?? null,
    };
  });

  // --------------------------------------------------
  // Deterministic response
  // --------------------------------------------------
  return okResponse(payload, ctx.request_id);
}
