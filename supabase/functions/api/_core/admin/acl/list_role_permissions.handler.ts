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
import type { VwedAction } from "../../../_acl/vwed_engine.ts";

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
      .schema("acl").from("role_menu_permissions")
      .select(
        `
          action,
          effect,
          menu:menu_id!inner (
            menu_code
          )
        `
      )
      .eq("role_code", roleCode)
      .order("action", { ascending: true });

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
    const grouped = new Map<string, {
      resource_code: string;
      can_view: boolean;
      can_write: boolean;
      can_edit: boolean;
      can_delete: boolean;
      can_approve: boolean;
      can_export: boolean;
      denied_actions: VwedAction[];
    }>();

    for (const row of data ?? []) {
      const resourceCode = row.menu?.menu_code;

      if (!resourceCode) {
        continue;
      }

      const existing = grouped.get(resourceCode) ?? {
        resource_code: resourceCode,
        can_view: false,
        can_write: false,
        can_edit: false,
        can_delete: false,
        can_approve: false,
        can_export: false,
        denied_actions: [],
      };

      const action = row.action as VwedAction;
      const isAllowed = row.effect === "ALLOW";

      if (isAllowed) {
        if (action === "VIEW") existing.can_view = true;
        if (action === "WRITE") existing.can_write = true;
        if (action === "EDIT") existing.can_edit = true;
        if (action === "DELETE") existing.can_delete = true;
        if (action === "APPROVE") existing.can_approve = true;
        if (action === "EXPORT") existing.can_export = true;
      } else if (!existing.denied_actions.includes(action)) {
        existing.denied_actions.push(action);
      }

      grouped.set(resourceCode, existing);
    }

    return okResponse(
      {
        role_code: roleCode,
        permissions: Array.from(grouped.values()).sort((left, right) =>
          left.resource_code.localeCompare(right.resource_code, "en", {
            numeric: true,
            sensitivity: "base",
          })
        ),
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
