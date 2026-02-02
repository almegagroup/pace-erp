/*
 * File-ID: 4.2
 * File-Path: supabase/functions/api/_core/admin/signup/list_pending.handler.ts
 * Gate: 4
 * Phase: 4
 * Domain: ADMIN
 * Purpose: List pending signup requests for SA review
 * Authority: Backend
 */

import {
  getServiceRoleClientWithContext,
} from "../../../_shared/serviceRoleClient.ts";

import type { ContextResolution } from "../../../_pipeline/context.ts";
import { okResponse } from "../../response.ts";

/**
 * List Pending Signup Requests
 *
 * This handler:
 * - Is SA-only (enforced earlier in pipeline / ACL)
 * - Reads pending signup requests
 * - Does not mutate data
 * - Is enumeration-safe
 */

type HandlerContext = {
  context: ContextResolution;
  request_id: string;
};

export async function listPendingSignupHandler(
  _req: Request,
  ctx: HandlerContext
): Promise<Response> {
  // --------------------------------------------------
  // Context gate (NO resolution here)
  // --------------------------------------------------
  if (ctx.context.status !== "RESOLVED") {
    return okResponse([], ctx.request_id);
  }

  // --------------------------------------------------
  // Context-aware DB client (G4 Step-4)
  // --------------------------------------------------
  const db = getServiceRoleClientWithContext(ctx.context);
  const requestId = ctx.request_id;

  // --------------------------------------------------
  // Fetch pending signup requests
  // --------------------------------------------------
  const { data } = await db
    .from("erp_core.signup_requests")
    .select(
      "auth_user_id, name, parent_company_name, designation_hint, phone_number, submitted_at"
    )
    .eq("decision", "PENDING")
    .order("submitted_at", { ascending: true });

  // --------------------------------------------------
  // Deterministic response
  // --------------------------------------------------
  return okResponse(data ?? [], requestId);
}
