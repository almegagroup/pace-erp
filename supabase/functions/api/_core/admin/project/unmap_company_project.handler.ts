/*
 * File-ID: 9.4D
 * File-Path: supabase/functions/api/_core/admin/project/unmap_company_project.handler.ts
 * Gate: 9
 * Phase: 9
 * Domain: MASTER
 * Purpose: Unmap a company from a reusable project (Admin Universe only)
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

type UnmapCompanyProjectInput = {
  company_id?: string;
  project_id?: string;
};

export async function unmapCompanyProjectHandler(
  req: Request,
  ctx: { context: ContextResolution; request_id: string },
): Promise<Response> {
  try {
    assertAdmin(ctx);

    const body = (await req.json()) as UnmapCompanyProjectInput;
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

    const { data: existing } = await db
      .schema("erp_map")
      .from("company_projects")
      .select("company_id, project_id")
      .eq("company_id", companyId)
      .eq("project_id", projectId)
      .maybeSingle();

    if (!existing) {
      return okResponse(
        {
          status: "NO_MAPPING_FOUND",
          company_id: companyId,
          project_id: projectId,
        },
        ctx.request_id,
      );
    }

    const { data: projectModules, error: projectModulesError } = await db
      .schema("acl")
      .from("module_registry")
      .select("module_code")
      .eq("project_id", projectId);

    if (projectModulesError) {
      return errorResponse(
        "PROJECT_MODULE_LIST_FAILED",
        "project module list failed",
        ctx.request_id,
      );
    }

    const moduleCodes = (projectModules ?? [])
      .map((row) => row.module_code)
      .filter(Boolean);

    if (moduleCodes.length > 0) {
      const { error: moduleCleanupError } = await db
        .schema("acl")
        .from("company_module_map")
        .delete()
        .eq("company_id", companyId)
        .in("module_code", moduleCodes);

      if (moduleCleanupError) {
        return errorResponse(
          "PROJECT_MODULE_CLEANUP_FAILED",
          "project module cleanup failed",
          ctx.request_id,
        );
      }
    }

    const { error } = await db
      .schema("erp_map")
      .from("company_projects")
      .delete()
      .eq("company_id", companyId)
      .eq("project_id", projectId);

    if (error) {
      return errorResponse(
        "PROJECT_COMPANY_UNMAP_FAILED",
        "project company unmap failed",
        ctx.request_id,
      );
    }

    return okResponse(
      {
        status: "UNMAPPED",
        company_id: companyId,
        project_id: projectId,
      },
      ctx.request_id,
    );
  } catch (err) {
    return errorResponse(
      (err as Error).message || "PROJECT_COMPANY_UNMAP_EXCEPTION",
      "project company unmap exception",
      ctx.request_id,
    );
  }
}
