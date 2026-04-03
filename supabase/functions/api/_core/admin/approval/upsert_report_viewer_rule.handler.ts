import { getServiceRoleClientWithContext } from "../../../_shared/serviceRoleClient.ts";
import type { ContextResolution, PipelineSession } from "../../../_pipeline/context.ts";
import { normalizeRoleCode } from "../../../_shared/role_ladder.ts";
import { okResponse, errorResponse } from "../../response.ts";
import { log } from "../../../_lib/logger.ts";
import { generateRequestId } from "../../../_lib/request_id.ts";

type UpsertViewerInput = {
  viewer_id?: string;
  company_id: string;
  module_code: string;
  resource_code: string;
  action_code: "VIEW" | "EXPORT";
  subject_work_context_id?: string;
  viewer_role_code?: string;
  viewer_user_id?: string;
};

type AdminContext = {
  context: ContextResolution;
  session: PipelineSession;
};

function assertAdmin(ctx: AdminContext): void {
  if (ctx.context.status !== "RESOLVED" || ctx.context.isAdmin !== true) {
    throw new Error("ADMIN_ONLY");
  }
}

export async function upsertReportViewerRuleHandler(
  req: Request,
  ctx: AdminContext,
): Promise<Response> {
  const requestId = generateRequestId();

  try {
    assertAdmin(ctx);

    const body = (await req.json()) as Partial<UpsertViewerInput>;

    if (!body.company_id || !body.module_code || !body.resource_code || !body.action_code) {
      return errorResponse(
        "INVALID_INPUT",
        "company_id, module_code, resource_code, action_code required",
        requestId,
      );
    }

    if (!["VIEW", "EXPORT"].includes(body.action_code)) {
      return errorResponse(
        "INVALID_ACTION_CODE",
        "action_code must be VIEW or EXPORT",
        requestId,
      );
    }

    if (
      (body.viewer_role_code && body.viewer_user_id) ||
      (!body.viewer_role_code && !body.viewer_user_id)
    ) {
      return errorResponse(
        "INVALID_VIEWER_TARGET",
        "Provide either viewer_role_code or viewer_user_id",
        requestId,
      );
    }

    let roleCode: string | null = null;
    if (body.viewer_role_code) {
      roleCode = normalizeRoleCode(body.viewer_role_code);
      if (!roleCode) {
        return errorResponse("INVALID_ROLE_CODE", "Unknown role", requestId);
      }
    }

    const db = getServiceRoleClientWithContext(ctx.context);

    const payload = {
      company_id: body.company_id,
      module_code: body.module_code,
      resource_code: body.resource_code,
      action_code: body.action_code,
      subject_work_context_id: body.subject_work_context_id?.trim() || null,
      viewer_role_code: roleCode,
      viewer_user_id: body.viewer_user_id?.trim() || null,
      created_by: ctx.session.authUserId,
    };

    let existingQuery = db
      .schema("acl")
      .from("report_viewer_map")
      .select("viewer_id")
      .eq("company_id", payload.company_id)
      .eq("module_code", payload.module_code)
      .eq("resource_code", payload.resource_code)
      .eq("action_code", payload.action_code);

    if (payload.subject_work_context_id) {
      existingQuery = existingQuery.eq("subject_work_context_id", payload.subject_work_context_id);
    } else {
      existingQuery = existingQuery.is("subject_work_context_id", null);
    }

    if (payload.viewer_user_id) {
      existingQuery = existingQuery
        .eq("viewer_user_id", payload.viewer_user_id)
        .is("viewer_role_code", null);
    } else {
      existingQuery = existingQuery
        .eq("viewer_role_code", payload.viewer_role_code)
        .is("viewer_user_id", null);
    }

    const { data: existingRule, error: lookupError } =
      body.viewer_id
        ? await db
            .schema("acl")
            .from("report_viewer_map")
            .select("viewer_id")
            .eq("viewer_id", body.viewer_id)
            .maybeSingle()
        : await existingQuery.maybeSingle();

    if (lookupError) {
      return errorResponse("REPORT_VIEWER_RULE_LOOKUP_FAILED", "Lookup failed", requestId);
    }

    const insertPayload = { ...payload };
    const updatePayload = {
      company_id: payload.company_id,
      module_code: payload.module_code,
      resource_code: payload.resource_code,
      action_code: payload.action_code,
      subject_work_context_id: payload.subject_work_context_id,
      viewer_role_code: payload.viewer_role_code,
      viewer_user_id: payload.viewer_user_id,
    };

    const { error } = existingRule
      ? await db
          .schema("acl")
          .from("report_viewer_map")
          .update(updatePayload)
          .eq("viewer_id", existingRule.viewer_id)
      : await db
          .schema("acl")
          .from("report_viewer_map")
          .insert(insertPayload);

    if (error) {
      log({
        level: "ERROR",
        request_id: requestId,
        gate_id: "9.11",
        event: "REPORT_VIEWER_RULE_UPSERT_FAILED",
        meta: { error: error.message },
      });

      return errorResponse(
        "REPORT_VIEWER_RULE_UPSERT_FAILED",
        error.message,
        requestId,
      );
    }

    return okResponse(payload, requestId);
  } catch (err) {
    return errorResponse(
      (err as Error).message || "REQUEST_BLOCKED",
      "Unhandled error",
      requestId,
    );
  }
}
