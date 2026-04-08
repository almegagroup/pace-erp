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

type RemoveInput = {
  resource_code?: string;
};

export async function removeModuleResourceMapHandler(
  req: Request,
  ctx: { context: ContextResolution; request_id: string },
): Promise<Response> {
  try {
    assertAdmin(ctx);

    const body = (await req.json()) as RemoveInput;
    const resourceCode = body.resource_code?.trim().toUpperCase();

    if (!resourceCode) {
      return errorResponse(
        "INVALID_INPUT",
        "resource_code required",
        ctx.request_id,
      );
    }

    const db = getServiceRoleClientWithContext(ctx.context);

    const { error } = await db
      .schema("acl")
      .from("module_resource_map")
      .delete()
      .eq("resource_code", resourceCode);

    if (error) {
      return errorResponse(
        "MODULE_RESOURCE_UNMAP_FAILED",
        error.message,
        ctx.request_id,
      );
    }

    return okResponse(
      {
        resource_code: resourceCode,
      },
      ctx.request_id,
    );
  } catch (err) {
    return errorResponse(
      (err as Error).message || "MODULE_RESOURCE_UNMAP_EXCEPTION",
      "module resource unmap exception",
      ctx.request_id,
    );
  }
}
