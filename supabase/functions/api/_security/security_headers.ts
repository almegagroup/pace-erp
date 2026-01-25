/*
 * File-ID: 10
 * File-Path: supabase/functions/api/_security/security_headers.ts
 * Gate: 1
 * Phase: 1
 * Domain: SECURITY
 * Purpose: Inject global security headers + request traceability
 * Authority: Backend
 */

export function applySecurityHeaders(
  res: Response,
  requestId?: string
): Response {
  const h = new Headers(res.headers);

  // ---- ID-10: Request traceability ----
  if (requestId) {
    h.set("X-Request-Id", requestId);
  }

  // ---- ID-2: Base Security Headers ----
  h.set("X-Content-Type-Options", "nosniff");
  h.set("X-XSS-Protection", "0"); // rely on CSP (ID-2A)

  // ---- ID-2B: X-Frame-Options (Clickjacking Prevention) ----
  h.set("X-Frame-Options", "DENY");

  // ---- ID-2C: Referrer-Policy (Referrer Leak Prevention) ----
  h.set("Referrer-Policy", "strict-origin-when-cross-origin");

  // ---- ID-2: Permissions Policy (Capability Lockdown) ----
  h.set("Permissions-Policy", "geolocation=(), microphone=(), camera=()");

  return new Response(res.body, {
    status: res.status,
    headers: h,
  });
}
