/*
 * File-ID: 2.2C
 * File-Path: supabase/functions/api/_pipeline/session.ts
 * Gate: 2
 * Phase: 2
 * Domain: SESSION
 * Purpose: Session lookup + bind invariant enforcement
 * Authority: Backend
 */

import { serviceRoleClient } from "../_shared/serviceRoleClient.ts";
import { assertRlsEnabled } from "../_shared/rls_assert.ts";
import { log } from "../_lib/logger.ts";

export type SessionResolution =
  | { status: "ABSENT"; action: "LOGOUT" }
  | { status: "ACTIVE"; sessionId: string; authUserId: string }
  | { status: "REVOKED"; action: "LOGOUT" }
  | { status: "EXPIRED"; action: "LOGOUT" };

function readCookie(req: Request, name: string): string | null {
  const cookie = req.headers.get("cookie");
  if (!cookie) return null;

  const parts = cookie.split(";").map(p => p.trim());
  for (const p of parts) {
    if (p.startsWith(name + "=")) {
      return p.slice(name.length + 1);
    }
  }
  return null;
}

export async function stepSession(
  req: Request,
  _requestId: string
): Promise<SessionResolution> {
  // ---- Cookie read (aligned with login) ----
  const sessionId = readCookie(req, "erp_session");

  if (!sessionId) {
    log({
    level: "OBSERVABILITY",
    request_id: _requestId,
    event: "SESSION_ABSENT",
  });
    return { status: "ABSENT", action: "LOGOUT" };
  }

  // ---- DB-backed session validation ----
  assertRlsEnabled();

  const { data, error } = await serviceRoleClient
    .from("erp_core.sessions")
    .select("auth_user_id, state")
    .eq("id", sessionId)
    .single();

  if (error || !data) {
    log({
  level: "OBSERVABILITY",
  request_id: _requestId,
  event: "SESSION_REVOKED",
  meta: {
    session_id: sessionId,
  },
});
    return { status: "REVOKED", action: "LOGOUT" };
  }

  if (data.state !== "ACTIVE") {
     log({
  level: "OBSERVABILITY",
  request_id: _requestId,
  event: "SESSION_EXPIRED",
  meta: {
    session_id: sessionId,
    state: data.state,
  },
});
    return { status: "EXPIRED", action: "LOGOUT" };
  }

  /**
   * ID-2.2C invariant:
   * session.auth_user_id is now authoritative identity
   * must be used by downstream auth / context steps
   */
log({
  level: "OBSERVABILITY",
  request_id: _requestId,
  event: "SESSION_ACTIVE",
  meta: {
    session_id: sessionId,
  },
});

return {
  status: "ACTIVE",
  sessionId,
  authUserId: data.auth_user_id,
};
}
