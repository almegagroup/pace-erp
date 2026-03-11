/*
 * File-ID: ID-9.7A
 * File-Path: supabase/functions/api/_core/admin/acl/list_role_capabilities.handler.ts
 * Gate: 9
 * Phase: 9
 * Domain: ACL
 * Purpose: List capability packs assigned to a role (admin governance).
 * Authority: Backend
 */

import { getServiceRoleClientWithContext } from "../../../_shared/serviceRoleClient.ts";
import type { ContextResolution } from "../../../_pipeline/context.ts";
import { okResponse, errorResponse } from "../../response.ts";
import { generateRequestId } from "../../../_lib/request_id.ts";
import { log } from "../../../_lib/logger.ts";

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

export async function listRoleCapabilitiesHandler(
  req: Request,
  ctx: AdminContext
): Promise<Response> {
  const requestId = generateRequestId();

  try {
    /* 1️⃣ Admin guard */
    assertAdmin(ctx);

    /* 2️⃣ Parse query (?role_code=) */
    const url = new URL(req.url);
    const roleCode = url.searchParams.get("role_code");

    if (!roleCode) {
      return errorResponse(
        "INVALID_INPUT",
        "role_code is required",
        requestId
      );
    }

    const db = getServiceRoleClientWithContext(ctx.context);

    /* 3️⃣ Fetch assigned capabilities */
    const { data, error } = await db
      .from("acl.role_capabilities")
      .select(`
        capability_code,
        acl.capabilities (
          capability_name,
          description,
          is_system
        )
      `)
      .eq("role_code", roleCode)
      .order("capability_code", { ascending: true });

    if (error) {
      log({
        level: "ERROR",
        request_id: requestId,
        gate: "9.7A",
        event: "LIST_ROLE_CAPABILITIES_DB_ERROR",
        meta: { error: error.message },
      });

      return errorResponse(
        "ROLE_CAPABILITY_LIST_FAILED",
        "List failed",
        requestId
      );
    }

    /* 4️⃣ Success */
    return okResponse(
      {
        role_code: roleCode,
        capabilities: data ?? [],
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
