/*
 * File-ID: ID-9.7C
 * File-Path: supabase/functions/api/_core/admin/acl/assign_work_context_capability.handler.ts
 * Gate: 9
 * Phase: 9
 * Domain: ACL
 * Purpose: Bind a capability pack to a work context
 * Authority: Backend
 */

import { getServiceRoleClientWithContext } from "../../../_shared/serviceRoleClient.ts";
import type { ContextResolution } from "../../../_pipeline/context.ts";
import { okResponse, errorResponse } from "../../response.ts";
import { generateRequestId } from "../../../_lib/request_id.ts";

type Input = {
  work_context_id?: string;
  capability_code?: string;
};

type AdminContext = {
  context: ContextResolution;
};

function assertAdmin(ctx: AdminContext): void {
  if (ctx.context.status !== "RESOLVED" || ctx.context.isAdmin !== true) {
    throw new Error("ADMIN_ONLY");
  }
}

export async function assignWorkContextCapabilityHandler(
  req: Request,
  ctx: AdminContext,
): Promise<Response> {
  const requestId = generateRequestId();

  try {
    assertAdmin(ctx);

    const body = (await req.json()) as Input;
    const workContextId = body.work_context_id?.trim() ?? "";
    const capabilityCode = body.capability_code?.trim().toUpperCase() ?? "";

    if (!workContextId || !capabilityCode) {
      return errorResponse(
        "INVALID_INPUT",
        "work_context_id and capability_code required",
        requestId,
      );
    }

    const db = getServiceRoleClientWithContext(ctx.context);
    const { error } = await db
      .schema("acl")
      .from("work_context_capabilities")
      .upsert({
        work_context_id: workContextId,
        capability_code: capabilityCode,
      });

    if (error) {
      return errorResponse(
        "WORK_CONTEXT_CAPABILITY_ASSIGN_FAILED",
        error.message,
        requestId,
      );
    }

    return okResponse(
      {
        work_context_id: workContextId,
        capability_code: capabilityCode,
      },
      requestId,
    );
  } catch (err) {
    return errorResponse(
      (err as Error).message || "REQUEST_BLOCKED",
      "Unhandled error",
      requestId,
    );
  }
}
