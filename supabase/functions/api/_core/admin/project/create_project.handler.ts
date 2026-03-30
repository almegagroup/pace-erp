/*
 * File-ID: 9.4
 * File-Path: supabase/functions/api/_core/admin/project/create_project.handler.ts
 * Gate: 9
 * Phase: 9
 * Domain: MASTER
 * Purpose: Create a global project and optionally map it to a target company (Admin Universe only)
 * Authority: Backend
 */

import type { ContextResolution } from "../../../_pipeline/context.ts";
import { getServiceRoleClientWithContext } from "../../../_shared/serviceRoleClient.ts";
import { okResponse, errorResponse } from "../../../_core/response.ts";
import { log } from "../../../_lib/logger.ts";

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

type CreateProjectInput = {
  project_name?: string;
  company_id?: string;
};

export async function createProjectHandler(
  req: Request,
  ctx: { context: ContextResolution; request_id: string },
): Promise<Response> {
  const routeKey = "POST:/api/admin/project";

  try {
    assertAdmin(ctx);

    const body = (await req.json()) as CreateProjectInput;
    const projectName = body.project_name?.trim();
    const targetCompanyId = body.company_id?.trim() || ctx.context.companyId;

    if (!projectName || projectName.length < 3) {
      return errorResponse(
        "PROJECT_NAME_REQUIRED",
        "project name required",
        ctx.request_id,
      );
    }

    const db = getServiceRoleClientWithContext(ctx.context);

    if (targetCompanyId) {
      const { data: company } = await db
        .schema("erp_master").from("companies")
        .select("id")
        .eq("id", targetCompanyId)
        .maybeSingle();

      if (!company) {
        return errorResponse(
          "COMPANY_NOT_FOUND",
          "company not found",
          ctx.request_id,
        );
      }
    }

    const { data, error } = await db
      .schema("erp_master").from("projects")
      .insert({
        project_name: projectName,
        status: "ACTIVE",
      })
      .select("id, project_code, project_name, status")
      .single();

    if (error || !data) {
      return errorResponse(
        "PROJECT_CREATE_FAILED",
        "project create failed",
        ctx.request_id,
        "NONE",
        403,
        {
          gateId: "9.4",
          routeKey,
          decisionTrace: "PROJECT_CREATE_FAILED",
        },
      );
    }

    if (targetCompanyId) {
      const { error: mapError } = await db
        .schema("erp_map").from("company_projects")
        .insert({
          company_id: targetCompanyId,
          project_id: data.id,
        });

      if (mapError) {
        return errorResponse(
          "PROJECT_COMPANY_MAPPING_FAILED",
          "project company mapping failed",
          ctx.request_id,
          "NONE",
          403,
          {
            gateId: "9.4",
            routeKey,
            decisionTrace: "PROJECT_COMPANY_MAPPING_FAILED",
          },
        );
      }
    }

    return okResponse(
      {
        project: {
          id: data.id,
          project_code: data.project_code,
          project_name: data.project_name,
          status: data.status,
          company_id: targetCompanyId ?? null,
        },
      },
      ctx.request_id,
    );
  } catch (err) {
    log({
      level: "ERROR",
      request_id: ctx.request_id,
      gate_id: "9.4",
      route_key: routeKey,
      event: "PROJECT_CREATE_EXCEPTION",
      meta: {
        error_code: (err as Error).message || "PROJECT_CREATE_EXCEPTION",
      },
    });

    return errorResponse(
      (err as Error).message || "PROJECT_CREATE_EXCEPTION",
      "project create exception",
      ctx.request_id,
      "NONE",
      403,
      {
        gateId: "9.4",
        routeKey,
        decisionTrace: (err as Error).message || "PROJECT_CREATE_EXCEPTION",
      },
    );
  }
}
