import { getServiceRoleClientWithContext } from "../../../_shared/serviceRoleClient.ts";
import type { ContextResolution } from "../../../_pipeline/context.ts";
import { okResponse, errorResponse } from "../../response.ts";
import { generateRequestId } from "../../../_lib/request_id.ts";

type AdminContext = {
  context: ContextResolution;
};

function assertAdmin(ctx: AdminContext): void {
  if (ctx.context.status !== "RESOLVED" || ctx.context.isAdmin !== true) {
    throw new Error("ADMIN_ONLY");
  }
}

export async function listWorkContextProjectsHandler(
  req: Request,
  ctx: AdminContext,
): Promise<Response> {
  const requestId = generateRequestId();

  try {
    assertAdmin(ctx);

    const url = new URL(req.url);
    const workContextId = url.searchParams.get("work_context_id")?.trim() ?? "";

    if (!workContextId) {
      return errorResponse(
        "INVALID_INPUT",
        "work_context_id is required",
        requestId,
      );
    }

    const db = getServiceRoleClientWithContext(ctx.context);
    const { data: workContext, error: workContextError } = await db
      .schema("erp_acl")
      .from("work_contexts")
      .select("work_context_id, company_id, work_context_code, work_context_name")
      .eq("work_context_id", workContextId)
      .maybeSingle();

    if (workContextError || !workContext) {
      return errorResponse(
        "WORK_CONTEXT_PROJECTS_SCOPE_NOT_FOUND",
        workContextError?.message ?? "work context not found",
        requestId,
      );
    }

    const [{ data: attachedRows, error: attachedError }, { data: companyProjectRows, error: companyProjectError }] =
      await Promise.all([
        db
          .schema("erp_map")
          .from("work_context_projects")
          .select("project_id")
          .eq("work_context_id", workContextId),
        db
          .schema("erp_map")
          .from("company_projects")
          .select("project_id")
          .eq("company_id", workContext.company_id),
      ]);

    if (attachedError || companyProjectError) {
      return errorResponse(
        "WORK_CONTEXT_PROJECTS_LIST_FAILED",
        attachedError?.message ?? companyProjectError?.message ?? "work-context project list failed",
        requestId,
      );
    }

    const attachedProjectIdSet = new Set((attachedRows ?? []).map((row) => row.project_id));
    const availableProjectIds = [...new Set((companyProjectRows ?? []).map((row) => row.project_id))];

    const { data: projects, error: projectError } = availableProjectIds.length === 0
      ? { data: [], error: null }
      : await db
        .schema("erp_master")
        .from("projects")
        .select("id, project_code, project_name, status, created_at")
        .eq("status", "ACTIVE")
        .in("id", availableProjectIds)
        .order("project_name", { ascending: true });

    if (projectError) {
      return errorResponse(
        "WORK_CONTEXT_PROJECTS_LIST_FAILED",
        projectError.message,
        requestId,
      );
    }

    return okResponse(
      {
        work_context: workContext,
        projects: (projects ?? []).map((project) => ({
          ...project,
          attached: attachedProjectIdSet.has(project.id),
        })),
      },
      requestId,
    );
  } catch (err) {
    return errorResponse(
      (err as Error).message || "REQUEST_BLOCKED",
      "Unhandled error",
      requestId,
    );
  }
}
