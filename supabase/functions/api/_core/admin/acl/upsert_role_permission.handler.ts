/*
 * File-ID: ID-9.7
 * File-Path: supabase/functions/api/_core/admin/acl/upsert_role_permission.handler.ts
 * gate_id:9
 * Phase: 9
 * Domain: ACL
 * Purpose: Create or update VWED permissions for a role-resource pair.
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

type UpsertRolePermissionInput = {
  role_code: string;
  resource_code: string;
  can_view?: boolean;
  can_write?: boolean;
  can_edit?: boolean;
  can_delete?: boolean;
  can_approve?: boolean;
  can_export?: boolean;
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

export async function upsertRolePermissionHandler(
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
    const body = (await req.json()) as Partial<UpsertRolePermissionInput>;

    if (!body.role_code || !body.resource_code) {
      log({
        level: "SECURITY",
        request_id: requestId,
        gate_id:"9.7",
        event: "UPSERT_ROLE_PERMISSION_INVALID_INPUT",
        meta: body,
      });

      return errorResponse(
        "INVALID_INPUT",
        "role_code and resource_code required",
        requestId
      );
    }

    const payload = {
  role_code: body.role_code,
  resource_code: body.resource_code,
  can_view: Boolean(body.can_view),
  can_write: Boolean(body.can_write),
  can_edit: Boolean(body.can_edit),
  can_delete: Boolean(body.can_delete),
  can_approve: Boolean(body.can_approve),
  can_export: Boolean(body.can_export),
};

const hasAnyPermission =
  payload.can_view ||
  payload.can_write ||
  payload.can_edit ||
  payload.can_delete ||
  payload.can_approve ||
  payload.can_export;

if (!hasAnyPermission) {
  return errorResponse(
    "INVALID_PERMISSION_SET",
    "At least one permission must be true",
    requestId
  );
}


    /* --------------------------------------------------
     * 3️⃣ Upsert VWED permission (idempotent)
     * -------------------------------------------------- */
    const db = getServiceRoleClientWithContext(ctx.context);

    const { error } = await db
      .from("acl.role_menu_permissions")
      .upsert(payload, {
        onConflict: "role_code,resource_code",
      });

    if (error) {
      log({
        level: "ERROR",
        request_id: requestId,
        gate_id:"9.7",
        event: "UPSERT_ROLE_PERMISSION_DB_ERROR",
        meta: { error: error.message },
      });

      return errorResponse(
        "ROLE_PERMISSION_UPSERT_FAILED",
        "Upsert failed",
        requestId
      );
    }

    /* --------------------------------------------------
     * 4️⃣ Success
     * -------------------------------------------------- */
    log({
      level: "SECURITY",
      request_id: requestId,
      gate_id:"9.7",
      event: "ROLE_PERMISSION_UPSERTED",
      meta: payload,
    });

    return okResponse(
      {
        role_code: payload.role_code,
        resource_code: payload.resource_code,
        permissions: {
          can_view: payload.can_view,
          can_write: payload.can_write,
          can_edit: payload.can_edit,
          can_delete: payload.can_delete,
          can_approve: payload.can_approve,
          can_export: payload.can_export,
        },
      },
      requestId
    );
  } catch (err) {
    log({
      level: "ERROR",
      request_id: requestId,
      gate_id:"9.7",
      event: "UPSERT_ROLE_PERMISSION_EXCEPTION",
      meta: { error: String(err) },
    });

    return errorResponse(
      (err as Error).message || "REQUEST_BLOCKED",
      "Unhandled error",
      requestId
    );
  }
}
