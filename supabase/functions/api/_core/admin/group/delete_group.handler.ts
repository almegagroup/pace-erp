import { getServiceRoleClientWithContext } from "../../../_shared/serviceRoleClient.ts";
import type { ContextResolution } from "../../../_pipeline/context.ts";
import { okResponse, errorResponse } from "../../../_core/response.ts";

function assertAdmin(ctx: { context: ContextResolution }): void {
  if (ctx.context.status !== "RESOLVED" || ctx.context.isAdmin !== true) {
    throw new Error("ADMIN_ONLY");
  }
}

type DeleteGroupInput = {
  group_id?: number;
};

export async function deleteGroupHandler(
  req: Request,
  ctx: { context: ContextResolution; request_id: string },
): Promise<Response> {
  try {
    assertAdmin(ctx);

    const body = (await req.json()) as DeleteGroupInput;
    const groupId = Number(body.group_id);

    if (!Number.isFinite(groupId)) {
      return errorResponse(
        "INVALID_INPUT",
        "group_id required",
        ctx.request_id,
      );
    }

    const db = getServiceRoleClientWithContext(ctx.context);

    const { data: existing } = await db
      .schema("erp_master")
      .from("groups")
      .select("id, group_code, name")
      .eq("id", groupId)
      .maybeSingle();

    if (!existing) {
      return errorResponse(
        "GROUP_NOT_FOUND",
        "group not found",
        ctx.request_id,
      );
    }

    const { count, error: mappingError } = await db
      .schema("erp_map")
      .from("company_group")
      .select("company_id", { count: "exact", head: true })
      .eq("group_id", groupId);

    if (mappingError) {
      return errorResponse(
        "GROUP_MAPPING_COUNT_FAILED",
        mappingError.message,
        ctx.request_id,
      );
    }

    if ((count ?? 0) > 0) {
      return errorResponse(
        "GROUP_DELETE_BLOCKED",
        `group still has ${count ?? 0} mapped company rows`,
        ctx.request_id,
      );
    }

    const { error } = await db
      .schema("erp_master")
      .from("groups")
      .delete()
      .eq("id", groupId);

    if (error) {
      return errorResponse(
        "GROUP_DELETE_FAILED",
        error.message,
        ctx.request_id,
      );
    }

    return okResponse(
      {
        group_id: groupId,
        group_code: existing.group_code,
        status: "DELETED",
      },
      ctx.request_id,
    );
  } catch (err) {
    return errorResponse(
      (err as Error).message || "GROUP_DELETE_EXCEPTION",
      "group delete exception",
      ctx.request_id,
    );
  }
}
