/*
 * File-ID: 9
 * File-Path: supabase/functions/api/_security/security_events.ts
 * Gate: 10
 * Phase: 10
 * Domain: SECURITY
 * Purpose: Deterministic security event logging for threat visibility
 * Authority: Backend
 *
 * NOTE:
 * - This module NEVER blocks requests
 * - It ONLY records security-relevant violations
 * - Used for security audit trail and incident investigation
 */

import { log } from "../_lib/logger.ts";

/* --------------------------------------------------
 * Event Types
 * -------------------------------------------------- */

export type SecurityEvent =
  | "CSRF_BLOCKED_NO_ORIGIN_REFERER"
  | "CSRF_INVALID_ORIGIN"
  | "CSRF_INVALID_REFERER"
  | "CSRF_MALFORMED_REFERER"
  | "CORS_BLOCKED_ORIGIN"
  | "AUTH_RATE_LIMIT_IP"
  | "AUTH_RATE_LIMIT_ACCOUNT"
  | "SESSION_COOKIE_MISSING"
  | "SESSION_REVOKED"
  | "SESSION_EXPIRED"
  | "ACL_DENY";

/* --------------------------------------------------
 * IP extraction
 * -------------------------------------------------- */

function extractClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    return xff.split(",")[0].trim();
  }

  const xri = req.headers.get("x-real-ip");
  if (xri) {
    return xri.trim();
  }

  return "ip:unknown";
}

/* --------------------------------------------------
 * Security Event Recorder
 * -------------------------------------------------- */

export function recordSecurityEvent(
  req: Request,
  requestId: string,
  event: SecurityEvent,
  stage: string,
  routeKey?: string,
  meta?: Record<string, unknown>
): void {
  try {
    const ip = extractClientIp(req);

    log({
  level: "SECURITY",
  request_id: requestId,
  route_key: routeKey,
  event,
  actor: ip,
  meta: {
    stage,
    ip,
    ...meta,
  },
});

  } catch {
    /* silent fail
       security logging must never break pipeline */
  }
}