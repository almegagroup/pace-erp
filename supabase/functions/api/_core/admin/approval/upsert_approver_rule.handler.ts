/*
 * File-ID: ID-9.10
 * File-Path: supabase/functions/api/_core/admin/approval/upsert_approver_rule.handler.ts
 * gate_id:9
 * Phase: 9
 * Domain: APPROVAL
 * Purpose: Create or update approval routing rule for a module or exact governed work scope.
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
  approver_id?: string;
  company_id: string;
  module_code: string;
  resource_code?: string;
  action_code?: string;
  scope_type?: string;
  subject_work_context_id?: string;
  subject_user_id?: string;
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

function normalizeScopeType(input: unknown): string {
  const normalized = String(input ?? "").trim().toUpperCase();

  if (normalized) {
    return normalized;
  }

  return "COMPANY_WIDE";
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

    if (
      (body.resource_code && !body.action_code) ||
      (!body.resource_code && body.action_code)
    ) {
      return errorResponse(
        "INVALID_SCOPE_INPUT",
        "resource_code and action_code must be provided together",
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

    const approvalStage = Number(body.approval_stage);

    if (!Number.isInteger(approvalStage) || approvalStage < 1 || approvalStage > 3) {
      return errorResponse(
        "INVALID_APPROVAL_STAGE",
        "approval_stage must be an integer between 1 and 3",
        requestId
      );
    }

    const db = getServiceRoleClientWithContext(ctx.context);
    const scopeType = normalizeScopeType(body.scope_type);

    if (!["COMPANY_WIDE", "DEPARTMENT", "WORK_CONTEXT", "USER_EXCEPTION", "DIRECTOR"].includes(scopeType)) {
      return errorResponse(
        "INVALID_SCOPE_TYPE",
        "scope_type must be COMPANY_WIDE, DEPARTMENT, WORK_CONTEXT, USER_EXCEPTION, or DIRECTOR",
        requestId
      );
    }

    const subjectWorkContextId = body.subject_work_context_id?.trim() || null;
    const subjectUserId = body.subject_user_id?.trim() || null;

    if (scopeType === "USER_EXCEPTION" && !subjectUserId) {
      return errorResponse(
        "INVALID_SCOPE_SUBJECT",
        "USER_EXCEPTION requires subject_user_id",
        requestId
      );
    }

    if ((scopeType === "WORK_CONTEXT" || scopeType === "DEPARTMENT") && !subjectWorkContextId) {
      return errorResponse(
        "INVALID_SCOPE_SUBJECT",
        `${scopeType} requires subject_work_context_id`,
        requestId
      );
    }

    if ((scopeType === "COMPANY_WIDE" || scopeType === "DIRECTOR") && (subjectWorkContextId || subjectUserId)) {
      return errorResponse(
        "INVALID_SCOPE_SUBJECT",
        `${scopeType} cannot keep subject_work_context_id or subject_user_id`,
        requestId
      );
    }

    if (scopeType === "USER_EXCEPTION" && subjectWorkContextId) {
      return errorResponse(
        "INVALID_SCOPE_SUBJECT",
        "USER_EXCEPTION cannot keep subject_work_context_id",
        requestId
      );
    }

    if ((scopeType === "WORK_CONTEXT" || scopeType === "DEPARTMENT") && subjectUserId) {
      return errorResponse(
        "INVALID_SCOPE_SUBJECT",
        `${scopeType} cannot keep subject_user_id`,
        requestId
      );
    }

    const payload = {
      company_id: body.company_id,
      module_code: body.module_code,
      resource_code: body.resource_code ?? null,
      action_code: body.action_code ?? null,
      scope_type: scopeType,
      subject_work_context_id: subjectWorkContextId,
      subject_user_id: subjectUserId,
      approval_stage: approvalStage,
      approver_role_code: roleCode,
      approver_user_id: body.approver_user_id ?? null,
      created_by: ctx.session.authUserId
    };

    let existingQuery = db
      .schema("acl").from("approver_map")
      .select("approver_id")
      .eq("company_id", payload.company_id)
      .eq("module_code", payload.module_code)
      .eq("approval_stage", payload.approval_stage);

    if (payload.resource_code && payload.action_code) {
      existingQuery = existingQuery
        .eq("resource_code", payload.resource_code)
        .eq("action_code", payload.action_code);
    } else {
      existingQuery = existingQuery
        .is("resource_code", null)
        .is("action_code", null);
    }

    if (payload.subject_work_context_id) {
      existingQuery = existingQuery.eq(
        "subject_work_context_id",
        payload.subject_work_context_id,
      );
    } else {
      existingQuery = existingQuery.is("subject_work_context_id", null);
    }

    if (payload.subject_user_id) {
      existingQuery = existingQuery.eq("subject_user_id", payload.subject_user_id);
    } else {
      existingQuery = existingQuery.is("subject_user_id", null);
    }

    existingQuery = existingQuery.eq("scope_type", payload.scope_type);

    if (payload.approver_user_id) {
      existingQuery = existingQuery
        .eq("approver_user_id", payload.approver_user_id)
        .is("approver_role_code", null);
    } else {
      existingQuery = existingQuery
        .eq("approver_role_code", payload.approver_role_code)
        .is("approver_user_id", null);
    }

    const { data: existingRule, error: lookupError } =
      body.approver_id
        ? await db
            .schema("acl").from("approver_map")
            .select("approver_id")
            .eq("approver_id", body.approver_id)
            .maybeSingle()
        : await existingQuery.maybeSingle();

    if (lookupError) {
      return errorResponse(
        "APPROVER_RULE_LOOKUP_FAILED",
        "Lookup failed",
        requestId
      );
    }

    if (!payload.approver_role_code && payload.approver_user_id) {
      const { data: targetUserRole, error: targetUserRoleError } = await db
        .schema("erp_acl")
        .from("user_roles")
        .select("role_code")
        .eq("auth_user_id", payload.approver_user_id)
        .maybeSingle();

      if (targetUserRoleError) {
        return errorResponse(
          "APPROVER_ROLE_LOOKUP_FAILED",
          "Could not read approver user role",
          requestId
        );
      }

      const targetRoleCode = normalizeRoleCode(targetUserRole?.role_code ?? null);

      if (!targetRoleCode) {
        return errorResponse(
          "APPROVER_ROLE_LOOKUP_FAILED",
          "Approver user must have a valid ERP role before assignment",
          requestId
        );
      }
    }

    const insertPayload = { ...payload };
    const updatePayload = {
      company_id: payload.company_id,
      module_code: payload.module_code,
      resource_code: payload.resource_code,
      action_code: payload.action_code,
      scope_type: payload.scope_type,
      subject_work_context_id: payload.subject_work_context_id,
      subject_user_id: payload.subject_user_id,
      approval_stage: payload.approval_stage,
      approver_role_code: payload.approver_role_code,
      approver_user_id: payload.approver_user_id,
    };

    const { error } = existingRule
      ? await db
          .schema("acl").from("approver_map")
          .update(updatePayload)
          .eq("approver_id", existingRule.approver_id)
      : await db
          .schema("acl").from("approver_map")
          .insert(insertPayload);

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
        error.message,
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
