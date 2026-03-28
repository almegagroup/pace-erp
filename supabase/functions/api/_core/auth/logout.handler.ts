/*
 * File-ID: 2.4B-AUTH-LOGOUT-IDEMPOTENT
 * File-Path: supabase/functions/api/_core/auth/logout.handler.ts
 * Gate: 2
 * Phase: 2
 * Domain: AUTH
 * Purpose: Logout API with deterministic cookie invalidation and cluster-wide termination.
 * Authority: Backend
 */

import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { assertRlsEnabled } from "../../_shared/rls_assert.ts";
import type { SessionResolution } from "../../_pipeline/session.ts";
import { log } from "../../_lib/logger.ts";
import { recordSessionTimeline } from "../session/session_timeline.ts";
import { terminateSessionCluster } from "../session/session.cluster.ts";
import {
  SESSION_CLUSTER_STATE,
  SESSION_CLUSTER_WINDOW_STATE,
} from "../session/session.cluster.types.ts";

interface LogoutContext {
  session: SessionResolution;
  requestId: string;
  requestUrl: string;
}

function buildExpiredCookie(requestUrl: string): string {
  const url = new URL(requestUrl);
  const hostname = url.hostname;

  const isLocalhost =
    hostname.includes("localhost") ||
    hostname.includes("127.0.0.1");

  const parts = [
    "erp_session=",
    "Path=/",
    "HttpOnly",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  ];

  if (!isLocalhost) {
    parts.push("SameSite=None");
    parts.push("Secure");
    parts.push("Domain=almegagroup.in");
    parts.push("Priority=High");
  } else {
    parts.push("SameSite=Lax");
  }

  return parts.join("; ");
}

export async function logoutHandler(ctx: LogoutContext): Promise<Response> {
  const { session, requestId, requestUrl } = ctx;
  const expiredCookie = buildExpiredCookie(requestUrl);

  log({
    level: "SECURITY",
    request_id: requestId,
    gate_id: "2.7",
    event: "AUTH_LOGOUT",
  });

  if (session.status === "ACTIVE") {
    try {
      assertRlsEnabled();

      if (session.clusterId) {
        await terminateSessionCluster({
          clusterId: session.clusterId,
          clusterStatus: SESSION_CLUSTER_STATE.REVOKED,
          windowStatus: SESSION_CLUSTER_WINDOW_STATE.REVOKED,
          sessionStatus: "REVOKED",
          reason: "USER_LOGOUT",
          actedByAuthUserId: session.authUserId,
        });
      } else {
        await serviceRoleClient
          .schema("erp_core")
          .from("sessions")
          .update({
            status: "REVOKED",
            revoked_at: new Date().toISOString(),
            revoked_reason: "USER_LOGOUT",
            revoked_by: session.authUserId,
          })
          .eq("session_id", session.sessionId)
          .eq("status", "ACTIVE");
      }
    } catch {
      // Idempotent logout must not fail closed on DB write issues.
    }

    recordSessionTimeline({
      requestId,
      sessionId: session.sessionId,
      userId: session.authUserId,
      event: "LOGOUT",
    });
  }

  return new Response(
    JSON.stringify({
      ok: false,
      code: "AUTH_LOGGED_OUT",
      message: "Logged out",
      action: "LOGOUT",
      request_id: requestId,
    }),
    {
      status: 200,
      headers: {
        "Set-Cookie": expiredCookie,
      },
    }
  );
}
