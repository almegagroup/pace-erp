/*
 * File-ID: 2A
 * File-Path: supabase/functions/api/_security/csp.ts
 * Gate: 1
 * Phase: 1
 * Domain: SECURITY
 * Purpose: Enforce strict Content Security Policy
 * Authority: Backend
 */

export function applyCSP(res: Response): Response {
  const h = new Headers(res.headers);

  h.set(
    "Content-Security-Policy",
    [
      "default-src 'none'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' data:",
      "font-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "form-action 'self'",
    ].join("; ")
  );

  return new Response(res.body, {
    status: res.status,
    headers: h,
  });
}
