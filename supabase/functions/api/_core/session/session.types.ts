/*
 * File-ID: ID-3
 * File-Path: supabase/functions/api/_core/session/session.types.ts
 * Gate: 3
 * Phase: 3
 * Domain: SESSION
 * Purpose: Authoritative session lifecycle model and legal state transitions
 * Authority: Backend
 */

/**
 * All possible ERP session states.
 * This enum is the SINGLE source of truth for session lifecycle.
 */
export enum SESSION_STATE {
  CREATED = "CREATED",
  ACTIVE = "ACTIVE",
  IDLE = "IDLE",
  EXPIRED = "EXPIRED",
  REVOKED = "REVOKED",
  DEAD = "DEAD",
}

/**
 * States from which NO further transitions are allowed.
 * Any request encountering these states must be force-logged out.
 */
export const TERMINAL_SESSION_STATES: ReadonlySet<SESSION_STATE> = new Set([
  SESSION_STATE.EXPIRED,
  SESSION_STATE.REVOKED,
  SESSION_STATE.DEAD,
]);

/**
 * Legal state transitions for ERP sessions.
 * Any transition not listed here is INVALID and must be rejected.
 *
 * NOTE:
 * - Time-based transitions (idle / ttl) are enforced in later IDs.
 * - This file only defines WHAT is allowed, not WHEN it happens.
 */
export const SESSION_STATE_TRANSITIONS: Readonly<
  Record<SESSION_STATE, ReadonlyArray<SESSION_STATE>>
> = {
  [SESSION_STATE.CREATED]: [
    SESSION_STATE.ACTIVE,
    SESSION_STATE.REVOKED,
  ],

  [SESSION_STATE.ACTIVE]: [
    SESSION_STATE.IDLE,
    SESSION_STATE.EXPIRED,
    SESSION_STATE.REVOKED,
  ],

  [SESSION_STATE.IDLE]: [
    SESSION_STATE.ACTIVE,
    SESSION_STATE.EXPIRED,
    SESSION_STATE.REVOKED,
  ],

  [SESSION_STATE.EXPIRED]: [],

  [SESSION_STATE.REVOKED]: [],

  [SESSION_STATE.DEAD]: [],
};

/**
 * Utility guard to validate whether a state transition is legal.
 * This does NOT perform the transition — it only validates intent.
 */
export function isValidSessionTransition(
  from: SESSION_STATE,
  to: SESSION_STATE
): boolean {
  const allowed = SESSION_STATE_TRANSITIONS[from];
  return Array.isArray(allowed) && allowed.includes(to);
}

/**
 * Utility guard to check if a session state is terminal.
 */
export function isTerminalSessionState(state: SESSION_STATE): boolean {
  return TERMINAL_SESSION_STATES.has(state);
}
