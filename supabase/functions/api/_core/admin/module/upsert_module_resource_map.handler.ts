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

type UpsertInput = {
  module_code?: string;
  resource_code?: string;
};

export async function upsertModuleResourceMapHandler(
  req: Request,
  ctx: { context: ContextResolution; request_id: string },
): Promise<Response> {
  try {
    assertAdmin(ctx);

    const body = (await req.json()) as UpsertInput;
    const moduleCode = body.module_code?.trim().toUpperCase();
    const resourceCode = body.resource_code?.trim().toUpperCase();

    if (!moduleCode || !resourceCode) {
      return errorResponse(
        "INVALID_INPUT",
        "module_code and resource_code required",
        ctx.request_id,
      );
    }

    const db = getServiceRoleClientWithContext(ctx.context);

    const { data: moduleRow } = await db
      .schema("acl")
      .from("module_registry")
      .select("module_code")
      .eq("module_code", moduleCode)
      .maybeSingle();

    if (!moduleRow) {
      return errorResponse(
        "MODULE_NOT_FOUND",
        "module not found",
        ctx.request_id,
      );
    }

    const { data: resourceRow } = await db
      .schema("erp_menu")
      .from("menu_master")
      .select("resource_code, menu_type")
      .eq("resource_code", resourceCode)
      .eq("menu_type", "PAGE")
      .maybeSingle();

    if (!resourceRow) {
      return errorResponse(
        "RESOURCE_NOT_FOUND",
        "published page resource not found",
        ctx.request_id,
      );
    }

    const { data: existing } = await db
      .schema("acl")
      .from("module_resource_map")
      .select("module_code, resource_code")
      .eq("resource_code", resourceCode)
      .maybeSingle();

    if (existing?.module_code === moduleCode) {
      return okResponse(
        {
          status: "ALREADY_MAPPED",
          module_code: moduleCode,
          resource_code: resourceCode,
        },
        ctx.request_id,
      );
    }

    if (existing) {
      const { error: removeExistingError } = await db
        .schema("acl")
        .from("module_resource_map")
        .delete()
        .eq("resource_code", resourceCode);

      if (removeExistingError) {
        return errorResponse(
          "MODULE_RESOURCE_REASSIGN_FAILED",
          removeExistingError.message,
          ctx.request_id,
        );
      }
    }

    const { error } = await db
      .schema("acl")
      .from("module_resource_map")
      .insert({
        module_code: moduleCode,
        resource_code: resourceCode,
      });

    if (error) {
      return errorResponse(
        "MODULE_RESOURCE_MAP_FAILED",
        error.message,
        ctx.request_id,
      );
    }

    return okResponse(
      {
        module_code: moduleCode,
        resource_code: resourceCode,
      },
      ctx.request_id,
    );
  } catch (err) {
    return errorResponse(
      (err as Error).message || "MODULE_RESOURCE_MAP_EXCEPTION",
      "module resource map exception",
      ctx.request_id,
    );
  }
}
