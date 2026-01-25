/*
 * File-ID: 2.4B-AUTH-LOGOUT-IDEMPOTENT
 * File-Path: supabase/functions/api/_core/auth/logout.handler.ts
 * Gate: 2
 * Phase: 2
 * Domain: AUTH
 * Purpose: Logout API – idempotent, deterministic, cookie invalidation
 * Authority: Backend
 */

import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { assertRlsEnabled } from "../../_shared/rls_assert.ts";
import type { SessionResolution } from "../../_pipeline/session.ts";
import { log } from "../../_lib/logger.ts"; 

interface LogoutContext {
  session: SessionResolution;
  requestId: string;
  requestUrl: string;
}

function buildExpiredCookie(requestUrl: string): string {
  const url = new URL(requestUrl);
  const isHttps = url.protocol === "https:";

  const parts = [
    "erp_session=",
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  ];

  if (isHttps) parts.push("Secure");
  if (url.hostname) parts.push(`Domain=${url.hostname}`);

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
    gate: "2.7",
    event: "AUTH_LOGOUT",
  });

  // Try server-side revoke ONLY if there is an active session.
  // Failure here must NOT change the response.
  if (session.status === "ACTIVE") {
    try {
      assertRlsEnabled();
      await serviceRoleClient
        .from("erp_core.sessions")
        .update({ state: "REVOKED" })
        .eq("id", session.sessionId);
    } catch {
      // Intentionally swallowed — idempotency guarantee
    }
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
