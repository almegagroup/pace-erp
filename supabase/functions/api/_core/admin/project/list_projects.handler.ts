/*
 * File-ID: 9.4
 * File-Path: supabase/functions/api/_core/admin/project/list_projects.handler.ts
 * Gate: 9
 * Phase: 9
 * Domain: MASTER
 * Purpose: List global projects or company-mapped projects (Admin Universe only)
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
  company_id?: string | null;
};

type CompanyProjectRow = {
  project_id: string;
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

    if (!targetCompanyId) {
      const { data: projects, error: projectError } = await db
        .schema("erp_master").from("projects")
        .select("id, project_code, project_name, status, created_at")
        .order("project_name", { ascending: true });

      if (projectError) {
        return errorResponse(
          "PROJECT_LIST_FAILED",
          "project list failed",
          ctx.request_id,
        );
      }

      return okResponse({ projects: (projects ?? []) as ProjectRow[] }, ctx.request_id);
    }

    const { data: mappings, error: mappingError } = await db
      .schema("erp_map").from("company_projects")
      .select("project_id")
      .eq("company_id", targetCompanyId);

    if (mappingError) {
      return errorResponse(
        "PROJECT_LIST_FAILED",
        "project list failed",
        ctx.request_id,
      );
    }

    const projectIds = ((mappings ?? []) as CompanyProjectRow[])
      .map((row) => row.project_id)
      .filter(Boolean);

    if (projectIds.length === 0) {
      return okResponse({ projects: [] }, ctx.request_id);
    }

    const { data: projects, error: projectError } = await db
      .schema("erp_master").from("projects")
      .select("id, project_code, project_name, status, created_at")
      .in("id", projectIds)
      .order("project_name", { ascending: true });

    if (projectError) {
      return errorResponse(
        "PROJECT_LIST_FAILED",
        "project list failed",
        ctx.request_id,
      );
    }

    return okResponse({ projects: (projects ?? []) as ProjectRow[] }, ctx.request_id);
  } catch (err) {
    return errorResponse(
      (err as Error).message || "PROJECT_LIST_EXCEPTION",
      "project list exception",
      ctx.request_id,
    );
  }
}
