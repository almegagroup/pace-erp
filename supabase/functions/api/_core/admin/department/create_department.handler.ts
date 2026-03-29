/*
 * File-ID: 9.5
 * File-Path: supabase/functions/api/_core/admin/department/create_department.handler.ts
 * Gate: 9
 * Phase: 9
 * Domain: MASTER
 * Purpose: Create a company-bound department (Admin Universe only)
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

type CreateDepartmentInput = {
  department_name?: string;
  company_id?: string;
};

export async function createDepartmentHandler(
  req: Request,
  ctx: { context: ContextResolution; request_id: string },
): Promise<Response> {
  try {
    assertAdmin(ctx);

    const body = (await req.json()) as CreateDepartmentInput;
    const departmentName = body.department_name?.trim();
    const targetCompanyId = body.company_id?.trim() || ctx.context.companyId;

    if (!departmentName || departmentName.length < 3) {
      return errorResponse(
        "DEPARTMENT_NAME_REQUIRED",
        "department name required",
        ctx.request_id,
      );
    }

    const db = getServiceRoleClientWithContext(ctx.context);

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

    const { data, error } = await db
      .schema("erp_master").from("departments")
      .insert({
        department_name: departmentName,
        company_id: targetCompanyId,
        status: "ACTIVE",
      })
      .select("id, company_id, department_code, department_name, status")
      .single();

    if (error || !data) {
      return errorResponse(
        "DEPARTMENT_CREATE_FAILED",
        "department create failed",
        ctx.request_id,
      );
    }

    return okResponse(
      {
        department: {
          id: data.id,
          company_id: data.company_id,
          department_code: data.department_code,
          department_name: data.department_name,
          status: data.status,
        },
      },
      ctx.request_id,
    );
  } catch (err) {
    return errorResponse(
      (err as Error).message || "DEPARTMENT_CREATE_EXCEPTION",
      "department create exception",
      ctx.request_id,
    );
  }
}
