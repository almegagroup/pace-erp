import { getServiceRoleClientWithContext } from "../../../_shared/serviceRoleClient.ts";
import type { ContextResolution, PipelineSession } from "../../../_pipeline/context.ts";
import { okResponse, errorResponse } from "../../response.ts";
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

export async function listReportViewerRulesHandler(
  req: Request,
  ctx: AdminContext,
): Promise<Response> {
  const requestId = generateRequestId();
  req.headers;

  try {
    assertAdmin(ctx);

    const db = getServiceRoleClientWithContext(ctx.context);

    const { data, error } = await db
      .schema("acl")
      .from("report_viewer_map")
      .select(`
        viewer_id,
        company_id,
        module_code,
        resource_code,
        action_code,
        subject_work_context_id,
        viewer_role_code,
        viewer_user_id,
        created_at
      `)
      .order("company_id", { ascending: true })
      .order("module_code", { ascending: true })
      .order("resource_code", { ascending: true })
      .order("action_code", { ascending: true });

    if (error) {
      return errorResponse(
        "REPORT_VIEWER_RULE_LIST_FAILED",
        "List failed",
        requestId,
      );
    }

    return okResponse(data ?? [], requestId);
  } catch (err) {
    return errorResponse(
      (err as Error).message || "REQUEST_BLOCKED",
      "Unhandled error",
      requestId,
    );
  }
}
