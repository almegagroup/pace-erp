/*
 * File-ID: ID-9.8
 * File-Path: supabase/functions/api/_core/admin/acl/list_user_overrides.handler.ts
 * gate_id:9
 * Phase: 9
 * Domain: ACL
 * Purpose: List active user permission overrides.
 * Authority: Backend
 */

import { getServiceRoleClientWithContext } from "../../../_shared/serviceRoleClient.ts";
import type { ContextResolution } from "../../../_pipeline/context.ts";
import { okResponse, errorResponse } from "../../response.ts";
import { log } from "../../../_lib/logger.ts";
import { generateRequestId } from "../../../_lib/request_id.ts";

type AdminContext = {
  context: ContextResolution;
};

function assertAdmin(ctx: AdminContext): void {
  if (ctx.context.status !== "RESOLVED" || ctx.context.isAdmin !== true) {
    throw new Error("ADMIN_ONLY");
  }
}

export async function listUserOverridesHandler(
  req: Request,
  ctx: AdminContext
): Promise<Response> {
  const requestId = generateRequestId();

   // harmless read (avoids unused warning)
  req.headers;

  try {
    assertAdmin(ctx);

    const db = getServiceRoleClientWithContext(ctx.context);

    const { data, error } = await db
      .schema("acl").from("user_overrides")
      .select(
        `
        override_id,
        user_id,
        company_id,
        resource_code,
        action_code,
        effect,
        reason,
        created_at,
        revoked_at
      `
      )
      .is("revoked_at", null)
      .order("created_at", { ascending: false });

    if (error) {
      log({
        level: "ERROR",
        request_id: requestId,
        gate_id:"9.8",
        event: "LIST_USER_OVERRIDES_FAILED",
        meta: { error: error.message },
      });

      return errorResponse(
        "USER_OVERRIDE_LIST_FAILED",
        "List failed",
        requestId
      );
    }

    return okResponse(
      {
        overrides: data ?? [],
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