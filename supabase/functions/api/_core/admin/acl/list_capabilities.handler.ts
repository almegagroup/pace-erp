/*
 * File-ID: ID-9.7A
 * File-Path: supabase/functions/api/_core/admin/acl/list_capabilities.handler.ts
 * gate_id:9
 * Phase: 9
 * Domain: ACL
 * Purpose: List all capability packs for admin governance.
 * Authority: Backend
 */

import { getServiceRoleClientWithContext } from "../../../_shared/serviceRoleClient.ts";
import type { ContextResolution } from "../../../_pipeline/context.ts";
import { okResponse, errorResponse } from "../../response.ts";
import { log } from "../../../_lib/logger.ts";
import { generateRequestId } from "../../../_lib/request_id.ts";

/* =========================================================
 * Guards
 * ========================================================= */

function assertAdmin(ctx: { context: ContextResolution }): void {
  if (ctx.context.status !== "RESOLVED" || ctx.context.isAdmin !== true) {
    throw new Error("ADMIN_ONLY");
  }
}

/* =========================================================
 * Handler
 * ========================================================= */

export async function listCapabilitiesHandler(
  _req: Request,
  ctx: { context: ContextResolution }
): Promise<Response> {
  const requestId = generateRequestId();

  try {
    /* --------------------------------------------------
     * 1️⃣ Admin guard
     * -------------------------------------------------- */
    assertAdmin(ctx);

    /* --------------------------------------------------
     * 2️⃣ Fetch capability packs
     * -------------------------------------------------- */
    const db = getServiceRoleClientWithContext(ctx.context);

    const { data, error } = await db
      .schema("acl").from("capabilities")
      .select(
        `
        capability_code,
        capability_name,
        description,
        is_system,
        created_at
        `
      )
      .order("capability_code", { ascending: true });

    if (error) {
      log({
        level: "ERROR",
        request_id: requestId,
        gate_id:"9.7A",
        event: "LIST_CAPABILITIES_DB_ERROR",
        meta: { error: error.message },
      });

      return errorResponse(
        "CAPABILITY_LIST_FAILED",
        "Failed to list capability packs",
        requestId
      );
    }

    /* --------------------------------------------------
     * 3️⃣ Success
     * -------------------------------------------------- */
    return okResponse(
      {
        capabilities: data ?? [],
      },
      requestId
    );
  } catch (err) {
    log({
      level: "ERROR",
      request_id: requestId,
      gate_id:"9.7A",
      event: "LIST_CAPABILITIES_EXCEPTION",
      meta: { error: String(err) },
    });

    return errorResponse(
      (err as Error).message || "REQUEST_BLOCKED",
      "Unhandled error",
      requestId
    );
  }
}
