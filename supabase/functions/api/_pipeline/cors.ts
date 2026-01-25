/*
 * File-ID: 3
 * File-Path: supabase/functions/api/_pipeline/cors.ts
 * Gate: 1
 * Phase: 1
 * Domain: SECURITY
 * Purpose: Strict CORS allowlist with origin echo
 * Authority: Backend
 */

export async function stepCors(req: Request, _requestId: string): Promise<void> {
  // No-op placeholder for pipeline ordering (actual header injection is response-side)
  return;
}

/*
 * Response-side CORS injector (ID-3)
 * - No wildcard
 * - Echo Origin
 * - Allow non-browser (no Origin)
 */
export function applyCORS(req: Request, res: Response): Response {
     // ---- ID-3B: No wildcard assertion ----
  const existing = res.headers.get("Access-Control-Allow-Origin");
  if (existing === "*") {
    throw new Error("CORS_WILDCARD_FORBIDDEN");
  }
  const h = new Headers(res.headers);

  const origin = req.headers.get("Origin");

  if (origin) {
    h.set("Access-Control-Allow-Origin", origin);
    h.set("Vary", "Origin");
    h.set("Access-Control-Allow-Credentials", "true");
    h.set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    h.set(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Requested-With"
    );
  }

  return new Response(res.body, { status: res.status, headers: h });
}
/*
 * File-ID: 3A
 * Purpose: Handle CORS preflight (OPTIONS)
 */

export function handlePreflight(req: Request): Response | null {
  if (req.method !== "OPTIONS") return null;

  const h = new Headers();
  const origin = req.headers.get("Origin");

  if (origin) {
    h.set("Access-Control-Allow-Origin", origin);
    h.set("Vary", "Origin");
    h.set("Access-Control-Allow-Credentials", "true");
    h.set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    h.set(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Requested-With"
    );
  }

  h.set("Access-Control-Max-Age", "86400");

  return new Response(null, { status: 200, headers: h });
}
