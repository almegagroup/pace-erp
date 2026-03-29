/*
 * File-ID: ID-9.7C
 * File-Path: supabase/functions/api/_core/admin/acl/list_work_context_capabilities.handler.ts
 * Gate: 9
 * Phase: 9
 * Domain: ACL
 * Purpose: List capability packs bound to a work context
 * Authority: Backend
 */

import { getServiceRoleClientWithContext } from "../../../_shared/serviceRoleClient.ts";
import type { ContextResolution } from "../../../_pipeline/context.ts";
import { okResponse, errorResponse } from "../../response.ts";
import { generateRequestId } from "../../../_lib/request_id.ts";

type AdminContext = {
  context: ContextResolution;
};

function assertAdmin(ctx: AdminContext): void {
  if (ctx.context.status !== "RESOLVED" || ctx.context.isAdmin !== true) {
    throw new Error("ADMIN_ONLY");
  }
}

export async function listWorkContextCapabilitiesHandler(
  req: Request,
  ctx: AdminContext,
): Promise<Response> {
  const requestId = generateRequestId();

  try {
    assertAdmin(ctx);

    const url = new URL(req.url);
    const workContextId = url.searchParams.get("work_context_id")?.trim() ?? "";

    if (!workContextId) {
      return errorResponse(
        "INVALID_INPUT",
        "work_context_id is required",
        requestId,
      );
    }

    const db = getServiceRoleClientWithContext(ctx.context);
    const { data, error } = await db
      .schema("acl")
      .from("work_context_capabilities")
      .select(`
        capability_code,
        capability:capability_code!inner (
          capability_name,
          description,
          is_system
        )
      `)
      .eq("work_context_id", workContextId)
      .order("capability_code", { ascending: true });

    if (error) {
      return errorResponse(
        "WORK_CONTEXT_CAPABILITY_LIST_FAILED",
        error.message,
        requestId,
      );
    }

    return okResponse(
      {
        work_context_id: workContextId,
        capabilities: (data ?? []).map((row) => ({
          capability_code: row.capability_code,
          capability_name: row.capability?.capability_name ?? null,
          description: row.capability?.description ?? null,
          is_system: row.capability?.is_system ?? false,
        })),
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
