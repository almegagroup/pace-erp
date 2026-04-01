/*
 * File-ID: ID-9.9
 * File-Path: supabase/functions/api/_core/admin/acl/disable_company_module.handler.ts
 * Gate: 9
 * Phase: 9
 * Domain: ACL
 * Purpose: Disable a business module for a company (admin governance).
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

type DisableCompanyModuleInput = {
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

export async function disableCompanyModuleHandler(
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
    const body = (await req.json()) as Partial<DisableCompanyModuleInput>;

    if (!body.company_id || !body.module_code) {
      log({
        level: "SECURITY",
        request_id: requestId,
        gate_id: "9.9",
        event: "DISABLE_COMPANY_MODULE_INVALID_INPUT",
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
     * 3️⃣ Validate module exists
     * -------------------------------------------------- */
    const db = getServiceRoleClientWithContext(ctx.context);

    const { data: module } = await db
      .schema("acl")
      .from("module_registry")
      .select("module_code")
      .eq("module_code", moduleCode)
      .maybeSingle();

    if (!module) {
      return errorResponse(
        "MODULE_NOT_FOUND",
        "module not found",
        requestId
      );
    }

    /* --------------------------------------------------
     * 4️⃣ Upsert disabled=false? No — set enabled=false
     *     (keeps row as governance truth; no delete)
     * -------------------------------------------------- */

    const { error } = await db
      .schema("acl").from("company_module_map")
      .upsert(
        {
          company_id: companyId,
          module_code: moduleCode,
          enabled: false,
        },
        { onConflict: "company_id,module_code" }
      );

    if (error) {
      log({
        level: "ERROR",
        request_id: requestId,
        gate_id: "9.9",
        event: "DISABLE_COMPANY_MODULE_DB_ERROR",
        meta: { error: error.message },
      });

      return errorResponse(
        "COMPANY_MODULE_DISABLE_FAILED",
        "Disable failed",
        requestId
      );
    }

    /* --------------------------------------------------
     * 5️⃣ Success
     * -------------------------------------------------- */
    log({
      level: "SECURITY",
      request_id: requestId,
      gate_id: "9.9",
      event: "COMPANY_MODULE_DISABLED",
      meta: { company_id: companyId, module_code: moduleCode },
    });

    return okResponse(
      {
        company_id: companyId,
        module_code: moduleCode,
        enabled: false,
      },
      requestId
    );
  } catch (err) {
    log({
      level: "ERROR",
      request_id: requestId,
      gate_id: "9.9",
      event: "DISABLE_COMPANY_MODULE_EXCEPTION",
      meta: { error: String(err) },
    });

    return errorResponse(
      (err as Error).message || "REQUEST_BLOCKED",
      "Unhandled error",
      requestId
    );
  }
}
