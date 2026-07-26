/*
 * File-Path: supabase/functions/api/_core/admin/signup/correct.handler.ts
 * Domain: ADMIN
 * Purpose: SA correction of pending signup request fields before approve/reject
 * Authority: Backend
 *
 * Rules:
 * - Only PENDING requests can be corrected (decision guard enforced in DB query)
 * - email/auth_user_id cannot be changed (Supabase Auth — not in this table)
 * - Editable: name, parent_company_name, designation_hint, phone_number
 */

import { getServiceRoleClientWithContext } from "../../../_shared/serviceRoleClient.ts";
import type { ContextResolution } from "../../../_pipeline/context.ts";
import { okResponse } from "../../response.ts";

type HandlerContext = {
  context: ContextResolution;
  request_id: string;
};

function trimOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function correctSignupHandler(
  req: Request,
  ctx: HandlerContext
): Promise<Response> {
  if (ctx.context.status !== "RESOLVED") {
    return okResponse({ corrected: false, reason: "CONTEXT_NOT_RESOLVED" }, ctx.request_id);
  }

  const db = getServiceRoleClientWithContext(ctx.context);
  const requestId = ctx.request_id;

  const body = await req.json().catch(() => ({}));
  const { auth_user_id, name, parent_company_name, designation_hint, phone_number } = body ?? {};

  if (!auth_user_id) {
    return okResponse({ corrected: false, reason: "MISSING_AUTH_USER_ID" }, requestId);
  }

  const correctedName = trimOrNull(name);
  if (!correctedName) {
    return okResponse({ corrected: false, reason: "NAME_REQUIRED" }, requestId);
  }

  const correctedCompany = trimOrNull(parent_company_name);
  if (!correctedCompany) {
    return okResponse({ corrected: false, reason: "COMPANY_REQUIRED" }, requestId);
  }

  const { data, error } = await db
    .schema("erp_core")
    .from("signup_requests")
    .update({
      name: correctedName,
      parent_company_name: correctedCompany,
      designation_hint: trimOrNull(designation_hint),
      phone_number: trimOrNull(phone_number),
    })
    .eq("auth_user_id", auth_user_id)
    .eq("decision", "PENDING")
    .select("auth_user_id")
    .maybeSingle();

  if (error) {
    return okResponse({ corrected: false, reason: error.message ?? "DB_ERROR" }, requestId);
  }

  if (!data) {
    // Row not found or already approved/rejected — treat as no-op, not an error
    return okResponse({ corrected: false, reason: "NOT_PENDING_OR_NOT_FOUND" }, requestId);
  }

  return okResponse({ corrected: true }, requestId);
}
