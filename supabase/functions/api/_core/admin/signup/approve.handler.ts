/*
 * File-ID: 4.2A
 * File-Path: supabase/functions/api/_core/admin/signup/approve.handler.ts
 * Gate: 4
 * Phase: 4
 * Domain: ADMIN
 * Purpose: Approve signup request and atomically activate ERP user (SA only)
 * Authority: Backend
 */

import {
  getServiceRoleClientWithContext,
} from "../../../_shared/serviceRoleClient.ts";

import type { ContextResolution } from "../../../_pipeline/context.ts";

import { okResponse } from "../../response.ts";
import { log } from "../../../_lib/logger.ts";

/**
 * SA Approval Handler
 *
 * Responsibilities:
 * - Approve signup request (PENDING → APPROVED)
 * - Generate deterministic P0001-style user_code
 * - Activate ERP user (PENDING → ACTIVE)
 * - Assign minimal ACL (L1_USER)
 * - Enumeration-safe response
 *
 * Does NOT:
 * - Touch password
 * - Create session
 * - Assign business context
 */

type HandlerContext = {
  context: ContextResolution;
  request_id: string;
  auth_user_id: string;
};

export async function approveSignupHandler(
  req: Request,
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

  const body = await req.json().catch(() => ({}));
  const { auth_user_id } = body ?? {};

  // Enumeration-safe guard
  if (!auth_user_id) {
    return okResponse(null, requestId);
  }

  // --------------------------------------------------
  // 1. Mark signup request as APPROVED (idempotent)
  // --------------------------------------------------
  await db
    .from("erp_core.signup_requests")
    .update({
      decision: "APPROVED",
      reviewed_at: new Date().toISOString(),
      reviewed_by: saAuthUserId,
    })
    .eq("auth_user_id", auth_user_id)
    .eq("decision", "PENDING");

  // --------------------------------------------------
  // 2. Generate next P0001-style user_code
  // --------------------------------------------------
  const { data: seq, error: seqErr } = await db
    .rpc("erp_meta.next_user_code_p_seq");

  if (seqErr || typeof seq !== "number") {
    // Silent failure to preserve enumeration safety
    return okResponse(null, requestId);
  }

  const userCode = `P${String(seq).padStart(4, "0")}`;

  // --------------------------------------------------
  // 3. Activate ERP user atomically
  // --------------------------------------------------
  await db
    .from("erp_core.users")
    .update({
      state: "ACTIVE",
      user_code: userCode,
    })
    .eq("auth_user_id", auth_user_id)
    .eq("state", "PENDING");

  // --------------------------------------------------
  // 4. Minimal ACL bootstrap (L1_USER only)
  // --------------------------------------------------
  await db
    .from("erp_acl.user_roles")
    .insert({
      auth_user_id,
      role_code: "L1_USER",
      role_rank: 10,
      assigned_by: saAuthUserId,
    });

  // --------------------------------------------------
  // 5A. Approval audit log (append-only)
  // --------------------------------------------------
  await db
    .from("erp_audit.signup_approvals")
    .insert({
      actor_auth_user_id: saAuthUserId,
      target_auth_user_id: auth_user_id,
      decision: "APPROVED",
      meta: {
        user_code: userCode,
        source: "SA_APPROVAL_API",
      },
    });

  // --------------------------------------------------
  // 5B. Observability log
  // --------------------------------------------------
  log({
    level: "OBSERVABILITY",
    gate: "4.2A",
    event: "ERP_USER_ACTIVATED",
    actor: saAuthUserId,
    meta: {
      target_auth_user_id: auth_user_id,
      user_code: userCode,
    },
  });

  return okResponse(null, requestId);
}
