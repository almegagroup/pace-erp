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
import { resolveOrProvisionAclMenuResource } from "../../../_shared/acl_menu_resource.ts";
import type { VwedAction } from "../../../_acl/vwed_engine.ts";

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
  denied_actions?: VwedAction[];
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
      resource_code: body.resource_code.trim().toUpperCase(),
      can_view: Boolean(body.can_view),
      can_write: Boolean(body.can_write),
      can_edit: Boolean(body.can_edit),
      can_delete: Boolean(body.can_delete),
      can_approve: Boolean(body.can_approve),
      can_export: Boolean(body.can_export),
      denied_actions: Array.from(
        new Set(
          Array.isArray(body.denied_actions)
            ? body.denied_actions
                .map((action) =>
                  typeof action === "string" ? action.trim().toUpperCase() : "",
                )
                .filter((action) =>
                  ["VIEW", "WRITE", "EDIT", "DELETE", "APPROVE", "EXPORT"].includes(action),
                )
            : [],
        ),
      ) as VwedAction[],
    };

const allowedActions: VwedAction[] = [
  payload.can_view ? "VIEW" : null,
  payload.can_write ? "WRITE" : null,
  payload.can_edit ? "EDIT" : null,
  payload.can_delete ? "DELETE" : null,
  payload.can_approve ? "APPROVE" : null,
  payload.can_export ? "EXPORT" : null,
].filter(Boolean) as VwedAction[];

const hasAnyPermission = allowedActions.length > 0 || payload.denied_actions.length > 0;

if (!hasAnyPermission) {
  return errorResponse(
    "INVALID_PERMISSION_SET",
    "At least one allow or deny action must be provided",
    requestId
  );
}

if (allowedActions.some((action) => payload.denied_actions.includes(action))) {
  return errorResponse(
    "INVALID_PERMISSION_SET",
    "The same action cannot be both allowed and denied",
    requestId
  );
}


    /* --------------------------------------------------
     * 3️⃣ Upsert VWED permission (idempotent)
     * -------------------------------------------------- */
    const db = getServiceRoleClientWithContext(ctx.context);
    const { aclMenuId, resourceCode } = await resolveOrProvisionAclMenuResource(
      db,
      payload.resource_code,
    );

    const { error: deleteError } = await db
      .schema("acl")
      .from("role_menu_permissions")
      .delete()
      .eq("role_code", payload.role_code)
      .eq("menu_id", aclMenuId);

    if (deleteError) {
      return errorResponse(
        "ROLE_PERMISSION_UPSERT_FAILED",
        "Upsert failed",
        requestId
      );
    }

    const rows = [
      ...allowedActions.map((action) => ({
        action,
        effect: "ALLOW" as const,
      })),
      ...payload.denied_actions.map((action) => ({
        action,
        effect: "DENY" as const,
      })),
    ].map((row) => ({
        role_code: payload.role_code,
        menu_id: aclMenuId,
        action: row.action,
        effect: row.effect,
        approval_required: false,
      }));

    const { error } = await db
      .schema("acl")
      .from("role_menu_permissions")
      .insert(rows);

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
        resource_code: resourceCode,
        permissions: {
          can_view: payload.can_view,
          can_write: payload.can_write,
          can_edit: payload.can_edit,
          can_delete: payload.can_delete,
          can_approve: payload.can_approve,
          can_export: payload.can_export,
          denied_actions: payload.denied_actions,
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
