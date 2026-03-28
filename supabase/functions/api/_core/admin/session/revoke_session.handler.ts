/*
 * File-ID: 9.15B
 * File-Path: supabase/functions/api/_core/admin/session/revoke_session.handler.ts
 * Gate: 9
 * Phase: 9
 * Domain: SECURITY
 * Purpose: Admin forced session revoke with cluster-wide termination semantics.
 * Authority: Backend
 */

import { okResponse, errorResponse } from "../../response.ts";
import { getServiceRoleClientWithContext } from "../../../_shared/serviceRoleClient.ts";
import { log } from "../../../_lib/logger.ts";
import { terminateSessionCluster } from "../../session/session.cluster.ts";
import {
  SESSION_CLUSTER_STATE,
  SESSION_CLUSTER_WINDOW_STATE,
} from "../../session/session.cluster.types.ts";

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

  const { data: sessionRow, error: sessionReadError } = await db
    .schema("erp_core")
    .from("sessions")
    .select("session_id, cluster_id, auth_user_id")
    .eq("session_id", body.session_id)
    .maybeSingle();

  if (sessionReadError) {
    return errorResponse(
      "SESSION_REVOKE_LOOKUP_FAILED",
      sessionReadError.message,
      ctx.request_id,
      "NONE",
      500
    );
  }

  if (!sessionRow?.session_id) {
    return okResponse(
      {
        revoked: false,
        session_id: body.session_id,
      },
      ctx.request_id
    );
  }

  try {
    if (sessionRow.cluster_id) {
      await terminateSessionCluster({
        clusterId: sessionRow.cluster_id,
        clusterStatus: SESSION_CLUSTER_STATE.REVOKED,
        windowStatus: SESSION_CLUSTER_WINDOW_STATE.REVOKED,
        sessionStatus: "REVOKED",
        reason: "ADMIN_REVOKE",
      });
    } else {
      const { error } = await db
        .schema("erp_core")
        .from("sessions")
        .update({
          status: "REVOKED",
          revoked_at: new Date().toISOString(),
          revoked_reason: "ADMIN_REVOKE",
        })
        .eq("session_id", body.session_id);

      if (error) {
        throw error;
      }
    }
  } catch (error) {
    log({
      level: "ERROR",
      gate_id: "9.15B",
      request_id: ctx.request_id,
      route_key: "POST:/api/admin/sessions/revoke",
      event: "SESSION_REVOKE_FAILED",
      meta: {
        session_id: body.session_id,
        error_message: error instanceof Error ? error.message : String(error),
      },
    });

    return errorResponse(
      "SESSION_REVOKE_FAILED",
      error instanceof Error ? error.message : String(error),
      ctx.request_id,
      "NONE",
      500
    );
  }

  return okResponse(
    {
      revoked: true,
      session_id: body.session_id,
    },
    ctx.request_id
  );
}
