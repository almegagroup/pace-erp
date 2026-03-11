/*
 * File-ID: 0.7 → 10.1 / 10.1A
 * File-Path: supabase/functions/api/_lib/logger.ts
 * Gate: 0 → 10
 * Phase: 0 → 10
 * Domain: OBSERVABILITY
 * Purpose: Structured deterministic logging utility (Gate-10 compliant)
 * Authority: Backend
 */

export type LogLevel =
  | "INFO"
  | "WARN"
  | "ERROR"
  | "FATAL"
  | "SECURITY"
  | "OBSERVABILITY";

interface LogPayload {
  level: LogLevel;

  /** request correlation */
  request_id?: string;

  /** pipeline stage / gate */
  gate_id?: string;

  /** request route identity */
  route_key?: string;

  /** event name */
  event: string;

  /** ACL / decision trace */
  decision?: string;

  /** actor identifier */
  actor?: string;

  /** additional metadata */
  meta?: Record<string, unknown>;
}

export function log(payload: LogPayload) {
  const entry = {
    ts: new Date().toISOString(),

    level: payload.level,
    request_id: payload.request_id ?? null,
    gate_id: payload.gate_id ?? null,
    route_key: payload.route_key ?? null,
    event: payload.event,
    decision: payload.decision ?? null,
    actor: payload.actor ?? null,

    meta: payload.meta ?? {},
  };

  // single deterministic output channel
  console.log(JSON.stringify(entry));
}