/*
 * File-ID: ID-9.7B
 * File-Path: supabase/functions/api/_core/admin/acl/upsert_capability_action.handler.ts
 * Gate: 9
 * Phase: 9
 * Domain: ACL
 * Purpose: Create or update governed resource-action rows for a capability pack
 * Authority: Backend
 */

import { getServiceRoleClientWithContext } from "../../../_shared/serviceRoleClient.ts";
import type { ContextResolution } from "../../../_pipeline/context.ts";
import { okResponse, errorResponse } from "../../response.ts";
import { log } from "../../../_lib/logger.ts";
import { generateRequestId } from "../../../_lib/request_id.ts";
import { resolveOrProvisionAclMenuResource } from "../../../_shared/acl_menu_resource.ts";
import type { VwedAction } from "../../../_acl/vwed_engine.ts";

type UpsertCapabilityActionInput = {
  capability_code: string;
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

function assertAdmin(ctx: AdminContext): void {
  if (ctx.context.status !== "RESOLVED" || ctx.context.isAdmin !== true) {
    throw new Error("ADMIN_ONLY");
  }
}

export async function upsertCapabilityActionHandler(
  req: Request,
  ctx: AdminContext
): Promise<Response> {
  const requestId = generateRequestId();

  try {
    assertAdmin(ctx);

    const body = (await req.json()) as Partial<UpsertCapabilityActionInput>;

    if (!body.capability_code || !body.resource_code) {
      return errorResponse(
        "INVALID_INPUT",
        "capability_code and resource_code required",
        requestId
      );
    }

    const payload = {
      capability_code: body.capability_code.trim().toUpperCase(),
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
                  typeof action === "string" ? action.trim().toUpperCase() : ""
                )
                .filter((action) =>
                  ["VIEW", "WRITE", "EDIT", "DELETE", "APPROVE", "EXPORT"].includes(action)
                )
            : []
        )
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

    if (allowedActions.length === 0 && payload.denied_actions.length === 0) {
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

    const db = getServiceRoleClientWithContext(ctx.context);
    const { aclMenuId, resourceCode } = await resolveOrProvisionAclMenuResource(
      db,
      payload.resource_code
    );

    const { error: deleteError } = await db
      .schema("acl")
      .from("capability_menu_actions")
      .delete()
      .eq("capability_code", payload.capability_code)
      .eq("menu_id", aclMenuId);

    if (deleteError) {
      return errorResponse(
        "CAPABILITY_ACTION_UPSERT_FAILED",
        "Failed to reset capability actions",
        requestId
      );
    }

    const rows = [
      ...allowedActions.map((action) => ({
        capability_code: payload.capability_code,
        menu_id: aclMenuId,
        action,
        allowed: true,
      })),
      ...payload.denied_actions.map((action) => ({
        capability_code: payload.capability_code,
        menu_id: aclMenuId,
        action,
        allowed: false,
      })),
    ];

    const { error: insertError } = await db
      .schema("acl")
      .from("capability_menu_actions")
      .insert(rows);

    if (insertError) {
      log({
        level: "ERROR",
        request_id: requestId,
        gate_id: "9.7B",
        event: "CAPABILITY_ACTION_UPSERT_FAILED",
        meta: { error: insertError.message },
      });

      return errorResponse(
        "CAPABILITY_ACTION_UPSERT_FAILED",
        "Failed to save capability actions",
        requestId
      );
    }

    return okResponse(
      {
        capability_code: payload.capability_code,
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
    return errorResponse(
      (err as Error).message || "REQUEST_BLOCKED",
      "Unhandled error",
      requestId
    );
  }
}
