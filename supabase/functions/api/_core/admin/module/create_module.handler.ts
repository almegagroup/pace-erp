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

function normalizeModuleCode(value?: string | null): string {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
}

function slugifyModuleName(value?: string | null): string {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

type CreateModuleInput = {
  module_code?: string;
  module_name?: string;
  project_id?: string;
  approval_required?: boolean;
  approval_type?: "ANYONE" | "SEQUENTIAL" | "MUST_ALL" | null;
  min_approvers?: number;
  max_approvers?: number;
};

const MIN_REQUIRED_APPROVERS = 2;
const MAX_ALLOWED_APPROVERS = 3;

export async function createModuleHandler(
  req: Request,
  ctx: { context: ContextResolution; request_id: string },
): Promise<Response> {
  const routeKey = "POST:/api/admin/module";

  try {
    assertAdmin(ctx);

    const body = (await req.json()) as CreateModuleInput;
    const moduleName = body.module_name?.trim();
    const projectId = body.project_id?.trim();
    const approvalRequired = body.approval_required === true;
    const approvalType = approvalRequired ? body.approval_type ?? null : null;
    const minApprovers = Number(body.min_approvers ?? MIN_REQUIRED_APPROVERS);
    const maxApprovers = Number(body.max_approvers ?? MAX_ALLOWED_APPROVERS);

    if (!moduleName || !projectId) {
      log({
        level: "SECURITY",
        request_id: ctx.request_id,
        gate_id: "9.module",
        route_key: routeKey,
        event: "MODULE_CREATE_INVALID_INPUT",
        meta: {
          has_module_name: Boolean(moduleName),
          has_project_id: Boolean(projectId),
        },
      });
      return errorResponse(
        "INVALID_INPUT",
        "module_name and project_id required",
        ctx.request_id,
        "NONE",
        403,
        {
          gateId: "9.module",
          routeKey,
          decisionTrace: "MODULE_CREATE_INVALID_INPUT",
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
          decisionTrace: "MODULE_NAME_TOO_SHORT",
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
          decisionTrace: "MODULE_APPROVER_BOUNDS_NON_NUMERIC",
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
          decisionTrace: "MODULE_APPROVAL_TYPE_REQUIRED",
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
          decisionTrace: "MODULE_APPROVER_BOUNDS_INVALID",
        },
      );
    }

    const db = getServiceRoleClientWithContext(ctx.context);

    const { data: project } = await db
      .schema("erp_master")
      .from("projects")
      .select("id, project_code, status")
      .eq("id", projectId)
      .maybeSingle();

    if (!project) {
      return errorResponse(
        "PROJECT_NOT_FOUND",
        "project not found",
        ctx.request_id,
        "NONE",
        403,
        {
          gateId: "9.module",
          routeKey,
          decisionTrace: "MODULE_PROJECT_NOT_FOUND",
        },
      );
    }

    if (project.status !== "ACTIVE") {
      return errorResponse(
        "PROJECT_INACTIVE",
        "inactive project cannot receive active modules",
        ctx.request_id,
        "NONE",
        403,
        {
          gateId: "9.module",
          routeKey,
          decisionTrace: "MODULE_PROJECT_INACTIVE",
        },
      );
    }

    const explicitModuleCode = normalizeModuleCode(body.module_code);
    const moduleSlug = slugifyModuleName(moduleName);
    const moduleCodeBase = explicitModuleCode || `${project.project_code}_${moduleSlug}`;

    if (!moduleCodeBase) {
      return errorResponse(
        "MODULE_CODE_GENERATION_FAILED",
        "module code could not be generated",
        ctx.request_id,
        "NONE",
        403,
        {
          gateId: "9.module",
          routeKey,
          decisionTrace: "MODULE_CODE_GENERATION_FAILED",
        },
      );
    }

    const codePattern = `${moduleCodeBase}%`;
    const { data: existingCodes, error: existingCodeError } = await db
      .schema("acl")
      .from("module_registry")
      .select("module_code")
      .like("module_code", codePattern);

    if (existingCodeError) {
      return errorResponse(
        "MODULE_CODE_GENERATION_FAILED",
        existingCodeError.message,
        ctx.request_id,
        "NONE",
        403,
        {
          gateId: "9.module",
          routeKey,
          decisionTrace: "MODULE_CODE_LOOKUP_FAILED",
        },
      );
    }

    const existingCodeSet = new Set(
      (existingCodes ?? []).map((row) => row.module_code),
    );

    let moduleCode = moduleCodeBase;
    let sequence = 2;

    while (existingCodeSet.has(moduleCode)) {
      moduleCode = `${moduleCodeBase}_${sequence}`;
      sequence += 1;
    }

    log({
      level: "INFO",
      request_id: ctx.request_id,
      gate_id: "9.module",
      route_key: routeKey,
      event: "MODULE_CREATE_ATTEMPT",
      meta: {
        project_id: projectId,
        project_code: project.project_code,
        module_name: moduleName,
        module_code: moduleCode,
        approval_required: approvalRequired,
        approval_type: approvalType,
        min_approvers: minApprovers,
        max_approvers: maxApprovers,
      },
    });

    const { data, error } = await db
      .schema("acl")
      .from("module_registry")
      .insert({
        module_code: moduleCode,
        module_name: moduleName,
        project_id: projectId,
        approval_required: approvalRequired,
        approval_type: approvalType,
        min_approvers: minApprovers,
        max_approvers: maxApprovers,
        is_active: true,
      })
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
        event: "MODULE_CREATE_FAILED",
        meta: {
          error: error?.message ?? "module create failed",
          project_id: projectId,
          module_code: moduleCode,
        },
      });
      return errorResponse(
        "MODULE_CREATE_FAILED",
        error?.message ?? "module create failed",
        ctx.request_id,
        "NONE",
        403,
        {
          gateId: "9.module",
          routeKey,
          decisionTrace: error?.message ?? "MODULE_CREATE_FAILED",
        },
      );
    }

    log({
      level: "SECURITY",
      request_id: ctx.request_id,
      gate_id: "9.module",
      route_key: routeKey,
      event: "MODULE_CREATED",
      meta: {
        module_id: data.module_id,
        module_code: data.module_code,
        project_id: projectId,
      },
    });

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
      event: "MODULE_CREATE_EXCEPTION",
      meta: {
        error: (err as Error).message || "MODULE_CREATE_EXCEPTION",
      },
    });
    return errorResponse(
      (err as Error).message || "MODULE_CREATE_EXCEPTION",
      "module create exception",
      ctx.request_id,
      "NONE",
      403,
      {
        gateId: "9.module",
        routeKey,
        decisionTrace: (err as Error).message || "MODULE_CREATE_EXCEPTION",
      },
    );
  }
}
