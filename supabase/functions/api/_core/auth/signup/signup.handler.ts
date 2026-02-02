/*
 * File-ID: 4.1
 * File-Path: supabase/functions/api/_core/auth/signup/signup.handler.ts
 * Gate: 4
 * Phase: 4
 * Domain: AUTH
 * Purpose: Handle ERP signup request and create PENDING user
 * Authority: Backend
 */

import {
  serviceRoleClient,
  getServiceRoleClientWithContext,
} from "../../../_shared/serviceRoleClient.ts";
import { stepContext } from "../../../_pipeline/context.ts";
import { okResponse } from "../../response.ts";
import { log } from "../../../_lib/logger.ts";
import { verifyHumanRequest } from "../../../_security/human_verification.ts";

/**
 * Signup Request Handler
 *
 * This handler:
 * - Assumes Supabase Auth identity already exists
 * - Creates ERP user in PENDING state (existence only)
 * - Is enumeration-safe
 * - Never grants access
 */
export async function signupHandler(req: Request) {
    const ctx = await stepContext(req, (req as any).request_id);
  const db =
    ctx.status === "RESOLVED"
      ? getServiceRoleClientWithContext(ctx)
      : serviceRoleClient;

  const human = await verifyHumanRequest(req);
  if (!human.ok) {
    // Silent failure: pretend success, do nothing
    return okResponse(null, (req as any).request_id);
  }

  const authUserId = (req as any).auth_user_id;

  if (!authUserId) {
    // Generic success to avoid enumeration
    return okResponse(null, (req as any).request_id);
  }

  // --------------------------------------------------
  // 1A. Parse optional signup metadata (NON-AUTHORITATIVE)
  // --------------------------------------------------
  const body = await req.json().catch(() => ({}));
  const {
    name,
    parent_company,
    designation_hint,
    phone,
  } = body ?? {};

  // --------------------------------------------------
  // 2. Check if ERP user already exists
  // --------------------------------------------------
    const { data: existingUser } = await db
    .from("erp_core.users")
    .select("id")
    .eq("auth_user_id", authUserId)
    .maybeSingle();

  if (existingUser) {
    // Idempotent, enumeration-safe
    return okResponse(null, (req as any).request_id);
  }

  // --------------------------------------------------
  // 3. Create ERP user in PENDING state
  // --------------------------------------------------
   await db.from("erp_core.users").insert({
    auth_user_id: authUserId,
    state: "PENDING",
    created_by: "SYSTEM",
  });

  // --------------------------------------------------
  // 3A. Capture signup metadata for SA review
  // --------------------------------------------------
   await db.from("erp_core.signup_requests").insert({
    auth_user_id: authUserId,
    name: String(name ?? "").trim() || "UNKNOWN",
    parent_company_name: String(parent_company ?? "").trim() || "UNKNOWN",
    designation_hint: designation_hint ?? null,
    phone_number: phone ?? null,
  });

  // --------------------------------------------------
  // 4. Observability (non-blocking)
  // --------------------------------------------------
   log({
    level: "OBSERVABILITY",
    event: "ERP_SIGNUP_REQUEST_RECEIVED",
    meta: { auth_user_id: authUserId },
  });

  // --------------------------------------------------
  // 5. Always return generic success
  // --------------------------------------------------
   return okResponse(null, (req as any).request_id);
}
