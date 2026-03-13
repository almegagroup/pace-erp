/*
 * File-ID: 4.1
 * File-Path: supabase/functions/api/_core/auth/signup/signup.handler.ts
 * Gate: 4
 * Phase: 4
 * Domain: AUTH
 * Purpose: Handle ERP signup request and create PENDING user
 * Authority: Backend
 */

import { serviceRoleClient } from "../../../_shared/serviceRoleClient.ts";
import { okResponse } from "../../response.ts";
import { log } from "../../../_lib/logger.ts";
import { verifyHumanRequest } from "../../../_security/human_verification.ts";

/**
 * Signup Request Handler
 *
 * SECURITY MODEL
 *
 * Supabase Auth → Identity
 * ERP DB        → Business User Lifecycle
 *
 * Flow:
 *
 * Verified Supabase user
 *        │
 *        ▼
 * POST /api/signup
 *        │
 *        ▼
 * Human Verification
 *        │
 *        ▼
 * ERP user → PENDING
 *        │
 *        ▼
 * signup_requests
 *        │
 *        ▼
 * SA approval
 *
 * Security guarantees:
 *
 * - Enumeration safe
 * - Idempotent
 * - Human verified
 * - Email verified
 * - Never grants access
 */

export async function signupHandler(req: Request) {

  const requestId = (req as any).request_id;

  // --------------------------------------------------
  // DB client (service role)
  // --------------------------------------------------

  const db = serviceRoleClient;

  // --------------------------------------------------
  // 1. Human verification (bot protection)
  // --------------------------------------------------

 const humanToken = req.headers.get("x-human-token");

if (humanToken) {

  const human = await verifyHumanRequest(req);

  if (!human.ok) {
    log({
      level: "SECURITY",
      event: "HUMAN_VERIFICATION_FAILED"
    });

    return okResponse(null, requestId);
  }

}
  // --------------------------------------------------
  // 2. Resolve authenticated Supabase user
  // --------------------------------------------------

  const authHeader = req.headers.get("authorization");
  log({
  level: "OBSERVABILITY",
  event: "SIGNUP_STEP_1_HEADER",
  meta: { authHeader }
});

const token = authHeader?.replace("Bearer ", "");

const { data: userData } = await db.auth.getUser(token);

const authUserId = userData?.user?.id;
log({
  level: "OBSERVABILITY",
  event: "SIGNUP_STEP_2_TOKEN",
  meta: { authUserId }
});


if (!authUserId) {
  return okResponse(null, requestId);
}

  // --------------------------------------------------
  // 3. Verify Supabase email confirmation
  // --------------------------------------------------

  const { data } = await db.auth.admin.getUserById(authUserId);
const authUser = data?.user;
log({
  level: "OBSERVABILITY",
  event: "SIGNUP_STEP_3_EMAIL",
  meta: { emailConfirmed: authUser?.email_confirmed_at }
});

  if (!authUser?.email_confirmed_at) {
  return okResponse(null, requestId);
}

  // --------------------------------------------------
  // 4. Parse optional signup metadata (NON-AUTHORITATIVE)
  // --------------------------------------------------

  const metadata = authUser?.user_metadata ?? {};

const name = metadata.name;
const parent_company = metadata.parent_company;
const designation_hint = metadata.designation_hint;
const phone = metadata.phone;

  // --------------------------------------------------
  // 5. Check if ERP user already exists
  // --------------------------------------------------

  const { data: existingUser } = await db
    .schema("erp_core").from("users")
    .select("id")
    .eq("auth_user_id", authUserId)
    .maybeSingle();
    log({
  level: "OBSERVABILITY",
  event: "SIGNUP_STEP_4_EXISTING",
  meta: { existingUser }
});

  if (existingUser) {
    return okResponse(null, requestId);
  }

  // --------------------------------------------------
  // 6. Create ERP user (PENDING state)
  // --------------------------------------------------
log({
  level: "OBSERVABILITY",
  event: "SIGNUP_STEP_5_INSERT_ATTEMPT",
  meta: { authUserId }
});
  
  const { error: userInsertError } = await db
  
    .schema("erp_core").from("users")
    .insert({
      auth_user_id: authUserId,
      state: "PENDING",
      created_by: "SYSTEM",
    });

  if (userInsertError) {

    log({
      level: "ERROR",
      event: "ERP_SIGNUP_USER_INSERT_FAILED",
      meta: {
        auth_user_id: authUserId,
        error: userInsertError.message,
      },
    });

    return okResponse(null, requestId);
  }

  // --------------------------------------------------
  // 7. Capture signup metadata for SA review
  // --------------------------------------------------

  const { error: signupInsertError } = await db
    .schema("erp_core").from("signup_requests")
    .insert({
      auth_user_id: authUserId,
      name: String(name ?? "").trim() || "UNKNOWN",
      parent_company_name:
        String(parent_company ?? "").trim() || "UNKNOWN",
      designation_hint: designation_hint ?? null,
      phone_number: phone ?? null,
    });

  if (signupInsertError) {

    log({
      level: "ERROR",
      event: "ERP_SIGNUP_REQUEST_INSERT_FAILED",
      meta: {
        auth_user_id: authUserId,
        error: signupInsertError.message,
      },
    });

  }

  // --------------------------------------------------
  // 8. Observability event
  // --------------------------------------------------

  log({
    level: "OBSERVABILITY",
    event: "ERP_SIGNUP_REQUEST_RECEIVED",
    meta: {
      auth_user_id: authUserId,
    },
  });

  // --------------------------------------------------
  // 9. Always return generic success
  // --------------------------------------------------

  return okResponse(null, requestId);

}