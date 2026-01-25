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
  bucket: Map<string, Bucket>,
  key: string,
  max: number,
  errorCode: string
) {
  const now = Date.now();
  const cur = bucket.get(key);

  if (!cur || now >= cur.resetAt) {
    bucket.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }

  cur.count += 1;

  if (cur.count > max) {
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

  /**
   * Gate-2 rule:
   * Rate limit applies ONLY to auth endpoints
   */
  if (!url.pathname.startsWith("/api/login")) {
    return;
  }

  /* ---- ID-2.5A: IP throttle ---- */
  const ip = getClientIp(req);
  hitBucket(ipBucket, ip, IP_MAX_REQ, "AUTH_RATE_LIMIT_IP");

  /* ---- ID-2.5B: Identifier throttle ---- */
  const identifier = await extractIdentifier(req);
  if (!identifier) return;

  hitBucket(
    identifierBucket,
    identifier,
    IDENTIFIER_MAX_REQ,
    "AUTH_RATE_LIMIT_ACCOUNT"
  );
}
