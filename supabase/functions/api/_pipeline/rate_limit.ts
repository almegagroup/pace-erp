/*
 * File-ID: 2.5-SECURITY-RATE-LIMIT
 * File-Path: supabase/functions/api/_pipeline/rate_limit.ts
 * Gate: 2
 * Phase: 2
 * Domain: SECURITY
 * Purpose: Auth rate limiting (IP + identifier)
 * Authority: Backend
 *
 * Covers:
 * - ID-2.5  (Auth rate limiting)
 * - ID-2.5A (IP throttling)
 * - ID-2.5B (Account throttling)
 */

/* ---------------------------
 * CONFIG
 * --------------------------- */
import { recordSecurityEvent } from "../_security/security_events.ts";
import type { SecurityEvent } from "../_security/security_events.ts";

const WINDOW_MS = 60_000; // 1 minute

const IP_MAX_REQ = 60;
const IDENTIFIER_MAX_REQ = 10;

/* ---------------------------
 * BUCKETS (in-memory, best-effort)
 * --------------------------- */

type Bucket = { count: number; resetAt: number };

const ipBucket = new Map<string, Bucket>();
const identifierBucket = new Map<string, Bucket>();

/* ---------------------------
 * HELPERS
 * --------------------------- */

function getClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();

  const xri = req.headers.get("x-real-ip");
  if (xri) return xri.trim();

  return "ip:unknown";
}

async function extractIdentifier(req: Request): Promise<string | null> {
  try {
    const clone = req.clone();
    const body = await clone.json();

    if (typeof body?.identifier === "string") {
      const v = body.identifier.trim().toLowerCase();
      return v || null;
    }
  } catch {
    // ignore non-JSON
  }
  return null;
}

function hitBucket(
  req: Request,
  requestId: string,
  bucket: Map<string, Bucket>,
  key: string,
  max: number,
  errorCode: SecurityEvent
){
  const now = Date.now();
  const cur = bucket.get(key);

  if (!cur || now >= cur.resetAt) {
    bucket.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }

  cur.count += 1;

  if (cur.count > max) {
  recordSecurityEvent(
  req,
  requestId,
  errorCode,
  "RATE_LIMIT",
  undefined,
  { key }
);

  throw new Error(errorCode);
}

  bucket.set(key, cur);
}

/* ---------------------------
 * PIPELINE STEP
 * --------------------------- */

export async function stepRateLimit(
  req: Request,
  _requestId: string
): Promise<void> {
  const url = new URL(req.url);

  const isLogin = url.pathname.startsWith("/api/login");
  //const isSignup = url.pathname.startsWith("/api/signup");

  if (!isLogin /*&& !isSignup*/) {
    return;
  }

  /* ---- IP throttle ---- */
  const ip = getClientIp(req);
hitBucket(req, _requestId, ipBucket, ip, IP_MAX_REQ, "AUTH_RATE_LIMIT_IP");

  /* ---- Identifier throttle ---- */
  const identifier = await extractIdentifier(req);

  if (!identifier) {
    // For signup cases without identifier field
    hitBucket(
  req,
  _requestId,
  identifierBucket,
  "unknown",
  IDENTIFIER_MAX_REQ,
  "AUTH_RATE_LIMIT_ACCOUNT"
);
    return;
  }

  hitBucket(
  req,
  _requestId,
  identifierBucket,
  identifier,
  IDENTIFIER_MAX_REQ,
  "AUTH_RATE_LIMIT_ACCOUNT"
);
}