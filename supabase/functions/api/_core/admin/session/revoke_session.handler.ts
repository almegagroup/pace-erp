/*
 * File-ID: 9.15B
 * File-Path: supabase/functions/api/_core/admin/session/revoke_session.handler.ts
 * Gate: 9
 * Phase: 9
 * Domain: SECURITY
 * Purpose: Admin forced session revoke
 * Authority: Backend
 */

import { okResponse, errorResponse } from "../../response.ts";
import { getServiceRoleClientWithContext } from "../../../_shared/serviceRoleClient.ts";

import type { ContextResolution } from "../../../_pipeline/context.ts";

interface SessionRevokeCtx {
  context: ContextResolution;
  request_id: string;
}

export async function revokeSessionHandler(
  req: Request,
  ctx: SessionRevokeCtx
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

  const body = await req.json().catch(() => null);

  if (!body?.session_id) {
    return errorResponse(
      "SESSION_INVALID_INPUT",
      "Invalid session revoke request",
      ctx.request_id,
      "NONE",
      400
    );
  }

  const db = getServiceRoleClientWithContext(ctx.context);

  const { error } = await db
    .schema("erp_core").from("sessions")
    .update({
      status: "REVOKED",
      revoked_at: new Date().toISOString(),
      revoked_reason: "ADMIN_REVOKE"
    })
    .eq("session_id", body.session_id);

  if (error) {
    return errorResponse(
      "SESSION_REVOKE_FAILED",
      error.message,
      ctx.request_id,
      "NONE",
      500
    );
  }

  return okResponse({ revoked: true }, ctx.request_id);
}