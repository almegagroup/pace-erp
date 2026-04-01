/*
 * File-ID: 9.4B
 * File-Path: supabase/functions/api/_core/admin/project/list_project_company_map.handler.ts
 * Gate: 9
 * Phase: 9
 * Domain: MASTER
 * Purpose: List company mapping state for a selected project (Admin Universe only)
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

type CompanyRow = {
  id: string;
  company_code: string;
  company_name: string;
  status: string | null;
  gst_number: string | null;
};

type MappingRow = {
  company_id: string;
  created_at: string;
};

export async function listProjectCompanyMapHandler(
  req: Request,
  ctx: { context: ContextResolution; request_id: string },
): Promise<Response> {
  try {
    assertAdmin(ctx);

    const url = new URL(req.url);
    const projectId = url.searchParams.get("project_id")?.trim();

    if (!projectId) {
      return errorResponse(
        "PROJECT_ID_REQUIRED",
        "project_id required",
        ctx.request_id,
      );
    }

    const db = getServiceRoleClientWithContext(ctx.context);

    const { data: project, error: projectError } = await db
      .schema("erp_master")
      .from("projects")
      .select("id, project_code, project_name, status, created_at")
      .eq("id", projectId)
      .maybeSingle();

    if (projectError || !project) {
      return errorResponse(
        "PROJECT_NOT_FOUND",
        "project not found",
        ctx.request_id,
      );
    }

    const { data: companies, error: companyError } = await db
      .schema("erp_master")
      .from("companies")
      .select("id, company_code, company_name, status, gst_number")
      .eq("company_kind", "BUSINESS")
      .order("company_name", { ascending: true });

    if (companyError) {
      return errorResponse(
        "PROJECT_COMPANY_LIST_FAILED",
        "company list failed",
        ctx.request_id,
      );
    }

    const { data: mappings, error: mappingError } = await db
      .schema("erp_map")
      .from("company_projects")
      .select("company_id, created_at")
      .eq("project_id", projectId);

    if (mappingError) {
      return errorResponse(
        "PROJECT_COMPANY_MAPPING_LIST_FAILED",
        "project mapping list failed",
        ctx.request_id,
      );
    }

    const mappingMap = new Map(
      ((mappings ?? []) as MappingRow[]).map((row) => [row.company_id, row]),
    );

    const payload = ((companies ?? []) as CompanyRow[]).map((company) => {
      const mapping = mappingMap.get(company.id) ?? null;

      return {
        ...company,
        is_mapped: Boolean(mapping),
        mapped_at: mapping?.created_at ?? null,
      };
    });

    return okResponse(
      {
        project,
        companies: payload,
        mapped_company_count: payload.filter((row) => row.is_mapped).length,
      },
      ctx.request_id,
    );
  } catch (err) {
    return errorResponse(
      (err as Error).message || "PROJECT_COMPANY_MAP_LIST_EXCEPTION",
      "project company map list exception",
      ctx.request_id,
    );
  }
}
