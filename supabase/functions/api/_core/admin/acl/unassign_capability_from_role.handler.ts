/*
 * File-ID: ID-9.7A
 * File-Path: supabase/functions/api/_core/admin/acl/unassign_capability_from_role.handler.ts
 * Gate: 9
 * Phase: 9
 * Domain: ACL
 * Purpose: Unassign a capability pack from a role (admin governance).
 * Authority: Backend
 */

import { getServiceRoleClientWithContext } from "../../../_shared/serviceRoleClient.ts";
import type { ContextResolution } from "../../../_pipeline/context.ts";
import { okResponse, errorResponse } from "../../response.ts";
import { generateRequestId } from "../../../_lib/request_id.ts";

/* =========================================================
 * Types
 * ========================================================= */

type UnassignCapabilityInput = {
  role_code: string;
  capability_code: string;
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

export async function unassignCapabilityFromRoleHandler(
  req: Request,
  ctx: AdminContext
): Promise<Response> {
  const requestId = generateRequestId();

  try {
    /* 1️⃣ Admin guard */
    assertAdmin(ctx);

    /* 2️⃣ Parse + validate input */
    const body = (await req.json()) as Partial<UnassignCapabilityInput>;

    if (!body.role_code || !body.capability_code) {
      return errorResponse(
        "INVALID_INPUT",
        "role_code and capability_code required",
        requestId
      );
    }

    const db = getServiceRoleClientWithContext(ctx.context);

    /* 3️⃣ Unassign capability */
    const { error } = await db
      .schema("acl").from("role_capabilities")
      .delete()
      .eq("role_code", body.role_code)
      .eq("capability_code", body.capability_code);

    if (error) {
      return errorResponse(
        "ROLE_CAPABILITY_UNASSIGN_FAILED",
        "Unassign failed",
        requestId
      );
    }

    /* 4️⃣ Success */
    return okResponse(
      {
        role_code: body.role_code,
        capability_code: body.capability_code,
        assigned: false,
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
