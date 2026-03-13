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
    ? Deno.env.get("TURNSTILE_SECRET_KEY")
    : process.env.TURNSTILE_SECRET_KEY);


type VerificationResult = {
  ok: boolean;
};

export async function verifyHumanRequest(
  req: Request
): Promise<VerificationResult> {

  try {
    if (!SECRET) {
  return { ok: false };
}

    const token = req.headers.get("x-human-token");

    if (!token) return { ok: false };

    const body = new URLSearchParams();

    body.append("secret", SECRET ?? "");
    body.append("response", token);

    const res = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        body
      }
    );

    const data = await res.json();

    if (!data.success) {
      return { ok: false };
    }

    return { ok: true };

  } catch {

    return { ok: false };

  }
}

