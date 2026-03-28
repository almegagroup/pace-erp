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
 * ENV-BASED ALLOWLIST (DENO ONLY)
 * -------------------------------------------------- */

import { recordSecurityEvent } from "../_security/security_events.ts";

const ALLOWED_CORS_HEADERS =
  "Content-Type, Authorization, X-Requested-With, x-erp-window-token";


const allowedEnv =
  (typeof Deno !== "undefined"
    ? Deno.env.get("ALLOWED_ORIGINS")
    : process.env.ALLOWED_ORIGINS) || "";

// Normalize ENV → array
const ALLOWED_ORIGINS = allowedEnv
  .split(/[\n,]/)
  .map(o => o.trim().toLowerCase().replace(/\/$/, "")) // trim + lowercase + remove trailing slash
  .filter(Boolean);

/* --------------------------------------------------
 * ORIGIN MATCH HELPER (STRICT BUT SAFE)
 * -------------------------------------------------- */

function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return true; // non-browser allowed

  const normalizedOrigin = origin
    .trim()
    .toLowerCase()
    .replace(/\/$/, "");

  return ALLOWED_ORIGINS.some(allowed => {
    return allowed === normalizedOrigin;
  });
}

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
 * -------------------------------------------------- */

export function applyCORS(req: Request, res: Response): Response {
  // ---- Block wildcard ----
  const existing = res.headers.get("Access-Control-Allow-Origin");
  if (existing === "*") {
    throw new Error("CORS_WILDCARD_FORBIDDEN");
  }

  const origin = req.headers.get("Origin");
  console.log("---- CORS DEBUG (applyCORS) ----");
console.log("Incoming Origin:", origin);
console.log("Allowed Origins:", ALLOWED_ORIGINS);
  const headers = new Headers(res.headers);

  // Non-browser request (no Origin header)
  if (!origin) {
    return new Response(res.body, {
      status: res.status,
      headers,
    });
  }

  // 🔴 Strict allowlist check (FIXED)
  console.log("Is Origin Allowed?:", isOriginAllowed(origin));
  if (!isOriginAllowed(origin)) {
    console.log("❌ CORS BLOCKED:", origin);
    recordSecurityEvent(req, "SYSTEM", "CORS_BLOCKED_ORIGIN", "CORS");

    const blockHeaders = new Headers();
    blockHeaders.set("Access-Control-Allow-Origin", origin);
    blockHeaders.set("Vary", "Origin");
    blockHeaders.set("Access-Control-Allow-Credentials", "true");

    return new Response("Forbidden", {
      status: 403,
      headers: blockHeaders
    });
  }

  // ✅ Allowed
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Vary", "Origin");
  headers.set("Access-Control-Allow-Credentials", "true");
  headers.set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  headers.set("Access-Control-Allow-Headers", ALLOWED_CORS_HEADERS);

  console.log("✅ CORS PASSED:", origin);
console.log("------------------------------");

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
  console.log("---- PREFLIGHT DEBUG ----");
console.log("Incoming Origin:", origin);

  // Non-browser → reject preflight
  if (!origin) {
    return new Response("Forbidden", {
      status: 403,
      headers: {
        "Access-Control-Allow-Origin": "*"
      }
    });
  }

  // 🔴 Strict allowlist check (FIXED)
  console.log("Is Origin Allowed?:", isOriginAllowed(origin));
  if (!isOriginAllowed(origin)) {
    console.log("❌ CORS BLOCKED:", origin);
    recordSecurityEvent(req, "SYSTEM", "CORS_BLOCKED_ORIGIN", "CORS");

    const blockHeaders = new Headers();
    blockHeaders.set("Access-Control-Allow-Origin", origin);
    blockHeaders.set("Vary", "Origin");
    blockHeaders.set("Access-Control-Allow-Credentials", "true");

    return new Response("Forbidden", {
      status: 403,
      headers: blockHeaders
    });
  }

  // ✅ Allowed preflight
  const headers = new Headers();

  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Vary", "Origin");
  headers.set("Access-Control-Allow-Credentials", "true");
  headers.set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  headers.set("Access-Control-Allow-Headers", ALLOWED_CORS_HEADERS);
  headers.set("Access-Control-Max-Age", "86400");

  console.log("✅ PREFLIGHT PASSED:", origin);
console.log("------------------------------");

  return new Response(null, {
    status: 200,
    headers,
  });
}
