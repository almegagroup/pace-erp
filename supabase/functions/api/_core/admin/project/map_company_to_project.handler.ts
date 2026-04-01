/*
 * File-ID: 9.4C
 * File-Path: supabase/functions/api/_core/admin/project/map_company_to_project.handler.ts
 * Gate: 9
 * Phase: 9
 * Domain: MASTER
 * Purpose: Map a company to a reusable project (Admin Universe only)
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

type MapCompanyToProjectInput = {
  company_id?: string;
  project_id?: string;
};

export async function mapCompanyToProjectHandler(
  req: Request,
  ctx: { context: ContextResolution; request_id: string },
): Promise<Response> {
  try {
    assertAdmin(ctx);

    const body = (await req.json()) as MapCompanyToProjectInput;
    const companyId = body.company_id?.trim();
    const projectId = body.project_id?.trim();

    if (!companyId || !projectId) {
      return errorResponse(
        "INVALID_INPUT",
        "company_id and project_id required",
        ctx.request_id,
      );
    }

    const db = getServiceRoleClientWithContext(ctx.context);

    const { data: company } = await db
      .schema("erp_master")
      .from("companies")
      .select("id")
      .eq("id", companyId)
      .eq("company_kind", "BUSINESS")
      .maybeSingle();

    if (!company) {
      return errorResponse(
        "COMPANY_NOT_FOUND",
        "company not found",
        ctx.request_id,
      );
    }

    const { data: project } = await db
      .schema("erp_master")
      .from("projects")
      .select("id")
      .eq("id", projectId)
      .maybeSingle();

    if (!project) {
      return errorResponse(
        "PROJECT_NOT_FOUND",
        "project not found",
        ctx.request_id,
      );
    }

    const { data: existing } = await db
      .schema("erp_map")
      .from("company_projects")
      .select("company_id, project_id")
      .eq("company_id", companyId)
      .eq("project_id", projectId)
      .maybeSingle();

    if (existing) {
      return okResponse(
        {
          status: "ALREADY_MAPPED",
          company_id: companyId,
          project_id: projectId,
        },
        ctx.request_id,
      );
    }

    const { error } = await db
      .schema("erp_map")
      .from("company_projects")
      .insert({
        company_id: companyId,
        project_id: projectId,
      });

    if (error) {
      return errorResponse(
        "PROJECT_COMPANY_MAPPING_FAILED",
        "project company mapping failed",
        ctx.request_id,
      );
    }

    return okResponse(
      {
        company_id: companyId,
        project_id: projectId,
      },
      ctx.request_id,
    );
  } catch (err) {
    return errorResponse(
      (err as Error).message || "PROJECT_COMPANY_MAP_EXCEPTION",
      "project company map exception",
      ctx.request_id,
    );
  }
}
