/*
 * File-ID: 4.2A (RESEALED)
 * File-Path: supabase/functions/api/_core/admin/signup/approve.handler.ts
 * gate_id: 4
 * Phase: 4
 * Domain: ADMIN
 * Purpose: Approve signup request using SINGLE atomic DB authority
 * Authority: Backend (service_role only)
 *
 * IMPORTANT:
 * - This handler MUST NOT mutate any table directly.
 * - All approval logic is delegated to erp_meta.approve_signup_atomic().
 * - Single source of truth = DB atomic function.
 */

import {
  getServiceRoleClientWithContext,
} from "../../../_shared/serviceRoleClient.ts";

import type { ContextResolution } from "../../../_pipeline/context.ts";

import { okResponse } from "../../response.ts";
import { log } from "../../../_lib/logger.ts";

type HandlerContext = {
  context: ContextResolution;
  request_id: string;
  auth_user_id: string; // SA actor
};

export async function approveSignupHandler(
  req: Request,
  ctx: HandlerContext
): Promise<Response> {

  // --------------------------------------------------
  // 1️⃣ Context Gate (deterministic)
  // --------------------------------------------------
  if (ctx.context.status !== "RESOLVED") {
    return okResponse(null, ctx.request_id);
  }

  const db = getServiceRoleClientWithContext(ctx.context);

  const requestId = ctx.request_id;
  const saAuthUserId = ctx.auth_user_id;

  const body = await req.json().catch(() => ({}));
  const { auth_user_id } = body ?? {};

  // --------------------------------------------------
  // 2️⃣ Enumeration-safe guard
  // --------------------------------------------------
  if (!auth_user_id) {
    return okResponse(null, requestId);
  }

  // --------------------------------------------------
  // 3️⃣ SINGLE ATOMIC AUTHORITY CALL
  // --------------------------------------------------
  const { data: userCode, error } = await db.rpc(
    "erp_meta.approve_signup_atomic",
    {
      p_target_auth_user_id: auth_user_id,
      p_actor_auth_user_id: saAuthUserId,
    }
  );

  // Preserve enumeration safety
  if (error) {
    return okResponse(null, requestId);
  }

  // --------------------------------------------------
  // 4️⃣ Observability (non-authoritative)
  // --------------------------------------------------
  log({
    level: "OBSERVABILITY",
    gate_id: "4.2A",
    event: "ERP_USER_ACTIVATED",
    actor: saAuthUserId,
    meta: {
      target_auth_user_id: auth_user_id,
      user_code: userCode,
    },
  });

  // --------------------------------------------------
  // 5️⃣ Generic success
  // --------------------------------------------------
  return okResponse(null, requestId);
}