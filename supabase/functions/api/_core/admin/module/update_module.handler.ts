import type { ContextResolution } from "../../../_pipeline/context.ts";
import { getServiceRoleClientWithContext } from "../../../_shared/serviceRoleClient.ts";
import { okResponse, errorResponse } from "../../../_core/response.ts";
import { log } from "../../../_lib/logger.ts";

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

type UpdateModuleInput = {
  module_id?: string;
  module_name?: string;
  approval_required?: boolean;
  approval_type?: "ANYONE" | "SEQUENTIAL" | "MUST_ALL" | null;
  min_approvers?: number;
  max_approvers?: number;
};

const MIN_REQUIRED_APPROVERS = 1;
const MAX_ALLOWED_APPROVERS = 3;

export async function updateModuleHandler(
  req: Request,
  ctx: { context: ContextResolution; request_id: string },
): Promise<Response> {
  const routeKey = "POST:/api/admin/module/update";

  try {
    assertAdmin(ctx);

    const body = (await req.json()) as UpdateModuleInput;
    const moduleId = body.module_id?.trim();
    const moduleName = body.module_name?.trim();
    const approvalRequired = body.approval_required === true;
    const approvalType = approvalRequired ? body.approval_type ?? null : null;
    const minApprovers = Number(body.min_approvers ?? MIN_REQUIRED_APPROVERS);
    const maxApprovers = Number(body.max_approvers ?? MAX_ALLOWED_APPROVERS);

    if (!moduleId || !moduleName) {
      return errorResponse(
        "INVALID_INPUT",
        "module_id and module_name required",
        ctx.request_id,
        "NONE",
        403,
        {
          gateId: "9.module",
          routeKey,
          decisionTrace: "MODULE_UPDATE_INVALID_INPUT",
        },
      );
    }

    if (moduleName.length < 2) {
      return errorResponse(
        "MODULE_NAME_REQUIRED",
        "module_name must be at least 2 characters",
        ctx.request_id,
        "NONE",
        403,
        {
          gateId: "9.module",
          routeKey,
          decisionTrace: "MODULE_UPDATE_NAME_TOO_SHORT",
        },
      );
    }

    if (!Number.isFinite(minApprovers) || !Number.isFinite(maxApprovers)) {
      return errorResponse(
        "MODULE_APPROVER_BOUNDS_INVALID",
        "min_approvers and max_approvers must be numeric",
        ctx.request_id,
        "NONE",
        403,
        {
          gateId: "9.module",
          routeKey,
          decisionTrace: "MODULE_UPDATE_APPROVER_BOUNDS_NON_NUMERIC",
        },
      );
    }

    if (approvalRequired && !approvalType) {
      return errorResponse(
        "MODULE_APPROVAL_TYPE_REQUIRED",
        "approval_type required when approval_required = true",
        ctx.request_id,
        "NONE",
        403,
        {
          gateId: "9.module",
          routeKey,
          decisionTrace: "MODULE_UPDATE_APPROVAL_TYPE_REQUIRED",
        },
      );
    }

    if (
      minApprovers < MIN_REQUIRED_APPROVERS ||
      minApprovers > MAX_ALLOWED_APPROVERS ||
      maxApprovers < MIN_REQUIRED_APPROVERS ||
      maxApprovers > MAX_ALLOWED_APPROVERS ||
      minApprovers > maxApprovers
    ) {
      return errorResponse(
        "MODULE_APPROVER_BOUNDS_INVALID",
        `approver bounds must stay within ${MIN_REQUIRED_APPROVERS} to ${MAX_ALLOWED_APPROVERS} and min <= max`,
        ctx.request_id,
        "NONE",
        403,
        {
          gateId: "9.module",
          routeKey,
          decisionTrace: "MODULE_UPDATE_APPROVER_BOUNDS_INVALID",
        },
      );
    }

    const db = getServiceRoleClientWithContext(ctx.context);

    const { data: existing } = await db
      .schema("acl")
      .from("module_registry")
      .select("module_id, module_code, project_id")
      .eq("module_id", moduleId)
      .maybeSingle();

    if (!existing) {
      return errorResponse(
        "MODULE_NOT_FOUND",
        "module not found",
        ctx.request_id,
        "NONE",
        403,
        {
          gateId: "9.module",
          routeKey,
          decisionTrace: "MODULE_UPDATE_NOT_FOUND",
        },
      );
    }

    log({
      level: "INFO",
      request_id: ctx.request_id,
      gate_id: "9.module",
      route_key: routeKey,
      event: "MODULE_UPDATE_ATTEMPT",
      meta: {
        module_id: moduleId,
        module_code: existing.module_code,
        module_name: moduleName,
        approval_required: approvalRequired,
        approval_type: approvalType,
        min_approvers: minApprovers,
        max_approvers: maxApprovers,
      },
    });

    const { data, error } = await db
      .schema("acl")
      .from("module_registry")
      .update({
        module_name: moduleName,
        approval_required: approvalRequired,
        approval_type: approvalType,
        min_approvers: minApprovers,
        max_approvers: maxApprovers,
      })
      .eq("module_id", moduleId)
      .select(
        "module_id, module_code, module_name, project_id, approval_required, approval_type, min_approvers, max_approvers, is_active",
      )
      .single();

    if (error || !data) {
      log({
        level: "ERROR",
        request_id: ctx.request_id,
        gate_id: "9.module",
        route_key: routeKey,
        event: "MODULE_UPDATE_FAILED",
        meta: {
          error: error?.message ?? "module update failed",
          module_id: moduleId,
          module_code: existing.module_code,
        },
      });

      return errorResponse(
        "MODULE_UPDATE_FAILED",
        error?.message ?? "module update failed",
        ctx.request_id,
        "NONE",
        403,
        {
          gateId: "9.module",
          routeKey,
          decisionTrace: error?.message ?? "MODULE_UPDATE_FAILED",
        },
      );
    }

    return okResponse(
      {
        module: data,
      },
      ctx.request_id,
    );
  } catch (err) {
    log({
      level: "ERROR",
      request_id: ctx.request_id,
      gate_id: "9.module",
      route_key: routeKey,
      event: "MODULE_UPDATE_EXCEPTION",
      meta: {
        error: (err as Error).message || "MODULE_UPDATE_EXCEPTION",
      },
    });

    return errorResponse(
      (err as Error).message || "MODULE_UPDATE_EXCEPTION",
      "module update exception",
      ctx.request_id,
      "NONE",
      403,
      {
        gateId: "9.module",
        routeKey,
        decisionTrace: (err as Error).message || "MODULE_UPDATE_EXCEPTION",
      },
    );
  }
}
