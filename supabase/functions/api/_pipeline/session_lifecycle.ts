/*
 * File-ID: ID-3.2A
 * File-Path: supabase/functions/api/_pipeline/session_lifecycle.ts
 * Gate: 3
 * Phase: 3
 * Domain: SESSION
 * Purpose: Idle + Absolute TTL lifecycle enforcement (no extension)
 * Authority: Backend
 */

import type { SessionResolution } from "./session.ts";
import { log } from "../_lib/logger.ts";

/**
 * STEP 8.2 — Device change detector (soft)
 * Signal only, no enforcement
 */
function isDeviceChanged(ctx: any): boolean {
  if (!ctx?.device_id) return false;
  if (!ctx?.previous_device_id) return false;

  return ctx.device_id !== ctx.previous_device_id;
}

/**
 * All possible lifecycle outcomes after Gate-3 evaluation.
 */
export type SessionLifecycleResult =
  | SessionResolution
  | { status: "IDLE_WARNING"; action: "NONE" }
  | { status: "IDLE_EXPIRED"; action: "LOGOUT" }
  | { status: "TTL_EXPIRED"; action: "LOGOUT" };

/**
 * ID-3.1 + 3.1A + 3.1B + 3.2 + 3.2A
 *
 * Unified session lifecycle engine.
 *
 * RULES:
 * - Gate-2 decides whether session EXISTS
 * - Gate-3 decides whether session MAY CONTINUE
 *
 * GUARANTEES:
 * - No DB mutation
 * - No TTL extension ever
 * - No idle logic affects TTL
 * - Absolute TTL always wins
 */
export function enforceIdleLifecycle(
  session: SessionResolution,
  now: Date
): SessionLifecycleResult {
  // --------------------------------------------------
  // Gate-2 non-active outcomes pass through untouched
  // --------------------------------------------------
  if (session.status !== "ACTIVE") {
    return session;
  }

  const ctx = session as any;

  // --------------------------------------------------
  // ID-3.2 + 3.2A — Absolute TTL (age-based, NO extension)
  // --------------------------------------------------
  const createdAt = ctx.created_at; // future DB column
  if (createdAt) {
    const bornAt = new Date(createdAt).getTime();
    const ageMs = now.getTime() - bornAt;

    /**
     * SYMBOLIC TTL
     * Real value will be locked in config / later ID
     */
    const ABSOLUTE_TTL_MS = 0;

    if (ageMs >= ABSOLUTE_TTL_MS) {
        log({
    level: "OBSERVABILITY",
    event: "SESSION_TTL_EXPIRED",
    meta: {
      age_ms: ageMs,
    },
  });
      return { status: "TTL_EXPIRED", action: "LOGOUT" };
    }
  }

  // --------------------------------------------------
  // ID-3.1 + 3.1A + 3.1B — Idle handling (activity-based)
  // --------------------------------------------------
  const lastActivity = ctx.last_activity_at; // future DB column
  if (!lastActivity) {
    return session;
  }

  const last = new Date(lastActivity).getTime();
  const idleMs = now.getTime() - last;

  /**
   * SYMBOLIC thresholds
   * Real values will be locked later
   */
  const IDLE_WARNING_MS = 0;
  const IDLE_EXPIRE_MS = 0;

  if (idleMs >= IDLE_EXPIRE_MS) {
     log({
    level: "OBSERVABILITY",
    event: "SESSION_IDLE_EXPIRED",
    meta: {
      idle_ms: idleMs,
    },
  });
    return { status: "IDLE_EXPIRED", action: "LOGOUT" };
  }

 if (idleMs >= IDLE_WARNING_MS) {
      log({
    level: "OBSERVABILITY",
    event: "SESSION_IDLE_WARNING",
    meta: {
      idle_ms: idleMs,
    },
  });
    return { status: "IDLE_WARNING", action: "NONE" };
  }

  // --------------------------------------------------
  // ID-3.5A — Device change signal (soft, non-blocking)
  // --------------------------------------------------
  if (isDeviceChanged(ctx)) {
    log({
    level: "OBSERVABILITY",
    event: "SESSION_DEVICE_CHANGED",
    meta: {
      device_id: ctx.device_id,
      previous_device_id: ctx.previous_device_id,
    },
  });
    // Signal only — NO logout, NO deny
    // Future hook: audit / alert / notification
    // Example: DEVICE_CHANGED event
  }

  return session;
}
