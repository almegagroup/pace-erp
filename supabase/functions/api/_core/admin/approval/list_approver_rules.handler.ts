/*
 * File-ID: ID-9.10
 * File-Path: supabase/functions/api/_core/admin/approval/list_approver_rules.handler.ts
 * Gate: 9
 * Phase: 9
 * Domain: APPROVAL
 * Purpose: List configured approver routing rules.
 * Authority: Backend
 */

import { getServiceRoleClientWithContext } from "../../../_shared/serviceRoleClient.ts";
import type { ContextResolution, PipelineSession } from "../../../_pipeline/context.ts";
import { okResponse, errorResponse } from "../../response.ts";
import { generateRequestId } from "../../../_lib/request_id.ts";

type AdminContext = {
  context: ContextResolution;
  session: PipelineSession;
};

function assertAdmin(ctx: AdminContext): void {
  if (ctx.context.status !== "RESOLVED" || ctx.context.isAdmin !== true) {
    throw new Error("ADMIN_ONLY");
  }
}

export async function listApproverRulesHandler(
  req: Request,
  ctx: AdminContext
): Promise<Response> {

  const requestId = generateRequestId();

  // harmless read to avoid unused parameter warning
  req.headers;

  try {

    assertAdmin(ctx);

    const db = getServiceRoleClientWithContext(ctx.context);

    const { data, error } = await db
      .schema("acl").from("approver_map")
      .select(`
        approver_id,
        company_id,
        module_code,
        resource_code,
        action_code,
        scope_type,
        subject_work_context_id,
        subject_user_id,
        approval_stage,
        approver_role_code,
        approver_user_id,
        created_at
      `)
      .order("module_code", { ascending: true })
      .order("resource_code", { ascending: true })
      .order("action_code", { ascending: true })
      .order("approval_stage", { ascending: true });

    if (error) {

      return errorResponse(
        "APPROVER_RULE_LIST_FAILED",
        "List failed",
        requestId
      );
    }

    return okResponse(
      data ?? [],
      requestId
    );

  } catch (err) {

    return errorResponse(
      (err as Error).message || "REQUEST_BLOCKED",
      "Unhandled error",
      requestId
    );
  }
}
