/*
 * File-ID: ID-9.7B
 * File-Path: supabase/functions/api/_core/admin/acl/disable_capability_action.handler.ts
 * Gate: 9
 * Phase: 9
 * Domain: ACL
 * Purpose: Clear all governed resource-action rows for a capability pack on one resource
 * Authority: Backend
 */

import { getServiceRoleClientWithContext } from "../../../_shared/serviceRoleClient.ts";
import type { ContextResolution } from "../../../_pipeline/context.ts";
import { okResponse, errorResponse } from "../../response.ts";
import { generateRequestId } from "../../../_lib/request_id.ts";
import { resolveOrProvisionAclMenuResource } from "../../../_shared/acl_menu_resource.ts";

type DisableCapabilityActionInput = {
  capability_code: string;
  resource_code: string;
};

type AdminContext = {
  context: ContextResolution;
};

function assertAdmin(ctx: AdminContext): void {
  if (ctx.context.status !== "RESOLVED" || ctx.context.isAdmin !== true) {
    throw new Error("ADMIN_ONLY");
  }
}

export async function disableCapabilityActionHandler(
  req: Request,
  ctx: AdminContext
): Promise<Response> {
  const requestId = generateRequestId();

  try {
    assertAdmin(ctx);

    const body = (await req.json()) as Partial<DisableCapabilityActionInput>;

    if (!body.capability_code || !body.resource_code) {
      return errorResponse(
        "INVALID_INPUT",
        "capability_code and resource_code required",
        requestId
      );
    }

    const db = getServiceRoleClientWithContext(ctx.context);
    const { aclMenuId, resourceCode } = await resolveOrProvisionAclMenuResource(
      db,
      body.resource_code.trim().toUpperCase()
    );

    const { error } = await db
      .schema("acl")
      .from("capability_menu_actions")
      .delete()
      .eq("capability_code", body.capability_code.trim().toUpperCase())
      .eq("menu_id", aclMenuId);

    if (error) {
      return errorResponse(
        "CAPABILITY_ACTION_DISABLE_FAILED",
        "Failed to disable capability actions",
        requestId
      );
    }

    return okResponse(
      {
        capability_code: body.capability_code.trim().toUpperCase(),
        resource_code: resourceCode,
        disabled: true,
      },
      requestId
    );
  } catch (err) {
    return errorResponse(
      (err as Error).message || "REQUEST_BLOCKED",
      "Unhandled error",
      requestId
    );
  }
}
