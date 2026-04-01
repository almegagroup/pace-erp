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

export async function createModuleHandler(
  req: Request,
  ctx: { context: ContextResolution; request_id: string },
): Promise<Response> {
  try {
    assertAdmin(ctx);

    const body = (await req.json()) as CreateModuleInput;
    const moduleName = body.module_name?.trim();
    const projectId = body.project_id?.trim();
    const approvalRequired = body.approval_required === true;
    const approvalType = approvalRequired ? body.approval_type ?? null : null;
    const minApprovers = Number(body.min_approvers ?? 1);
    const maxApprovers = Number(body.max_approvers ?? 3);

    if (!moduleName || !projectId) {
      return errorResponse(
        "INVALID_INPUT",
        "module_name and project_id required",
        ctx.request_id,
      );
    }

    if (moduleName.length < 3) {
      return errorResponse(
        "MODULE_NAME_REQUIRED",
        "module_name must be at least 3 characters",
        ctx.request_id,
      );
    }

    if (!Number.isFinite(minApprovers) || !Number.isFinite(maxApprovers)) {
      return errorResponse(
        "MODULE_APPROVER_BOUNDS_INVALID",
        "min_approvers and max_approvers must be numeric",
        ctx.request_id,
      );
    }

    if (approvalRequired && !approvalType) {
      return errorResponse(
        "MODULE_APPROVAL_TYPE_REQUIRED",
        "approval_type required when approval_required = true",
        ctx.request_id,
      );
    }

    if (minApprovers < 1 || minApprovers > 3 || maxApprovers < 1 || maxApprovers > 3 || minApprovers > maxApprovers) {
      return errorResponse(
        "MODULE_APPROVER_BOUNDS_INVALID",
        "approver bounds must stay within 1 to 3 and min <= max",
        ctx.request_id,
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
      );
    }

    if (project.status !== "ACTIVE") {
      return errorResponse(
        "PROJECT_INACTIVE",
        "inactive project cannot receive active modules",
        ctx.request_id,
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
      return errorResponse(
        "MODULE_CREATE_FAILED",
        error?.message ?? "module create failed",
        ctx.request_id,
      );
    }

    return okResponse(
      {
        module: data,
      },
      ctx.request_id,
    );
  } catch (err) {
    return errorResponse(
      (err as Error).message || "MODULE_CREATE_EXCEPTION",
      "module create exception",
      ctx.request_id,
    );
  }
}
