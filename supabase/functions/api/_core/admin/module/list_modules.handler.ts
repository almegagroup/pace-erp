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

type ProjectRow = {
  id: string;
  project_code: string;
  project_name: string;
  status: string | null;
};

type ModuleRow = {
  module_id: string;
  module_code: string;
  module_name: string;
  project_id: string;
  approval_required: boolean;
  approval_type: string | null;
  min_approvers: number;
  max_approvers: number;
  is_active: boolean;
  created_at?: string | null;
};

type CompanyModuleRow = {
  module_code: string;
  enabled: boolean;
};

export async function listModulesHandler(
  req: Request,
  ctx: { context: ContextResolution; request_id: string },
): Promise<Response> {
  try {
    assertAdmin(ctx);

    const url = new URL(req.url);
    const projectId = url.searchParams.get("project_id")?.trim() || null;

    const db = getServiceRoleClientWithContext(ctx.context);

    let moduleQuery = db
      .schema("acl")
      .from("module_registry")
      .select(
        "module_id, module_code, module_name, project_id, approval_required, approval_type, min_approvers, max_approvers, is_active, created_at",
      )
      .order("module_code", { ascending: true });

    if (projectId) {
      moduleQuery = moduleQuery.eq("project_id", projectId);
    }

    const [{ data: modules, error: moduleError }, { data: projects, error: projectError }, { data: companyModules, error: companyModuleError }] =
      await Promise.all([
        moduleQuery,
        db
          .schema("erp_master")
          .from("projects")
          .select("id, project_code, project_name, status"),
        db
          .schema("acl")
          .from("company_module_map")
          .select("module_code, enabled"),
      ]);

    if (moduleError) {
      return errorResponse(
        "MODULE_LIST_FAILED",
        moduleError.message,
        ctx.request_id,
      );
    }

    if (projectError) {
      return errorResponse(
        "PROJECT_LIST_FAILED",
        projectError.message,
        ctx.request_id,
      );
    }

    if (companyModuleError) {
      return errorResponse(
        "COMPANY_MODULE_LIST_FAILED",
        companyModuleError.message,
        ctx.request_id,
      );
    }

    const projectMap = new Map(
      ((projects ?? []) as ProjectRow[]).map((row) => [row.id, row]),
    );

    const companyEnableCount = new Map<string, number>();
    for (const row of (companyModules ?? []) as CompanyModuleRow[]) {
      if (row.enabled !== true) continue;
      companyEnableCount.set(
        row.module_code,
        (companyEnableCount.get(row.module_code) ?? 0) + 1,
      );
    }

    const payload = ((modules ?? []) as ModuleRow[]).map((row) => {
      const project = projectMap.get(row.project_id) ?? null;
      return {
        ...row,
        project_code: project?.project_code ?? "",
        project_name: project?.project_name ?? "",
        project_status: project?.status ?? null,
        mapped_company_count: companyEnableCount.get(row.module_code) ?? 0,
      };
    });

    return okResponse(
      {
        modules: payload,
      },
      ctx.request_id,
    );
  } catch (err) {
    return errorResponse(
      (err as Error).message || "MODULE_LIST_EXCEPTION",
      "module list exception",
      ctx.request_id,
    );
  }
}
