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
import { recordSessionTimeline } from "../_core/session/session_timeline.ts";
import { recordSecurityEvent } from "../_security/security_events.ts";

export type SessionResolution =
  | { status: "ABSENT"; action: "LOGOUT" }
  | {
      status: "ACTIVE";
      sessionId: string;
      authUserId: string;
      roleCode: string; // 🔥 ADD THIS
      created_at: string;
      last_seen_at: string;
      expires_at: string;
    }
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
  const sessionId = readCookie(req, "erp_session");

  if (!sessionId) {
    log({
      level: "OBSERVABILITY",
      request_id: _requestId,
      event: "SESSION_ABSENT",
    });
    recordSecurityEvent(req, _requestId, "SESSION_COOKIE_MISSING", "SESSION");

    return { status: "ABSENT", action: "LOGOUT" }; 
  }

  assertRlsEnabled();

  const { data, error } = await serviceRoleClient
    .schema("erp_core").from("sessions")
    .select("session_id, auth_user_id, role_code, status, created_at, last_seen_at, expires_at")
    .eq("session_id", sessionId)
    .single();

  if (error || !data) {
    log({
      level: "OBSERVABILITY",
      request_id: _requestId,
      event: "SESSION_REVOKED",
      meta: { session_id: sessionId },
    });
    recordSecurityEvent(req, _requestId, "SESSION_REVOKED", "SESSION");

    return { status: "REVOKED", action: "LOGOUT" };
  }

  if (data.status === "REVOKED") {
    recordSecurityEvent(req, _requestId, "SESSION_REVOKED","SESSION");
    return { status: "REVOKED", action: "LOGOUT" };
  }

  if (
    data.status === "EXPIRED" ||
    data.status === "DEAD" ||
    data.status === "IDLE" ||
    data.status === "CREATED"
  ) {
    return { status: "EXPIRED", action: "LOGOUT" };
  }

  log({
  level: "OBSERVABILITY",
  request_id: _requestId,
  event: "SESSION_ACTIVE",
  meta: { session_id: sessionId },
});

recordSessionTimeline({
  requestId: _requestId,
  sessionId: sessionId,
  userId: data.auth_user_id,
  event: "ACTIVE",
});

 return {
  status: "ACTIVE",
  sessionId,
  authUserId: data.auth_user_id,
  roleCode: data.role_code ?? "SA",   // 🔥 FROM SESSION (NO QUERY)
  created_at: data.created_at,
  last_seen_at: data.last_seen_at,
  expires_at: data.expires_at,
};
}