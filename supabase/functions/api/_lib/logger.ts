/*
 * File-ID: 0.7
 * File-Path: supabase/functions/api/_lib/logger.ts
 * Gate: 0
 * Phase: 0
 * Domain: SECURITY
 * Purpose: Provide structured, deterministic logging utility
 * Authority: Backend
 */

type LogLevel = "INFO" | "WARN" | "ERROR" | "SECURITY" | "OBSERVABILITY";
interface LogPayload {
  level: LogLevel;
  request_id?: string;
  gate?: string;
  event: string;
  actor?: string;
  meta?: Record<string, unknown>;
}

export function log(payload: LogPayload) {
  const entry = {
    ts: new Date().toISOString(),
    ...payload,
  };

  // Single output path (stdout)
  console.log(JSON.stringify(entry));
}
