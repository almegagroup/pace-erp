/*
 * File-ID: 2.4B-AUTH-LOGOUT-IDEMPOTENT
 * File-Path: supabase/functions/api/_core/auth/logout.handler.ts
 * gate_id: 2
 * Phase: 2
 * Domain: AUTH
 * Purpose: Logout API – idempotent, deterministic, cookie invalidation
 * Authority: Backend
 */

import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { assertRlsEnabled } from "../../_shared/rls_assert.ts";
import type { SessionResolution } from "../../_pipeline/session.ts";
import { log } from "../../_lib/logger.ts"; 
import { recordSessionTimeline } from "../session/session_timeline.ts";

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
    // 🔥 MUST MATCH LOGIN COOKIE EXACTLY
    parts.push("SameSite=None");
    parts.push("Secure");
    parts.push("Domain=almegagroup.in"); // 🔥 CRITICAL
    parts.push("Priority=High");
  } else {
    // 🧪 DEV
    parts.push("SameSite=Lax");
  }

  return parts.join("; ");
}
/**
 * /api/logout
 * RULES:
 * - ALWAYS idempotent
 * - ALWAYS invalidates cookie
 * - ALWAYS returns LOGOUT action
 * - DB errors never block logout
 */
export async function logoutHandler(ctx: LogoutContext): Promise<Response> {
  const { session, requestId, requestUrl } = ctx;
  const expiredCookie = buildExpiredCookie(requestUrl);

  // ID-2.7: Auth event log (always)
  log({
    level: "SECURITY",
    request_id: requestId,
    gate_id: "2.7",
    event: "AUTH_LOGOUT",
  });

  // Try server-side revoke ONLY if there is an active session.
  // Failure here must NOT change the response.
  if (session.status === "ACTIVE") {
  try {
    assertRlsEnabled();
    await serviceRoleClient
      .schema("erp_core").from("sessions")
      .update({
        status: "REVOKED",
        revoked_at: new Date().toISOString(),
        revoked_reason: "USER_LOGOUT",
        revoked_by: session.authUserId,
      })
      .eq("session_id", session.sessionId)
      .eq("status", "ACTIVE");
  } catch {
    // Intentionally swallowed — idempotency guarantee
  }

  recordSessionTimeline({
    requestId: requestId,
    sessionId: session.sessionId,
    userId: session.authUserId,
    event: "LOGOUT",
  });
}
  
  

  // Deterministic logout response (same for all cases)
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
