/*
 * File-ID: 2.1A-AUTH-LOGIN-HANDLER
 * File-Path: supabase/functions/api/_core/auth/login.handler.ts
 * gate_id: 2
 * Phase: 2
 * Domain: AUTH
 * Purpose: Verify user identity via Supabase Auth (hardened validation)
 * Authority: Backend
 */

import { verifyPassword } from "./authDelegate.ts";
import { errorResponse } from "../response.ts";
import { getAccountState } from "./accountState.ts";
import { createSession } from "../session/session.create.ts";
import { buildSessionCookie } from "../session/session.cookie.ts";
import { resolveIdentifier } from "./identifierResolver.ts";
import { log } from "../../_lib/logger.ts";
import { authClient } from "./authClient.ts";
import { recordSessionTimeline } from "../session/session_timeline.ts";

/**
 * STEP 8.1 — Device tagging (soft)
 * Signal only. No allow/deny.
 */
function extractDeviceInfo(_ctx: LoginContext) {
  const ua =
    typeof globalThis.navigator === "undefined"
      ? "unknown"
      : globalThis.navigator.userAgent ?? "unknown";

  return {
    device_id: ua,
    device_summary: ua.slice(0, 255),
  };
}


interface LoginContext {
  body: {
    identifier?: string;
    password?: string;
  };
  requestId: string;
  requestUrl: string;
}

const GENERIC_CODE = "AUTH_INVALID_CREDENTIALS";
const GENERIC_MESSAGE = "Invalid credentials";

export async function loginHandler(ctx: LoginContext): Promise<Response> {
  const { body, requestId, requestUrl } = ctx;

  /**
   * STEP 0: Normalize raw input
   */
  const identifier =
    typeof body?.identifier === "string"
      ? body.identifier.trim()
      : "";

  const password =
    typeof body?.password === "string"
      ? body.password
      : "";

  /**
   * STEP 1: Empty / whitespace rejection
   */
 if (!identifier || !password) {
  log({
    level: "SECURITY",
    request_id: requestId,
    gate_id: "2.7",
    event: "AUTH_LOGIN_FAILED",
  });

  return errorResponse(
    GENERIC_CODE,
    GENERIC_MESSAGE,
    requestId,
    "NONE",
    403
  );
}


  /**
   * STEP 2: Identifier resolution (ID-2.1D)
   */
  const resolved = await resolveIdentifier(identifier);

 if (!resolved) {
  log({
    level: "SECURITY",
    request_id: requestId,
    gate_id: "2.7",
    event: "AUTH_LOGIN_FAILED",
  });

  return errorResponse(
    GENERIC_CODE,
    GENERIC_MESSAGE,
    requestId,
    "NONE",
    403
  );
}


  /**
   * STEP 3–5: Credential verification via Supabase Auth
   */
  let authUserId: string;

  if (resolved.kind === "email") {
    const result = await verifyPassword(resolved.email, password);

   if (!result.ok || !result.session) {
  log({
    level: "SECURITY",
    request_id: requestId,
    gate_id: "2.7",
    event: "AUTH_LOGIN_FAILED",
  });

  return errorResponse(
    GENERIC_CODE,
    GENERIC_MESSAGE,
    requestId,
    "NONE",
    403
  );
}


    authUserId = result.user.id;
 } else {
  // ERP code path (identity already resolved)

  // Step 1: Fetch email from Supabase using auth_user_id
  const { data: userData, error: userError } =
    await authClient.auth.admin.getUserById(resolved.authUserId);

  if (userError || !userData?.user?.email) {
    log({
      level: "SECURITY",
      request_id: requestId,
      gate_id: "2.7",
      event: "AUTH_LOGIN_FAILED",
    });

    return errorResponse(
      GENERIC_CODE,
      GENERIC_MESSAGE,
      requestId,
      "NONE",
      403
    );
  }

  // Step 2: Verify password against correct email
  const result = await verifyPassword(
  userData.user.email,
  password
);

if (!result.ok || !result.session) {
  log({
    level: "SECURITY",
    request_id: requestId,
    gate_id: "2.7",
    event: "AUTH_LOGIN_FAILED",
  });

  return errorResponse(
    GENERIC_CODE,
    GENERIC_MESSAGE,
    requestId,
    "NONE",
    403
  );
}

  authUserId = resolved.authUserId;
}

  /**
   * STEP 6: ERP account state check
   */
  const state = await getAccountState(authUserId);

  if (state !== "ACTIVE") {
  log({
    level: "SECURITY",
    request_id: requestId,
    gate_id: "2.7",
    event: "AUTH_LOGIN_FAILED",
  });

  return errorResponse(
    GENERIC_CODE,
    GENERIC_MESSAGE,
    requestId,
    "NONE",
    403
  );
}


  /**
 * STEP 7: Create ERP session (with device tagging — soft)
 */
const device = extractDeviceInfo(ctx);
const sessionId = await createSession(authUserId, device);

/**
 * Gate-10.3 — Session lifecycle trace
 */
recordSessionTimeline({
  requestId: requestId,
  sessionId: sessionId,
  userId: authUserId,
  event: "LOGIN",
});

 /**
 * STEP 9.2 — Cookie regeneration rule (3.6A)
 * A fresh cookie MUST be issued on every successful authentication.
 * Reuse of any existing cookie is forbidden.
 */
const cookie = buildSessionCookie(sessionId, requestUrl);

log({
  level: "SECURITY",
  request_id: requestId,
  gate_id: "2.7",
  event: "AUTH_LOGIN_SUCCESS",
});

const res = new Response(
  JSON.stringify({
    ok: true,
    request_id: requestId ?? null,
  }),
  {
    status: 200,
    headers: {
      "Set-Cookie": cookie,
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    },
  }
);

return res;

}
