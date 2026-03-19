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
  const hostname = url.hostname;

  const isLocalhost =
    hostname.includes("localhost") ||
    hostname.includes("127.0.0.1");

  const parts = [
    `erp_session=${sessionId}`,
    "Path=/",
    "HttpOnly",
  ];

  if (!isLocalhost) {
    // 🔥 PRODUCTION RULE
    parts.push("SameSite=None");
    parts.push("Secure"); // ALWAYS
    parts.push("Domain=.almegagroup.in");
  } else {
    // 🧪 DEV RULE
    parts.push("SameSite=Lax");
  }

  return parts.join("; ");
}