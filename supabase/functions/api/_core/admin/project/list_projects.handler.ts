/*
 * File-ID: 9.4
 * File-Path: supabase/functions/api/_core/admin/project/list_projects.handler.ts
 * Gate: 9
 * Phase: 9
 * Domain: MASTER
 * Purpose: List projects for a target company (Admin Universe only)
 * Authority: Backend
 */

import type { ContextResolution } from "../../../_pipeline/context.ts";
import { getServiceRoleClientWithContext } from "../../../_shared/serviceRoleClient.ts";
import { okResponse, errorResponse } from "../../../_core/response.ts";

function assertAdmin(
  ctx: { context: ContextResolution },
): asserts ctx is {
  context: Extract<ContextResolution, { status: "RESOLVED" }> & {
    isAdmin: true;
  };
} {
  if (ctx.context.status !== "RESOLVED" || ctx.context.isAdmin !== true) {
    throw new Error("ADMIN_ONLY");
  }
}

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

export async function listProjectsHandler(
  req: Request,
  ctx: { context: ContextResolution; request_id: string },
): Promise<Response> {
  try {
    assertAdmin(ctx);

    const db = getServiceRoleClientWithContext(ctx.context);
    const url = new URL(req.url);
    const targetCompanyId = url.searchParams.get("company_id")?.trim() || ctx.context.companyId;

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
      .eq("company_id", targetCompanyId);

    if (error) {
      return errorResponse(
        "PROJECT_LIST_FAILED",
        "project list failed",
        ctx.request_id,
      );
    }

    const rows = (data ?? []) as unknown as CompanyProjectRow[];
    const projects = rows.map((row) => row.erp_master.projects);

    return okResponse({ projects }, ctx.request_id);
  } catch (err) {
    return errorResponse(
      (err as Error).message || "PROJECT_LIST_EXCEPTION",
      "project list exception",
      ctx.request_id,
    );
  }
}
