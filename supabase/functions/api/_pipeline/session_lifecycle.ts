/*
 * File-ID: ID-3.2A
 * File-Path: supabase/functions/api/_pipeline/session_lifecycle.ts
 * Gate: 3
 * Phase: 3
 * Domain: SESSION
 * Purpose: Deterministic lifecycle enforcement
 * Authority: Backend
 */

import type { SessionResolution } from "./session.ts";
import { log } from "../_lib/logger.ts";
import { recordSessionTimeline } from "../_core/session/session_timeline.ts";

export type SessionLifecycleResult =
  | SessionResolution
  | { status: "ABSOLUTE_WARNING"; action: "NONE" }
  | { status: "IDLE_WARNING"; action: "NONE" }
  | { status: "IDLE_EXPIRED"; action: "LOGOUT" }
  | { status: "TTL_EXPIRED"; action: "LOGOUT" };

export function enforceIdleLifecycle(
  session: SessionResolution,
  now: Date
): SessionLifecycleResult {

  // Only ACTIVE sessions are eligible for lifecycle enforcement
  if (session.status !== "ACTIVE") {
    return session;
  }

  const nowMs = now.getTime();
  const expiresAtMs = new Date(session.expires_at).getTime();
  const createdAtMs = new Date(session.created_at).getTime();
  const lastSeenMs = new Date(session.last_seen_at).getTime();

  // =====================================================
  // 1️⃣ Absolute TTL Enforcement (DB authoritative)
  // =====================================================

  if (nowMs >= expiresAtMs) {
    log({
      level: "OBSERVABILITY",
      event: "SESSION_TTL_EXPIRED",
    });
    return { status: "TTL_EXPIRED", action: "LOGOUT" };
  }

  // Absolute warning at 10h elapsed (12h TTL model)
  const ABSOLUTE_WARNING_MS = 10 * 60 * 60 * 1000; // 10h

  if (nowMs - createdAtMs >= ABSOLUTE_WARNING_MS) {
    log({
      level: "OBSERVABILITY",
      event: "SESSION_ABSOLUTE_WARNING",
    });
    return { status: "ABSOLUTE_WARNING", action: "NONE" };
  }

  // =====================================================
  // 2️⃣ Idle Enforcement
  // =====================================================

  const idleMs = nowMs - lastSeenMs;

  const IDLE_WARNING_MS = 10 * 60 * 1000;  // 10 minutes
  const IDLE_EXPIRE_MS  = 30 * 60 * 1000;  // 30 minutes

  if (idleMs >= IDLE_EXPIRE_MS) {
    log({
      level: "OBSERVABILITY",
      event: "SESSION_IDLE_EXPIRED",
    });

    recordSessionTimeline({
      requestId: "SYSTEM_IDLE",
      sessionId: session.sessionId,
      userId: session.authUserId,
      event: "IDLE",
    });

    return { status: "IDLE_EXPIRED", action: "LOGOUT" };
  }

  if (idleMs >= IDLE_WARNING_MS) {
    log({
      level: "OBSERVABILITY",
      event: "SESSION_IDLE_WARNING",
    });

    return { status: "IDLE_WARNING", action: "NONE" };
  }

  // =====================================================
  // 3️⃣ Session remains ACTIVE
  // =====================================================

  return session;
}
