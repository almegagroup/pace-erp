/*
 * File-ID: 9.14A
 * File-Path: supabase/functions/api/_core/audit/log_admin_action.ts
 * Gate: 9
 * Phase: 9
 * Domain: AUDIT
 * Purpose: Write admin control-plane actions to audit log
 * Authority: Backend
 */

import { getServiceRoleClientWithContext } from "../../_shared/serviceRoleClient.ts";
import type { ContextResolution } from "../../_pipeline/context.ts";

interface AuditCtx {
  context: ContextResolution;
  request_id: string;
  auth_user_id: string;
}

export async function logAdminAction(
  ctx: AuditCtx,
  action_code: string,
  resource_type: string,
  resource_id: string | null,
  status: "SUCCESS" | "FAILED",
  snapshot: unknown
): Promise<void> {

  if (ctx.context.status !== "RESOLVED") {
    return;
  }

  const db = getServiceRoleClientWithContext(ctx.context);

  await db
    .schema("erp_audit").from("admin_action_audit")
    .insert({
      request_id: ctx.request_id,
      admin_user_id: ctx.auth_user_id,
      action_code,
      resource_type,
      resource_id,
      company_id: ctx.context.companyId,
      status,
      snapshot
    });

}