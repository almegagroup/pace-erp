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

  return okResponse(data, ctx.request_id);
}