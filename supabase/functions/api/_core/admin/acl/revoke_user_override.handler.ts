/*
 * File-ID: ID-9.8
 * File-Path: supabase/functions/api/_core/admin/acl/revoke_user_override.handler.ts
 * gate_id:9
 * Phase: 9
 * Domain: ACL
 * Purpose: Revoke an active per-user permission override.
 * Authority: Backend
 */

import { getServiceRoleClientWithContext } from "../../../_shared/serviceRoleClient.ts";
import type { ContextResolution } from "../../../_pipeline/context.ts";
import { okResponse, errorResponse } from "../../response.ts";
import { log } from "../../../_lib/logger.ts";
import { generateRequestId } from "../../../_lib/request_id.ts";

/* ========================================================= */

type RevokeInput = {
  override_id: string;
};

type AdminContext = {
  context: ContextResolution;
  auth_user_id: string;
};

function assertAdmin(
  ctx: AdminContext
): asserts ctx is { context: ContextResolution & { status: "RESOLVED"; isAdmin: true }; auth_user_id: string } {
  if (ctx.context.status !== "RESOLVED" || ctx.context.isAdmin !== true) {
    throw new Error("ADMIN_ONLY");
  }
}

export async function revokeUserOverrideHandler(
  req: Request,
  ctx: AdminContext
): Promise<Response> {
  const requestId = generateRequestId();

  try {
    assertAdmin(ctx);

    const body = (await req.json()) as Partial<RevokeInput>;

    if (!body.override_id) {
      return errorResponse(
        "INVALID_INPUT",
        "override_id required",
        requestId
      );
    }

    const db = getServiceRoleClientWithContext(ctx.context);

    const { error } = await db
      .schema("acl").from("user_overrides")
      .update({
        revoked_at: new Date().toISOString(),
        revoked_by: ctx.auth_user_id,
      })
      .eq("override_id", body.override_id);

    if (error) {
      log({
        level: "ERROR",
        request_id: requestId,
        gate_id:"9.8",
        event: "USER_OVERRIDE_REVOKE_FAILED",
        meta: { error: error.message },
      });

      return errorResponse(
        "USER_OVERRIDE_REVOKE_FAILED",
        "Revoke failed",
        requestId
      );
    }

    return okResponse(
      {
        override_id: body.override_id,
        revoked: true,
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
