import { getServiceRoleClientWithContext } from "../../../_shared/serviceRoleClient.ts";
import type { ContextResolution, PipelineSession } from "../../../_pipeline/context.ts";
import { okResponse, errorResponse } from "../../response.ts";
import { log } from "../../../_lib/logger.ts";
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

export async function deleteReportViewerRuleHandler(
  req: Request,
  ctx: AdminContext,
): Promise<Response> {
  const requestId = generateRequestId();

  try {
    assertAdmin(ctx);

    const body = await req.json().catch(() => ({}));
    const { viewer_id } = body ?? {};

    if (!viewer_id) {
      return errorResponse("INVALID_INPUT", "viewer_id required", requestId);
    }

    const db = getServiceRoleClientWithContext(ctx.context);

    const { error } = await db
      .schema("acl")
      .from("report_viewer_map")
      .delete()
      .eq("viewer_id", viewer_id);

    if (error) {
      log({
        level: "ERROR",
        request_id: requestId,
        gate_id: "9.11",
        event: "REPORT_VIEWER_RULE_DELETE_FAILED",
        meta: { error: error.message },
      });

      return errorResponse(
        "REPORT_VIEWER_RULE_DELETE_FAILED",
        "Delete failed",
        requestId,
      );
    }

    return okResponse({ viewer_id }, requestId);
  } catch (err) {
    return errorResponse(
      (err as Error).message || "REQUEST_BLOCKED",
      "Unhandled error",
      requestId,
    );
  }
}
