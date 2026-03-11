/*
 * File-ID: ID-9.7A
 * File-Path: supabase/functions/api/_core/admin/acl/upsert_capability.handler.ts
 * gate_id: 9
 * Phase: 9
 * Domain: ACL
 * Purpose: Create or update a capability pack (admin governance).
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

type UpsertCapabilityInput = {
  capability_code: string;
  capability_name: string;
  description?: string;
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

export async function upsertCapabilityHandler(
  req: Request,
  ctx: AdminContext
): Promise<Response> {
  const requestId = generateRequestId();

  try {
    /* --------------------------------------------------
     * 1️⃣ Admin guard
     * -------------------------------------------------- */
    assertAdmin(ctx);

    /* --------------------------------------------------
     * 2️⃣ Parse & validate input
     * -------------------------------------------------- */
    const body = (await req.json()) as Partial<UpsertCapabilityInput>;

    if (!body.capability_code || !body.capability_name) {
      log({
        level: "SECURITY",
        request_id: requestId,
        gate_id: "9.7A",
        event: "UPSERT_CAPABILITY_INVALID_INPUT",
        meta: body,
      });

      return errorResponse(
        "INVALID_INPUT",
        "capability_code and capability_name required",
        requestId
      );
    }

    const db = getServiceRoleClientWithContext(ctx.context);

    /* --------------------------------------------------
     * 3️⃣ Check existing capability
     * -------------------------------------------------- */
    const { data: existing, error: fetchError } = await db
      .from("acl.capabilities")
      .select("capability_code, is_system")
      .eq("capability_code", body.capability_code)
      .maybeSingle();

    if (fetchError) {
      return errorResponse(
        "CAPABILITY_FETCH_FAILED",
        "Failed to fetch capability",
        requestId
      );
    }

    if (existing?.is_system === true) {
      return errorResponse(
        "SYSTEM_CAPABILITY_IMMUTABLE",
        "System capability cannot be modified",
        requestId
      );
    }

    /* --------------------------------------------------
     * 4️⃣ Upsert capability pack
     * -------------------------------------------------- */
    const { error } = await db
      .from("acl.capabilities")
      .upsert({
        capability_code: body.capability_code,
        capability_name: body.capability_name,
        description: body.description ?? null,
      });

    if (error) {
      log({
        level: "ERROR",
        request_id: requestId,
        gate_id: "9.7A",
        event: "UPSERT_CAPABILITY_DB_ERROR",
        meta: { error: error.message },
      });

      return errorResponse(
        "CAPABILITY_UPSERT_FAILED",
        "Upsert failed",
        requestId
      );
    }

    /* --------------------------------------------------
     * 5️⃣ Success
     * -------------------------------------------------- */
    log({
      level: "SECURITY",
      request_id: requestId,
      gate_id: "9.7A",
      event: "CAPABILITY_UPSERTED",
      meta: {
        capability_code: body.capability_code,
      },
    });

    return okResponse(
      {
        capability_code: body.capability_code,
        capability_name: body.capability_name,
      },
      requestId
    );
  } catch (err) {
    log({
      level: "ERROR",
      request_id: requestId,
      gate_id: "9.7A",
      event: "UPSERT_CAPABILITY_EXCEPTION",
      meta: { error: String(err) },
    });

    return errorResponse(
      (err as Error).message || "REQUEST_BLOCKED",
      "Unhandled error",
      requestId
    );
  }
}
