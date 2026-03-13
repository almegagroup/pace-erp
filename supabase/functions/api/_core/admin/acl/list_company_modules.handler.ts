/*
 * File-ID: ID-9.9
 * File-Path: supabase/functions/api/_core/admin/acl/list_company_modules.handler.ts
 * gate_id: 9
 * Phase: 9
 * Domain: ACL
 * Purpose: List module enablement status for a company (admin governance).
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

type ListCompanyModulesInput = {
  company_id: string;
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

export async function listCompanyModulesHandler(
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
     *     (GET preferred, but supports POST body too)
     * -------------------------------------------------- */
    let companyId: string | null = null;

    if (req.method === "GET") {
      const url = new URL(req.url);
      companyId = url.searchParams.get("company_id");
    } else {
      const body = (await req.json()) as Partial<ListCompanyModulesInput>;
      companyId = body.company_id ?? null;
    }

    if (!companyId) {
      log({
        level: "SECURITY",
        request_id: requestId,
        gate_id: "9.9",
        event: "LIST_COMPANY_MODULES_INVALID_INPUT",
        meta: { company_id: companyId },
      });

      return errorResponse(
        "INVALID_INPUT",
        "company_id required",
        requestId
      );
    }

    /* --------------------------------------------------
     * 3️⃣ Fetch module map
     * -------------------------------------------------- */
    const db = getServiceRoleClientWithContext(ctx.context);

    const { data, error } = await db
      .schema("acl").from("company_module_map")
      .select("module_code, enabled, created_at")
      .eq("company_id", companyId)
      .order("module_code", { ascending: true });

    if (error) {
      log({
        level: "ERROR",
        request_id: requestId,
        gate_id: "9.9",
        event: "LIST_COMPANY_MODULES_DB_ERROR",
        meta: { error: error.message },
      });

      return errorResponse(
        "COMPANY_MODULE_LIST_FAILED",
        "List failed",
        requestId
      );
    }

    /* --------------------------------------------------
     * 4️⃣ Success
     * -------------------------------------------------- */
    return okResponse(
      {
        company_id: companyId,
        modules: data ?? [],
      },
      requestId
    );
  } catch (err) {
    log({
      level: "ERROR",
      request_id: requestId,
      gate_id: "9.9",
      event: "LIST_COMPANY_MODULES_EXCEPTION",
      meta: { error: String(err) },
    });

    return errorResponse(
      (err as Error).message || "REQUEST_BLOCKED",
      "Unhandled error",
      requestId
    );
  }
}
