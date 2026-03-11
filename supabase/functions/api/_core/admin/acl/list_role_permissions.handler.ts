/*
 * File-ID: ID-9.7
 * File-Path: supabase/functions/api/_core/admin/acl/list_role_permissions.handler.ts
 * gate_id: 9
 * Phase: 9
 * Domain: ACL
 * Purpose: List VWED permissions assigned to a role for admin governance visibility.
 * Authority: Backend
 */

import {
  getServiceRoleClientWithContext,
} from "../../../_shared/serviceRoleClient.ts";

import type { ContextResolution } from "../../../_pipeline/context.ts";

import { okResponse, errorResponse } from "../../response.ts";
import { log } from "../../../_lib/logger.ts";
import { generateRequestId } from "../../../_lib/request_id.ts";

/* =========================================================
 * Types
 * ========================================================= */

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

export async function listRolePermissionsHandler(
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
     * 2️⃣ Parse query (?role_code=)
     * -------------------------------------------------- */
    const url = new URL(req.url);
    const roleCode = url.searchParams.get("role_code");

    if (!roleCode) {
      log({
        level: "SECURITY",
        request_id: requestId,
        gate_id: "9.7",
        event: "ROLE_PERMISSION_LIST_INVALID_INPUT",
      });

      return errorResponse(
        "INVALID_INPUT",
        "role_code is required",
        requestId
      );
    }

    /* --------------------------------------------------
     * 3️⃣ Fetch VWED permissions (role lattice)
     * -------------------------------------------------- */
    const db = getServiceRoleClientWithContext(ctx.context);

    const { data, error } = await db
      .from("acl.role_menu_permissions")
      .select(
        `
          resource_code,
          can_view,
          can_write,
          can_edit,
          can_delete,
          can_approve,
          can_export
        `
      )
      .eq("role_code", roleCode)
      .order("resource_code", { ascending: true });

    if (error) {
      log({
        level: "ERROR",
        request_id: requestId,
        gate_id: "9.7",
        event: "ROLE_PERMISSION_LIST_DB_ERROR",
        meta: { error: error.message },
      });

      return errorResponse(
        "ROLE_PERMISSION_LIST_FAILED",
        "Fetch failed",
        requestId
      );
    }

    /* --------------------------------------------------
     * 4️⃣ Success
     * -------------------------------------------------- */
    return okResponse(
      {
        role_code: roleCode,
        permissions: data ?? [],
      },
      requestId
    );
  } catch (err) {
    log({
      level: "ERROR",
      request_id: requestId,
      gate_id: "9.7",
      event: "ROLE_PERMISSION_LIST_EXCEPTION",
      meta: { error: String(err) },
    });

    return errorResponse(
      (err as Error).message || "REQUEST_BLOCKED",
      "Unhandled error",
      requestId
    );
  }
}
