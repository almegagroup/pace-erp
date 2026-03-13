/*
 * File-ID: 9.14B
 * File-Path: supabase/functions/api/_core/admin/audit/list_audit_logs.handler.ts
 * Gate: 9
 * Phase: 9
 * Domain: AUDIT
 * Purpose: View administrative audit logs
 * Authority: Backend
 */

import { okResponse, errorResponse } from "../../response.ts";
import { getServiceRoleClientWithContext } from "../../../_shared/serviceRoleClient.ts";
import type { ContextResolution } from "../../../_pipeline/context.ts";

interface AuditViewerCtx {
  context: ContextResolution;
  request_id: string;
}

export async function listAuditLogsHandler(
  _req: Request,
  ctx: AuditViewerCtx
): Promise<Response> {

  if (ctx.context.status !== "RESOLVED") {
    return errorResponse(
      "CONTEXT_UNRESOLVED",
      "Audit context unresolved",
      ctx.request_id,
      "NONE",
      403
    );
  }

  const db = getServiceRoleClientWithContext(ctx.context);

  const { data, error } = await db
    .schema("erp_audit").from("admin_action_audit")
    .select(`
      audit_id,
      request_id,
      admin_user_id,
      action_code,
      resource_type,
      resource_id,
      company_id,
      performed_at,
      status
    `)
    .order("performed_at", { ascending: false })
    .limit(200);

  if (error) {
    return errorResponse(
      "AUDIT_READ_FAILED",
      error.message,
      ctx.request_id,
      "NONE",
      500
    );
  }

  return okResponse(data, ctx.request_id);
}