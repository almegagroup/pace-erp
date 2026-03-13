/*
 * File-ID: 9.4
 * File-Path: supabase/functions/api/_core/admin/project/list_projects.handler.ts
 * Gate: 9
 * Phase: 9
 * Domain: MASTER
 * Purpose: List projects for current company (Admin Universe only)
 * Authority: Backend
 */

import type { ContextResolution } from "../../../_pipeline/context.ts";
import { getServiceRoleClientWithContext } from "../../../_shared/serviceRoleClient.ts";
import { okResponse, errorResponse } from "../../../_core/response.ts";

/* --------------------------------------------------
 * Admin guard
 * -------------------------------------------------- */
function assertAdmin(
  ctx: { context: ContextResolution }
): asserts ctx is {
  context: Extract<ContextResolution, { status: "RESOLVED" }> & {
    isAdmin: true;
  };
} {
  if (
    ctx.context.status !== "RESOLVED" ||
    ctx.context.isAdmin !== true
  ) {
    throw new Error("ADMIN_ONLY");
  }
}

/* --------------------------------------------------
 * Types
 * -------------------------------------------------- */
type ProjectRow = {
  id: string;
  project_code: string;
  project_name: string;
  status: string;
  created_at: string;
};

type CompanyProjectRow = {
  erp_master: {
    projects: ProjectRow;
  };
};

/* --------------------------------------------------
 * Handler
 * -------------------------------------------------- */
export async function listProjectsHandler(
  _req: Request,
  ctx: { context: ContextResolution; request_id: string }
): Promise<Response> {
  try {
    // 1️⃣ Admin-only
    assertAdmin(ctx);

    // 2️⃣ Query (company strictly from context)
    const db = getServiceRoleClientWithContext(ctx.context);

    const { data, error } = await db
      .schema("erp_map").from("company_projects")
      .select(`
        erp_master.projects (
          id,
          project_code,
          project_name,
          status,
          created_at
        )
      `)
      .eq("company_id", ctx.context.companyId);

    if (error) {
      return errorResponse(
        "PROJECT_LIST_FAILED",
        "project list failed",
        ctx.request_id
      );
    }

    const rows = (data ?? []) as unknown as CompanyProjectRow[];

   const projects = rows.map((row) => row.erp_master.projects);

    // 3️⃣ Success
    return okResponse(
      { projects },
      ctx.request_id
    );
  } catch (err) {
    return errorResponse(
      (err as Error).message || "PROJECT_LIST_EXCEPTION",
      "project list exception",
      ctx.request_id
    );
  }
}