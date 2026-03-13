/*
 * File-ID: ID-9.9
 * File-Path: supabase/functions/api/_core/admin/acl/enable_company_module.handler.ts
 * Gate: 9
 * Phase: 9
 * Domain: ACL
 * Purpose: Enable a business module for a company (admin governance).
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

type EnableCompanyModuleInput = {
  company_id: string;
  module_code: string;
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

export async function enableCompanyModuleHandler(
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
    const body = (await req.json()) as Partial<EnableCompanyModuleInput>;

    if (!body.company_id || !body.module_code) {
      log({
        level: "SECURITY",
        request_id: requestId,
        gate_id: "9.9",
        event: "ENABLE_COMPANY_MODULE_INVALID_INPUT",
        meta: body,
      });

      return errorResponse(
        "INVALID_INPUT",
        "Invalid request",
        requestId
      );
    }

    const companyId = body.company_id;
    const moduleCode = body.module_code.trim();

    /* --------------------------------------------------
     * 3️⃣ Upsert enablement (idempotent)
     * -------------------------------------------------- */
    const db = getServiceRoleClientWithContext(ctx.context);

    const { error } = await db
      .schema("acl").from("company_module_map")
      .upsert(
        {
          company_id: companyId,
          module_code: moduleCode,
          enabled: true,
        },
        { onConflict: "company_id,module_code" }
      );

    if (error) {
      log({
        level: "ERROR",
        request_id: requestId,
        gate_id: "9.9",
        event: "ENABLE_COMPANY_MODULE_DB_ERROR",
        meta: { error: error.message },
      });

      return errorResponse(
        "COMPANY_MODULE_ENABLE_FAILED",
        "Enable failed",
        requestId
      );
    }

    /* --------------------------------------------------
     * 4️⃣ Success
     * -------------------------------------------------- */
    log({
      level: "SECURITY",
      request_id: requestId,
      gate_id: "9.9",
      event: "COMPANY_MODULE_ENABLED",
      meta: { company_id: companyId, module_code: moduleCode },
    });

    return okResponse(
      {
        company_id: companyId,
        module_code: moduleCode,
        enabled: true,
      },
      requestId
    );
  } catch (err) {
    log({
      level: "ERROR",
      request_id: requestId,
      gate_id: "9.9",
      event: "ENABLE_COMPANY_MODULE_EXCEPTION",
      meta: { error: String(err) },
    });

    return errorResponse(
      (err as Error).message || "REQUEST_BLOCKED",
      "Unhandled error",
      requestId
    );
  }
}
