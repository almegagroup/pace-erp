/*
 * File-ID: 3
 * File-Path: supabase/functions/api/_pipeline/cors.ts
 * Gate: 1
 * Phase: 1
 * Domain: SECURITY
 * Purpose: Strict ENV-based CORS allowlist enforcement
 * Authority: Backend
 */

/* --------------------------------------------------
 * ENV-BASED ALLOWLIST
 * -------------------------------------------------- */

import { recordSecurityEvent } from "../_security/security_events.ts";

const allowedEnv =
  (typeof Deno !== "undefined"
    ? Deno.env.get("ALLOWED_ORIGINS")
    : process.env.ALLOWED_ORIGINS) || "";

const ALLOWED_ORIGINS = allowedEnv
  .split(",")
  .map(o => o.trim())
  .filter(Boolean);

/* --------------------------------------------------
 * Pipeline placeholder (ordering only)
 * -------------------------------------------------- */

export function stepCors(
  _req: Request,
  _requestId: string
): void {
  return;
}

/* --------------------------------------------------
 * Response-side CORS injector
 * - No wildcard allowed
 * - Strict ENV allowlist
 * - Allows non-browser requests (no Origin)
 * -------------------------------------------------- */

export function applyCORS(req: Request, res: Response): Response {
  // ---- Block wildcard ----
  const existing = res.headers.get("Access-Control-Allow-Origin");
  if (existing === "*") {
    throw new Error("CORS_WILDCARD_FORBIDDEN");
  }

  const origin = req.headers.get("Origin");
  const headers = new Headers(res.headers);

  // Non-browser request (no Origin header)
  if (!origin) {
    return new Response(res.body, {
      status: res.status,
      headers,
    });
  }

  // Strict allowlist check
  if (!ALLOWED_ORIGINS.includes(origin)) {
  recordSecurityEvent(req, "SYSTEM", "CORS_BLOCKED_ORIGIN", "CORS");

  return new Response("Forbidden", { status: 403 });
}

  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Vary", "Origin");
  headers.set("Access-Control-Allow-Credentials", "true");
  headers.set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With"
  );

  return new Response(res.body, {
    status: res.status,
    headers,
  });
}

/* --------------------------------------------------
 * Preflight (OPTIONS) handler
 * -------------------------------------------------- */

export function handlePreflight(req: Request): Response | null {
  if (req.method !== "OPTIONS") return null;

  const origin = req.headers.get("Origin");

  // Non-browser → reject preflight
  if (!origin) {
    return new Response("Forbidden", { status: 403 });
  }

  if (!ALLOWED_ORIGINS.includes(origin)) {
    return new Response("Forbidden", { status: 403 });
  }

  const headers = new Headers();

  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Vary", "Origin");
  headers.set("Access-Control-Allow-Credentials", "true");
  headers.set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With"
  );
  headers.set("Access-Control-Max-Age", "86400");

  return new Response(null, {
    status: 200,
    headers,
  });
}