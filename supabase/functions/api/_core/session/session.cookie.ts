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
  const hostname = url.hostname;

  const isLocalhost =
    hostname.includes("localhost") ||
    hostname.includes("127.0.0.1");

  const parts = [
    `erp_session=${sessionId}`,
    "Path=/",
    "HttpOnly",
  ];

  /**
   * PRODUCTION (cross-domain case)
   */
  if (!isLocalhost) {
    parts.push("SameSite=None");

    if (isHttps) {
      parts.push("Secure");
    }

    // Optional but recommended for your domain
    parts.push("Domain=.almegagroup.in");
  }

  /**
   * DEV (localhost)
   */
  else {
    parts.push("SameSite=Lax");
  }

  return parts.join("; ");
}
