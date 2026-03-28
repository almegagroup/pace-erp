/*
 * File-ID: 9.15A
 * File-Path: supabase/functions/api/_core/admin/session/list_sessions.handler.ts
 * Gate: 9
 * Phase: 9
 * Domain: SECURITY
 * Purpose: Admin viewer for active ERP sessions
 * Authority: Backend
 */

import { okResponse, errorResponse } from "../../response.ts";
import { getServiceRoleClientWithContext } from "../../../_shared/serviceRoleClient.ts";

import type { ContextResolution } from "../../../_pipeline/context.ts";

interface SessionViewerCtx {
  context: ContextResolution;
  request_id: string;
}

export async function listSessionsHandler(
  _req: Request,
  ctx: SessionViewerCtx
): Promise<Response> {

  if (ctx.context.status !== "RESOLVED") {
    return errorResponse(
      "CONTEXT_UNRESOLVED",
      "Session context unresolved",
      ctx.request_id,
      "NONE",
      403
    );
  }

  const db = getServiceRoleClientWithContext(ctx.context);

  const { data, error } = await db
    .schema("erp_core").from("sessions")
    .select(`
      session_id,
      auth_user_id,
      cluster_id,
      status,
      created_at,
      last_seen_at,
      expires_at,
      revoked_at
    `)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    return errorResponse(
      "SESSION_READ_FAILED",
      error.message,
      ctx.request_id,
      "NONE",
      500
    );
  }

  const authUserIds = (data ?? []).map((row) => row.auth_user_id);

  const { data: userRows } = authUserIds.length === 0
    ? { data: [] }
    : await db
      .schema("erp_core").from("users")
      .select("auth_user_id, user_code, state")
      .in("auth_user_id", authUserIds);

  const { data: signupRows } = authUserIds.length === 0
    ? { data: [] }
    : await db
      .schema("erp_core").from("signup_requests")
      .select("auth_user_id, name, parent_company_name, designation_hint")
      .in("auth_user_id", authUserIds);

  const userMap = new Map(
    (userRows ?? []).map((row) => [row.auth_user_id, row])
  );
  const signupMap = new Map(
    (signupRows ?? []).map((row) => [row.auth_user_id, row])
  );

  const payload = (data ?? []).map((session) => {
    const userRow = userMap.get(session.auth_user_id);
    const signupRow = signupMap.get(session.auth_user_id);

    return {
      ...session,
      user_code: userRow?.user_code ?? null,
      user_state: userRow?.state ?? null,
      name: signupRow?.name ?? null,
      parent_company_name: signupRow?.parent_company_name ?? null,
      designation_hint: signupRow?.designation_hint ?? null,
    };
  });

  return okResponse(payload, ctx.request_id);
}
