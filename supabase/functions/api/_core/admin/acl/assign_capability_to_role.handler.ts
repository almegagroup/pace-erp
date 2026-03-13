/*
 * File-ID: ID-9.7A
 * File-Path: supabase/functions/api/_core/admin/acl/assign_capability_to_role.handler.ts
 * gate_id: 9
 * Phase: 9
 * Domain: ACL
 * Purpose: Assign a capability pack to a role (admin governance).
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

type AssignCapabilityInput = {
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

export async function assignCapabilityToRoleHandler(
  req: Request,
  ctx: AdminContext
): Promise<Response> {
  const requestId = generateRequestId();

  try {
    /* 1️⃣ Admin guard */
    assertAdmin(ctx);

    /* 2️⃣ Parse + validate input */
    const body = (await req.json()) as Partial<AssignCapabilityInput>;

    if (!body.role_code || !body.capability_code) {
      return errorResponse(
        "INVALID_INPUT",
        "role_code and capability_code required",
        requestId
      );
    }

    const db = getServiceRoleClientWithContext(ctx.context);

    /* 3️⃣ Validate capability exists */
    const { data: capability } = await db
      .schema("acl").from("capabilities")
      .select("capability_code")
      .eq("capability_code", body.capability_code)
      .maybeSingle();

    if (!capability) {
      return errorResponse(
        "CAPABILITY_NOT_FOUND",
        "Capability does not exist",
        requestId
      );
    }

    /* 4️⃣ Assign capability to role (idempotent) */
    const { error } = await db
      .schema("acl").from("role_capabilities")
      .upsert({
        role_code: body.role_code,
        capability_code: body.capability_code,
      });

    if (error) {
      log({
        level: "ERROR",
        request_id: requestId,
        gate_id: "9.7A",
        event: "ASSIGN_CAPABILITY_DB_ERROR",
        meta: { error: error.message },
      });

      return errorResponse(
        "ROLE_CAPABILITY_ASSIGN_FAILED",
        "Assign failed",
        requestId
      );
    }

    /* 5️⃣ Success */
    return okResponse(
      {
        role_code: body.role_code,
        capability_code: body.capability_code,
        assigned: true,
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
