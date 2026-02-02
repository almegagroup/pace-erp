/*
 * File-ID: 4.2B
 * File-Path: supabase/functions/api/_core/admin/signup/reject.handler.ts
 * Gate: 4
 * Phase: 4
 * Domain: ADMIN
 * Purpose: Reject signup request (SA only)
 * Authority: Backend
 */

import {
  getServiceRoleClientWithContext,
} from "../../../_shared/serviceRoleClient.ts";

import type { ContextResolution } from "../../../_pipeline/context.ts";
import { okResponse } from "../../response.ts";
import { log } from "../../..//_lib/logger.ts";

/**
 * SA Reject Handler
 *
 * Responsibilities:
 * - Reject signup request (PENDING → REJECTED)
 * - Mark ERP user as REJECTED
 * - Write audit + observability logs
 * - Enumeration-safe response
 */

type HandlerContext = {
  context: ContextResolution;
  request_id: string;
  auth_user_id: string;
};

export async function rejectSignupHandler(
  _req: Request,
  ctx: HandlerContext
): Promise<Response> {
  // --------------------------------------------------
  // Context gate (NO resolution here)
  // --------------------------------------------------
  if (ctx.context.status !== "RESOLVED") {
    return okResponse(null, ctx.request_id);
  }

  // --------------------------------------------------
  // Context-aware DB client (G4 Step-4)
  // --------------------------------------------------
  const db = getServiceRoleClientWithContext(ctx.context);
  const requestId = ctx.request_id;
  const saAuthUserId = ctx.auth_user_id;

  const body = await _req.json().catch(() => ({}));
  const { auth_user_id } = body ?? {};

  // Enumeration-safe guard
  if (!auth_user_id) {
    return okResponse(null, requestId);
  }

  // --------------------------------------------------
  // 1. Mark signup request as REJECTED (idempotent)
  // --------------------------------------------------
  await db
    .from("erp_core.signup_requests")
    .update({
      decision: "REJECTED",
      reviewed_at: new Date().toISOString(),
      reviewed_by: saAuthUserId,
    })
    .eq("auth_user_id", auth_user_id)
    .eq("decision", "PENDING");

  // --------------------------------------------------
  // 2. Set ERP user lifecycle state to REJECTED
  // --------------------------------------------------
  await db
    .from("erp_core.users")
    .update({ state: "REJECTED" })
    .eq("auth_user_id", auth_user_id)
    .eq("state", "PENDING");

  // --------------------------------------------------
  // 3. Audit log (append-only)
  // --------------------------------------------------
  await db
    .from("erp_audit.signup_approvals")
    .insert({
      actor_auth_user_id: saAuthUserId,
      target_auth_user_id: auth_user_id,
      decision: "REJECTED",
      meta: {
        source: "SA_REJECT_API",
      },
    });

  // --------------------------------------------------
  // 4. Observability
  // --------------------------------------------------
  log({
    level: "OBSERVABILITY",
    gate: "4.2B",
    event: "SIGNUP_REJECTED",
    actor: saAuthUserId,
    meta: { target_auth_user_id: auth_user_id },
  });

  // --------------------------------------------------
  // 5. Generic success
  // --------------------------------------------------
  return okResponse(null, requestId);
}
