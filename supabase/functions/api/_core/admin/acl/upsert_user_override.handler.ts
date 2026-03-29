/*
 * File-ID: ID-9.8
 * File-Path: supabase/functions/api/_core/admin/acl/upsert_user_override.handler.ts
 * gate_id:9
 * Phase: 9
 * Domain: ACL
 * Purpose: Create or update a per-user permission override.
 * Authority: Backend
 */

import { getServiceRoleClientWithContext } from "../../../_shared/serviceRoleClient.ts";
import type { ContextResolution } from "../../../_pipeline/context.ts";
import { okResponse, errorResponse } from "../../response.ts";
import { log } from "../../../_lib/logger.ts";
import { generateRequestId } from "../../../_lib/request_id.ts";

/* =========================================================
 * Types
 * ========================================================= */

type UpsertUserOverrideInput = {
  user_id: string;
  company_id: string;
  resource_code: string;
  action_code: string;
  effect: "ALLOW" | "DENY";
  reason: string;
};

type AdminContext = {
  context: ContextResolution;
  auth_user_id: string;
};

/* =========================================================
 * Guards
 * ========================================================= */

function assertAdmin(
  ctx: AdminContext
): asserts ctx is { context: ContextResolution & { status: "RESOLVED"; isAdmin: true }; auth_user_id: string } {
  if (ctx.context.status !== "RESOLVED" || ctx.context.isAdmin !== true) {
    throw new Error("ADMIN_ONLY");
  }
}

/* =========================================================
 * Handler
 * ========================================================= */

export async function upsertUserOverrideHandler(
  req: Request,
  ctx: AdminContext
): Promise<Response> {
  const requestId = generateRequestId();

  try {
    /* -------------------------------------------------- */
    assertAdmin(ctx);

    const body = (await req.json()) as Partial<UpsertUserOverrideInput>;

    if (
      !body.user_id ||
      !body.company_id ||
      !body.resource_code ||
      !body.action_code ||
      !body.effect ||
      !body.reason
    ) {
      log({
        level: "SECURITY",
        request_id: requestId,
        gate_id:"9.8",
        event: "USER_OVERRIDE_INVALID_INPUT",
        meta: body,
      });

      return errorResponse(
        "INVALID_INPUT",
        "Required fields missing",
        requestId
      );
    }

    const db = getServiceRoleClientWithContext(ctx.context);

    const payload = {
      user_id: body.user_id,
      company_id: body.company_id,
      resource_code: body.resource_code.trim().toUpperCase(),
      action_code: body.action_code.trim().toUpperCase(),
      effect: body.effect,
      reason: body.reason,
      created_by: ctx.auth_user_id,
      revoked_at: null,
      revoked_by: null,
    };

    const { error } = await db
      .schema("acl").from("user_overrides")
      .upsert(payload, {
        onConflict: "user_id,company_id,resource_code,action_code",
      });

    if (error) {
      log({
        level: "ERROR",
        request_id: requestId,
        gate_id:"9.8",
        event: "USER_OVERRIDE_UPSERT_DB_ERROR",
        meta: { error: error.message },
      });

      return errorResponse(
        "USER_OVERRIDE_UPSERT_FAILED",
        "Upsert failed",
        requestId
      );
    }

    log({
      level: "SECURITY",
      request_id: requestId,
      gate_id:"9.8",
      event: "USER_OVERRIDE_UPSERTED",
      meta: payload,
    });

    return okResponse(payload, requestId);
  } catch (err) {
    log({
      level: "ERROR",
      request_id: requestId,
      gate_id:"9.8",
      event: "USER_OVERRIDE_EXCEPTION",
      meta: { error: String(err) },
    });

    return errorResponse(
      (err as Error).message || "REQUEST_BLOCKED",
      "Unhandled error",
      requestId
    );
  }
}
