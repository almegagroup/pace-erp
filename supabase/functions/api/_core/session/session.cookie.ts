/*
 * File-ID: 2.2B-SESSION-COOKIE-OVERWRITE
 * File-Path: supabase/functions/api/_core/session/session.cookie.ts
 * Gate: 2
 * Phase: 2
 * Domain: SESSION
 * Purpose: Hardened HttpOnly session cookie with strict attributes
 * Authority: Backend
 */

export function buildSessionCookie(
  sessionId: string,
  requestUrl: string
): string {
  const url = new URL(requestUrl);
  const isHttps = url.protocol === "https:";

  /**
   * Deterministic cookie attributes.
   * No browser defaults relied upon.   
   */
  const parts = [
    `erp_session=${sessionId}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
  ];

  if (isHttps) {
    parts.push("Secure");
  }

  /**
   * Explicit domain binding
   */
  if (url.hostname) {
    parts.push(`Domain=${url.hostname}`);
  }

  return parts.join("; ");
}
