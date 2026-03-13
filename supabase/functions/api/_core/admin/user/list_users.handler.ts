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
  const { data } = await db
    .schema("erp_core").from("users")
    .select(
      "auth_user_id, user_code, state, created_at"
    )
    .in("state", ["ACTIVE", "DISABLED"])
    .order("created_at", { ascending: true });

  // --------------------------------------------------
  // Deterministic response
  // --------------------------------------------------
  return okResponse(data ?? [], ctx.request_id);
}
