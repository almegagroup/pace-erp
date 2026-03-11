/*
 * File-ID: ID-9.10
 * File-Path: supabase/functions/api/_core/admin/approval/upsert_approver_rule.handler.ts
 * gate_id:9
 * Phase: 9
 * Domain: APPROVAL
 * Purpose: Create or update approval routing rule for a module.
 * Authority: Backend
 */

import { getServiceRoleClientWithContext } from "../../../_shared/serviceRoleClient.ts";
import type { ContextResolution, PipelineSession } from "../../../_pipeline/context.ts";
import { normalizeRoleCode } from "../../../_shared/role_ladder.ts";
import { okResponse, errorResponse } from "../../response.ts";
import { log } from "../../../_lib/logger.ts";
import { generateRequestId } from "../../../_lib/request_id.ts";

/* =========================================================
 * Types
 * ========================================================= */

type UpsertApproverInput = {
  company_id: string;
  module_code: string;
  approval_stage: number;
  approver_role_code?: string;
  approver_user_id?: string;
};

type AdminContext = {
  context: ContextResolution;
  session: PipelineSession;
};

/* =========================================================
 * Guard
 * ========================================================= */

function assertAdmin(ctx: AdminContext): void {
  if (ctx.context.status !== "RESOLVED" || ctx.context.isAdmin !== true) {
    throw new Error("ADMIN_ONLY");
  }
}

/* =========================================================
 * Handler
 * ========================================================= */

export async function upsertApproverRuleHandler(
  req: Request,
  ctx: AdminContext
): Promise<Response> {

  const requestId = generateRequestId();

  try {

    assertAdmin(ctx);

    const body = (await req.json()) as Partial<UpsertApproverInput>;

    if (!body.company_id || !body.module_code || !body.approval_stage) {

      log({
        level: "SECURITY",
        request_id: requestId,
        gate_id:"9.10",
        event: "APPROVER_RULE_INVALID_INPUT",
        meta: body
      });

      return errorResponse(
        "INVALID_INPUT",
        "company_id, module_code, approval_stage required",
        requestId
      );
    }

    /* ---- XOR validation ---- */

    if (
      (body.approver_role_code && body.approver_user_id) ||
      (!body.approver_role_code && !body.approver_user_id)
    ) {
      return errorResponse(
        "INVALID_APPROVER_TARGET",
        "Provide either approver_role_code or approver_user_id",
        requestId
      );
    }

    /* ---- Role normalization ---- */

    let roleCode: string | null = null;

    if (body.approver_role_code) {

      roleCode = normalizeRoleCode(body.approver_role_code);

      if (!roleCode) {
        return errorResponse(
          "INVALID_ROLE_CODE",
          "Unknown role",
          requestId
        );
      }
    }

    const db = getServiceRoleClientWithContext(ctx.context);

    const payload = {
      company_id: body.company_id,
      module_code: body.module_code,
      approval_stage: body.approval_stage,
      approver_role_code: roleCode,
      approver_user_id: body.approver_user_id ?? null,
      created_by: ctx.session.authUserId
    };

    const { error } = await db
      .from("acl.approver_map")
      .upsert(payload, {
        onConflict: "company_id,module_code,approval_stage"
      });

    if (error) {

      log({
        level: "ERROR",
        request_id: requestId,
        gate_id:"9.10",
        event: "APPROVER_RULE_UPSERT_FAILED",
        meta: { error: error.message }
      });

      return errorResponse(
        "APPROVER_RULE_UPSERT_FAILED",
        "Upsert failed",
        requestId
      );
    }

    log({
      level: "SECURITY",
      request_id: requestId,
      gate_id:"9.10",
      event: "APPROVER_RULE_UPSERTED",
      meta: payload
    });

    return okResponse(payload, requestId);

  } catch (err) {

    log({
      level: "ERROR",
      request_id: requestId,
      gate_id:"9.10",
      event: "APPROVER_RULE_EXCEPTION",
      meta: { error: String(err) }
    });

    return errorResponse(
      (err as Error).message || "REQUEST_BLOCKED",
      "Unhandled error",
      requestId
    );
  }
}