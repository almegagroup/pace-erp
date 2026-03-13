/*
 * File-ID: ID-9.7
 * File-Path: supabase/functions/api/_core/admin/acl/disable_role_permission.handler.ts
 * gate_id: 9
 * Phase: 9
 * Domain: ACL
 * Purpose: Disable (clear) VWED permissions for a role-resource pair without deleting the row.
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

type DisableRolePermissionInput = {
  role_code: string;
  resource_code: string;
};

type AdminContext = {
  context: ContextResolution;
};

/* =========================================================
 * Guards
 * ========================================================= */

function assertAdmin(ctx: AdminContext): void {
  if (ctx.context.status !== "RESOLVED" || ctx.context.isAdmin !== true) {
    throw new Error("ADMIN_ONLY");
  }
}

/* =========================================================
 * Handler
 * ========================================================= */

export async function disableRolePermissionHandler(
  req: Request,
  ctx: AdminContext
): Promise<Response> {
  const requestId = generateRequestId();

  try {
    /* --------------------------------------------------
     * 1️⃣ Authority assertions
     * -------------------------------------------------- */
    
    assertAdmin(ctx);

    /* --------------------------------------------------
     * 2️⃣ Parse & validate input
     * -------------------------------------------------- */
    const body = (await req.json()) as Partial<DisableRolePermissionInput>;

    if (!body.role_code || !body.resource_code) {
      log({
        level: "SECURITY",
        request_id: requestId,
        gate_id: "9.7",
        event: "DISABLE_ROLE_PERMISSION_INVALID_INPUT",
        meta: body,
      });

      return errorResponse(
        "INVALID_INPUT",
        "role_code and resource_code required",
        requestId
      );
    }

    /* --------------------------------------------------
     * 3️⃣ Clear VWED flags (soft-disable)
     * -------------------------------------------------- */
    const db = getServiceRoleClientWithContext(ctx.context);

    const { data: existing } = await db
  .schema("acl").from("role_menu_permissions")
  .select("role_code")
  .eq("role_code", body.role_code)
  .eq("resource_code", body.resource_code)
  .maybeSingle();

if (!existing) {
  return errorResponse(
    "ROLE_PERMISSION_NOT_FOUND",
    "No such permission",
    requestId
  );
}

const { error } = await db
  .schema("acl").from("role_menu_permissions")
  .update({
    can_view: false,
    can_write: false,
    can_edit: false,
    can_delete: false,
    can_approve: false,
    can_export: false,
  })
  .eq("role_code", body.role_code)
  .eq("resource_code", body.resource_code);


    if (error) {
      log({
        level: "ERROR",
        request_id: requestId,
        gate_id: "9.7",
        event: "DISABLE_ROLE_PERMISSION_DB_ERROR",
        meta: { error: error.message },
      });

      return errorResponse(
        "ROLE_PERMISSION_DISABLE_FAILED",
        "Disable failed",
        requestId
      );
    }

    /* --------------------------------------------------
     * 4️⃣ Success
     * -------------------------------------------------- */
    log({
      level: "SECURITY",
      request_id: requestId,
      gate_id: "9.7",
      event: "ROLE_PERMISSION_DISABLED",
      meta: {
        role_code: body.role_code,
        resource_code: body.resource_code,
      },
    });

    return okResponse(
      {
        role_code: body.role_code,
        resource_code: body.resource_code,
        disabled: true,
      },
      requestId
    );
  } catch (err) {
    log({
      level: "ERROR",
      request_id: requestId,
      gate_id: "9.7",
      event: "DISABLE_ROLE_PERMISSION_EXCEPTION",
      meta: { error: String(err) },
    });

    return errorResponse(
      (err as Error).message || "REQUEST_BLOCKED",
      "Unhandled error",
      requestId
    );
  }
}
