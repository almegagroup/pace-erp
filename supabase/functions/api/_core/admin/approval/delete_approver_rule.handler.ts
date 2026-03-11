/*
 * File-ID: ID-9.10
 * File-Path: supabase/functions/api/_core/admin/approval/delete_approver_rule.handler.ts
 * gate_id:9
 * Phase: 9
 * Domain: APPROVAL
 * Purpose: Delete approval stage rule.
 * Authority: Backend
 */

import { getServiceRoleClientWithContext } from "../../../_shared/serviceRoleClient.ts";
import type { ContextResolution, PipelineSession } from "../../../_pipeline/context.ts";
import { okResponse, errorResponse } from "../../response.ts";
import { log } from "../../../_lib/logger.ts";
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

export async function deleteApproverRuleHandler(
  req: Request,
  ctx: AdminContext
): Promise<Response> {

  const requestId = generateRequestId();

  try {

    assertAdmin(ctx);

    const body = await req.json().catch(() => ({}));

    const { approver_id } = body ?? {};

    if (!approver_id) {
      return errorResponse(
        "INVALID_INPUT",
        "approver_id required",
        requestId
      );
    }

    const db = getServiceRoleClientWithContext(ctx.context);

    const { error } = await db
      .from("acl.approver_map")
      .delete()
      .eq("approver_id", approver_id);

    if (error) {

      log({
        level: "ERROR",
        request_id: requestId,
        gate_id:"9.10",
        event: "APPROVER_RULE_DELETE_FAILED",
        meta: { error: error.message }
      });

      return errorResponse(
        "APPROVER_RULE_DELETE_FAILED",
        "Delete failed",
        requestId
      );
    }

    log({
      level: "SECURITY",
      request_id: requestId,
      gate_id:"9.10",
      event: "APPROVER_RULE_DELETED",
      meta: { approver_id }
    });

    return okResponse(
      { approver_id },
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