import { getServiceRoleClientWithContext } from "../../../_shared/serviceRoleClient.ts";
import type { ContextResolution } from "../../../_pipeline/context.ts";
import { okResponse, errorResponse } from "../../response.ts";
import { generateRequestId } from "../../../_lib/request_id.ts";

type Input = {
  work_context_id?: string;
  project_ids?: string[];
};

type AdminContext = {
  context: ContextResolution;
};

function assertAdmin(ctx: AdminContext): void {
  if (ctx.context.status !== "RESOLVED" || ctx.context.isAdmin !== true) {
    throw new Error("ADMIN_ONLY");
  }
}

function normalizeIdArray(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

export async function syncWorkContextProjectsHandler(
  req: Request,
  ctx: AdminContext,
): Promise<Response> {
  const requestId = generateRequestId();

  try {
    assertAdmin(ctx);

    const body = (await req.json()) as Input;
    const workContextId = body.work_context_id?.trim() ?? "";
    const projectIds = normalizeIdArray(body.project_ids);

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
      .select("work_context_id, company_id, work_context_code")
      .eq("work_context_id", workContextId)
      .maybeSingle();

    if (workContextError || !workContext) {
      return errorResponse(
        "WORK_CONTEXT_PROJECTS_SCOPE_NOT_FOUND",
        workContextError?.message ?? "work context not found",
        requestId,
      );
    }

    const { data: companyProjectRows, error: companyProjectError } = projectIds.length === 0
      ? { data: [], error: null }
      : await db
        .schema("erp_map")
        .from("company_projects")
        .select("project_id")
        .eq("company_id", workContext.company_id)
        .in("project_id", projectIds);

    if (companyProjectError) {
      return errorResponse(
        "WORK_CONTEXT_PROJECTS_COMPANY_LINK_FAILED",
        companyProjectError.message,
        requestId,
      );
    }

    const linkedProjectIds = new Set((companyProjectRows ?? []).map((row) => row.project_id));

    const { data: activeProjectRows, error: activeProjectError } = projectIds.length === 0
      ? { data: [], error: null }
      : await db
        .schema("erp_master")
        .from("projects")
        .select("id")
        .eq("status", "ACTIVE")
        .in("id", projectIds);

    if (activeProjectError) {
      return errorResponse(
        "WORK_CONTEXT_PROJECTS_ACTIVE_READ_FAILED",
        activeProjectError.message,
        requestId,
      );
    }

    const activeProjectIds = new Set((activeProjectRows ?? []).map((row) => row.id));
    const invalidProjectIds = projectIds.filter((projectId) =>
      !(linkedProjectIds.has(projectId) && activeProjectIds.has(projectId))
    );

    if (invalidProjectIds.length > 0) {
      return errorResponse(
        "WORK_CONTEXT_PROJECTS_INVALID",
        `invalid project binding: ${invalidProjectIds.join(", ")}`,
        requestId,
      );
    }

    const { error: deleteError } = await db
      .schema("erp_map")
      .from("work_context_projects")
      .delete()
      .eq("work_context_id", workContextId);

    if (deleteError) {
      return errorResponse(
        "WORK_CONTEXT_PROJECTS_DELETE_FAILED",
        deleteError.message,
        requestId,
      );
    }

    if (projectIds.length > 0) {
      const { error: insertError } = await db
        .schema("erp_map")
        .from("work_context_projects")
        .insert(
          projectIds.map((projectId) => ({
            work_context_id: workContextId,
            project_id: projectId,
          })),
        );

      if (insertError) {
        return errorResponse(
          "WORK_CONTEXT_PROJECTS_SAVE_FAILED",
          insertError.message,
          requestId,
        );
      }
    }

    return okResponse(
      {
        work_context_id: workContextId,
        project_ids: projectIds,
        company_id: workContext.company_id,
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
