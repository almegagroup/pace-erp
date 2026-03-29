/*
 * File-ID: ID-9.7B
 * File-Path: supabase/functions/api/_core/admin/acl/list_capability_actions.handler.ts
 * Gate: 9
 * Phase: 9
 * Domain: ACL
 * Purpose: List governed resource-action rows assigned to a capability pack
 * Authority: Backend
 */

import { getServiceRoleClientWithContext } from "../../../_shared/serviceRoleClient.ts";
import type { ContextResolution } from "../../../_pipeline/context.ts";
import { okResponse, errorResponse } from "../../response.ts";
import { log } from "../../../_lib/logger.ts";
import { generateRequestId } from "../../../_lib/request_id.ts";
import type { VwedAction } from "../../../_acl/vwed_engine.ts";

type AdminContext = {
  context: ContextResolution;
};

function assertAdmin(ctx: AdminContext): void {
  if (ctx.context.status !== "RESOLVED" || ctx.context.isAdmin !== true) {
    throw new Error("ADMIN_ONLY");
  }
}

export async function listCapabilityActionsHandler(
  req: Request,
  ctx: AdminContext
): Promise<Response> {
  const requestId = generateRequestId();

  try {
    assertAdmin(ctx);

    const url = new URL(req.url);
    const capabilityCode = url.searchParams.get("capability_code")?.trim() ?? "";

    if (!capabilityCode) {
      return errorResponse(
        "INVALID_INPUT",
        "capability_code is required",
        requestId
      );
    }

    const db = getServiceRoleClientWithContext(ctx.context);
    const { data, error } = await db
      .schema("acl")
      .from("capability_menu_actions")
      .select(`
        action,
        allowed,
        menu:menu_id!inner (
          menu_code
        )
      `)
      .eq("capability_code", capabilityCode)
      .order("action", { ascending: true });

    if (error) {
      log({
        level: "ERROR",
        request_id: requestId,
        gate_id: "9.7B",
        event: "CAPABILITY_ACTION_LIST_FAILED",
        meta: { error: error.message },
      });

      return errorResponse(
        "CAPABILITY_ACTION_LIST_FAILED",
        "Failed to list capability actions",
        requestId
      );
    }

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

      if (row.allowed === true) {
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
        capability_code: capabilityCode,
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
    return errorResponse(
      (err as Error).message || "REQUEST_BLOCKED",
      "Unhandled error",
      requestId
    );
  }
}
