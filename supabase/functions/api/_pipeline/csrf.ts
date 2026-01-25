/*
 * File-ID: 4
 * File-Path: supabase/functions/api/_pipeline/csrf.ts
 * Gate: 1
 * Phase: 1
 * Domain: SECURITY
 * Purpose: CSRF guard via Origin + Referer validation
 * Authority: Backend
 */

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export async function stepCsrf(req: Request, _requestId: string): Promise<void> {
  // GET / HEAD / OPTIONS → allow
  if (SAFE_METHODS.has(req.method)) return;

  const origin = req.headers.get("Origin");
  const referer = req.headers.get("Referer");

  // POST / PUT / DELETE কিন্তু Origin + Referer দুটোই নেই
  if (!origin && !referer) {
    throw new Error("CSRF_BLOCKED_NO_ORIGIN_REFERER");
  }

  // দুটো থাকলে domain match করতে হবে
  if (origin && referer) {
    const o = new URL(origin);
    const r = new URL(referer);

    if (o.origin !== r.origin) {
      throw new Error("CSRF_ORIGIN_REFERER_MISMATCH");
    }
  }
}
