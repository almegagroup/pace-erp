import { getServiceRoleClientWithContext } from "../../../_shared/serviceRoleClient.ts";
import type { ContextResolution } from "../../../_pipeline/context.ts";
import { okResponse, errorResponse } from "../../../_core/response.ts";

function assertAdmin(ctx: { context: ContextResolution }): void {
  if (ctx.context.status !== "RESOLVED" || ctx.context.isAdmin !== true) {
    throw new Error("ADMIN_ONLY");
  }
}

type UpdateGroupInput = {
  group_id?: number;
  name?: string;
};

export async function updateGroupHandler(
  req: Request,
  ctx: { context: ContextResolution; request_id: string },
): Promise<Response> {
  try {
    assertAdmin(ctx);

    const body = (await req.json()) as UpdateGroupInput;
    const groupId = Number(body.group_id);
    const name = body.name?.trim();

    if (!Number.isFinite(groupId) || !name || name.length < 2) {
      return errorResponse(
        "INVALID_INPUT",
        "group_id and valid name required",
        ctx.request_id,
      );
    }

    const db = getServiceRoleClientWithContext(ctx.context);

    const { data: existing } = await db
      .schema("erp_master")
      .from("groups")
      .select("id, group_code, name, state")
      .eq("id", groupId)
      .maybeSingle();

    if (!existing) {
      return errorResponse(
        "GROUP_NOT_FOUND",
        "group not found",
        ctx.request_id,
      );
    }

    const { data, error } = await db
      .schema("erp_master")
      .from("groups")
      .update({ name })
      .eq("id", groupId)
      .select("id, group_code, name, state")
      .single();

    if (error || !data) {
      return errorResponse(
        "GROUP_UPDATE_FAILED",
        error?.message ?? "group update failed",
        ctx.request_id,
      );
    }

    return okResponse(
      {
        group: data,
      },
      ctx.request_id,
    );
  } catch (err) {
    return errorResponse(
      (err as Error).message || "GROUP_UPDATE_EXCEPTION",
      "group update exception",
      ctx.request_id,
    );
  }
}
