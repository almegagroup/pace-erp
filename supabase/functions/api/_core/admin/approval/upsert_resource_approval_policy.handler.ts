import type { ContextResolution } from "../../../_pipeline/context.ts";
import { getServiceRoleClientWithContext } from "../../../_shared/serviceRoleClient.ts";
import { okResponse, errorResponse } from "../../../_core/response.ts";

function assertAdmin(
  ctx: { context: ContextResolution },
): asserts ctx is {
  context: Extract<ContextResolution, { status: "RESOLVED" }> & {
    isAdmin: true;
  };
} {
  if (ctx.context.status !== "RESOLVED" || ctx.context.isAdmin !== true) {
    throw new Error("ADMIN_ONLY");
  }
}

const VALID_ACTIONS = new Set(["VIEW", "WRITE", "EDIT", "DELETE", "APPROVE", "EXPORT"]);
const VALID_APPROVAL_TYPES = new Set(["ANYONE", "SEQUENTIAL", "MUST_ALL"]);

export async function upsertResourceApprovalPolicyHandler(
  req: Request,
  ctx: { context: ContextResolution; request_id: string },
): Promise<Response> {
  try {
    assertAdmin(ctx);

    const body = await req.json().catch(() => ({}));
    const resourceCode = String(body?.resource_code ?? "").trim().toUpperCase();
    const actionCode = String(body?.action_code ?? "").trim().toUpperCase();
    const approvalRequired = body?.approval_required === true;
    const approvalType = String(body?.approval_type ?? "").trim().toUpperCase();
    const minApprovers = Number(body?.min_approvers ?? 1);
    const maxApprovers = Number(body?.max_approvers ?? 3);

    if (!resourceCode || !actionCode) {
      return errorResponse("INVALID_INPUT", "resource_code and action_code are required", ctx.request_id);
    }
    if (!VALID_ACTIONS.has(actionCode)) {
      return errorResponse("INVALID_ACTION_CODE", "action_code invalid", ctx.request_id);
    }
    if (approvalRequired) {
      if (!VALID_APPROVAL_TYPES.has(approvalType)) {
        return errorResponse("INVALID_APPROVAL_TYPE", "approval_type invalid", ctx.request_id);
      }
      if (!Number.isInteger(minApprovers) || minApprovers < 1 || minApprovers > 3) {
        return errorResponse("INVALID_MIN_APPROVERS", "min_approvers must be between 1 and 3", ctx.request_id);
      }
      if (!Number.isInteger(maxApprovers) || maxApprovers < 1 || maxApprovers > 3) {
        return errorResponse("INVALID_MAX_APPROVERS", "max_approvers must be between 1 and 3", ctx.request_id);
      }
      if (minApprovers > maxApprovers) {
        return errorResponse("INVALID_APPROVER_RANGE", "min_approvers cannot exceed max_approvers", ctx.request_id);
      }
    }

    const db = getServiceRoleClientWithContext(ctx.context);

    const { data: menuRow, error: menuError } = await db
      .schema("erp_menu")
      .from("menu_master")
      .select("resource_code")
      .eq("resource_code", resourceCode)
      .maybeSingle();

    if (menuError || !menuRow?.resource_code) {
      return errorResponse("RESOURCE_NOT_FOUND", "resource not found", ctx.request_id);
    }

    const payload = {
      resource_code: resourceCode,
      action_code: actionCode,
      approval_required: approvalRequired,
      approval_type: approvalRequired ? approvalType : null,
      min_approvers: approvalRequired ? minApprovers : 1,
      max_approvers: approvalRequired ? maxApprovers : 3,
      created_at: new Date().toISOString(),
      created_by: null,
    };

    const { data, error } = await db
      .schema("acl")
      .from("resource_approval_policy")
      .upsert(payload, { onConflict: "resource_code,action_code" })
      .select("resource_code, action_code, approval_required, approval_type, min_approvers, max_approvers")
      .single();

    if (error) {
      return errorResponse("RESOURCE_POLICY_UPSERT_FAILED", error.message, ctx.request_id);
    }

    return okResponse({ policy: data }, ctx.request_id);
  } catch (err) {
    return errorResponse(
      (err as Error).message || "RESOURCE_POLICY_UPSERT_EXCEPTION",
      "resource approval policy upsert exception",
      ctx.request_id,
    );
  }
}
