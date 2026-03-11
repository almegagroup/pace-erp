/*
 * File-ID: ID-10.3-SESSION-TIMELINE
 * File-Path: supabase/functions/api/_core/session/session_timeline.ts
 * gate_id: 10
 * Phase: 10
 * Domain: SESSION
 * Purpose: Deterministic recording of ERP session lifecycle transitions
 * Authority: Backend Observability Layer
 */

import { log } from "../../_lib/logger.ts";

/**
 * SESSION LIFECYCLE EVENTS
 *
 * LOGIN   → Session created
 * ACTIVE  → Valid session used by request
 * IDLE    → Session validated but inactive for period
 * LOGOUT  → User initiated logout
 * REVOKE  → Admin forced revoke
 */

export type SessionLifecycleEvent =
  | "LOGIN"
  | "ACTIVE"
  | "IDLE"
  | "LOGOUT"
  | "REVOKE";

interface SessionTimelineInput {
  requestId: string;
  sessionId?: string;
  userId?: string;
  event: SessionLifecycleEvent;
}

/**
 * STEP 10.3 — Session Timeline Recorder
 *
 * Behaviour:
 * - Records deterministic lifecycle transitions
 * - Does NOT affect session validation logic
 * - Pure observability layer
 *
 * Recorded fields:
 * - request_id
 * - session_id
 * - user_id
 * - transition
 *
 * Storage:
 * - Structured log via enterprise logger
 */
export function recordSessionTimeline(
  input: SessionTimelineInput
): void {
  log({
  level: "OBSERVABILITY",
  gate_id: "10.3",
  event: "session_timeline",
  request_id: input.requestId,

  meta: {
    session_id: input.sessionId ?? null,
    user_id: input.userId ?? null,
    transition: input.event,
  },
});
}