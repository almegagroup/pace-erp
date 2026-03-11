/*
 * File-ID: 4
 * File-Path: supabase/functions/api/_pipeline/csrf.ts
 * Gate: 1
 * Phase: 1
 * Domain: SECURITY
 * Purpose: Strict ENV-based CSRF enforcement
 * Authority: Backend
 */

import { recordSecurityEvent } from "../_security/security_events.ts";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/* --------------------------------------------------
 * ENV allowlist (same as CORS)
 * -------------------------------------------------- */

const allowedEnv =
  typeof Deno !== "undefined"
    ? Deno.env.get("ALLOWED_ORIGINS")
    : process.env.ALLOWED_ORIGINS;

if (!allowedEnv) {
  throw new Error("CSRF_ENV_NOT_CONFIGURED");
}

const ALLOWED_ORIGINS = allowedEnv
  .split(",")
  .map(o => o.trim())
  .filter(Boolean);

  // 🔒 ENV safety assertion
if (ALLOWED_ORIGINS.length === 0) {
  throw new Error("CSRF_ENV_NOT_CONFIGURED");
}

export function stepCsrf(
  req: Request,
  _requestId: string
): void {
  // Safe methods bypass
  if (SAFE_METHODS.has(req.method)) return;

  const origin = req.headers.get("Origin");
  const referer = req.headers.get("Referer");

  // Both missing → reject
  if (!origin && !referer) {
  recordSecurityEvent(req, _requestId, "CSRF_BLOCKED_NO_ORIGIN_REFERER", "CSRF");
  throw new Error("CSRF_BLOCKED_NO_ORIGIN_REFERER");
}

  // Strict Origin validation
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
  recordSecurityEvent(req, _requestId, "CSRF_INVALID_ORIGIN", "CSRF");
  throw new Error("CSRF_INVALID_ORIGIN");
}

  // Strict Referer validation
  if (referer) {
    try {
      const r = new URL(referer);
      if (!ALLOWED_ORIGINS.includes(r.origin)) {
        recordSecurityEvent(req, _requestId, "CSRF_INVALID_REFERER", "CSRF");
throw new Error("CSRF_INVALID_REFERER");
      }
    } catch {
      throw new Error("CSRF_MALFORMED_REFERER");
    }
  }
}