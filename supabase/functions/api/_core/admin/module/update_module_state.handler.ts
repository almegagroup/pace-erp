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

type UpdateModuleStateInput = {
  module_id?: string;
  next_state?: "ACTIVE" | "INACTIVE";
};

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  ACTIVE: ["INACTIVE"],
  INACTIVE: ["ACTIVE"],
};

export async function updateModuleStateHandler(
  req: Request,
  ctx: { context: ContextResolution; request_id: string },
): Promise<Response> {
  try {
    assertAdmin(ctx);

    const body = (await req.json()) as UpdateModuleStateInput;
    const moduleId = body.module_id?.trim();
    const nextState = body.next_state;

    if (!moduleId || !nextState) {
      return errorResponse(
        "MODULE_STATE_INPUT_INVALID",
        "module_id and next_state required",
        ctx.request_id,
      );
    }

    const db = getServiceRoleClientWithContext(ctx.context);

    const { data: existing } = await db
      .schema("acl")
      .from("module_registry")
      .select("module_id, module_code, is_active")
      .eq("module_id", moduleId)
      .maybeSingle();

    if (!existing) {
      return errorResponse(
        "MODULE_NOT_FOUND",
        "module not found",
        ctx.request_id,
      );
    }

    const currentState = existing.is_active === true ? "ACTIVE" : "INACTIVE";
    if (!(ALLOWED_TRANSITIONS[currentState] ?? []).includes(nextState)) {
      return errorResponse(
        "MODULE_STATE_TRANSITION_INVALID",
        "invalid module state transition",
        ctx.request_id,
      );
    }

    const { error } = await db
      .schema("acl")
      .from("module_registry")
      .update({
        is_active: nextState === "ACTIVE",
      })
      .eq("module_id", moduleId);

    if (error) {
      return errorResponse(
        "MODULE_STATE_UPDATE_FAILED",
        error.message,
        ctx.request_id,
      );
    }

    return okResponse(
      {
        module_id: moduleId,
        module_code: existing.module_code,
        previous_state: currentState,
        current_state: nextState,
      },
      ctx.request_id,
    );
  } catch (err) {
    return errorResponse(
      (err as Error).message || "MODULE_STATE_UPDATE_EXCEPTION",
      "module state update exception",
      ctx.request_id,
    );
  }
}
