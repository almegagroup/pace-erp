/*
 * File-ID: 4.1C
 * File-Path: supabase/functions/api/_security/human_verification.ts
 * Gate: 4
 * Phase: 4
 * Domain: SECURITY
 * Purpose: Deterministic backend human verification
 * Authority: Backend
 */

const SECRET =
  (typeof Deno !== "undefined"
    ? Deno.env.get("HUMAN_VERIFICATION_SECRET")
    : process.env.HUMAN_VERIFICATION_SECRET) ?? "DEV_ONLY_SECRET";
const TTL_MS = 3 * 60 * 1000; // 3 minutes

type VerificationResult = {
  ok: boolean;
};

export async function verifyHumanRequest(
  req: Request
): Promise<VerificationResult> {
  try {
    const token = req.headers.get("x-human-token");
    if (!token) return { ok: false };

    const parts = token.split(".");
    if (parts.length !== 3) return { ok: false };

    const [payloadB64, signatureHex, issuedAtStr] = parts;
    const issuedAt = Number(issuedAtStr);

    if (!issuedAt || Date.now() - issuedAt > TTL_MS) {
      return { ok: false };
    }

    const fingerprint = buildFingerprint(req);
    const data = `${payloadB64}.${issuedAt}.${fingerprint}`;

    const expectedSig = await hmacSha256Hex(SECRET, data);

    if (!timingSafeEqual(signatureHex, expectedSig)) {
      return { ok: false };
    }

    return { ok: true };
  } catch {
    return { ok: false }; // silent fail
  }
}

function buildFingerprint(req: Request): string {
  const ua = req.headers.get("user-agent") ?? "";
  const accept = req.headers.get("accept") ?? "";
  return `${ua}|${accept}`;
}

async function hmacSha256Hex(secret: string, data: string): Promise<string> {
  const enc = new TextEncoder();

  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    enc.encode(data)
  );

  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return out === 0;
}
