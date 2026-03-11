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

/* --------------------------------------------------
 * Admin guard (type-narrowing, canonical)
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
 * Input contract
 * -------------------------------------------------- */
type CreateDepartmentInput = {
  department_name?: string;
};

/* --------------------------------------------------
 * Handler
 * -------------------------------------------------- */
export async function createDepartmentHandler(
  req: Request,
  ctx: { context: ContextResolution; request_id: string }
): Promise<Response> {
  try {
    // 1️⃣ Admin-only
    assertAdmin(ctx);

    // 2️⃣ Parse input
    const body = (await req.json()) as CreateDepartmentInput;
    const departmentName = body.department_name?.trim();

    if (!departmentName || departmentName.length < 3) {
      return errorResponse(
        "DEPARTMENT_NAME_REQUIRED",
        "department name required",
        ctx.request_id
      );
    }

    // 3️⃣ Insert (company strictly from context)
    const db = getServiceRoleClientWithContext(ctx.context);

    const { data, error } = await db
      .from("erp_master.departments")
      .insert({
        department_name: departmentName,
        company_id: ctx.context.companyId,
        status: "ACTIVE",
      })
      .select("id, department_code, department_name, status")
      .single();

    if (error) {
      return errorResponse(
        "DEPARTMENT_CREATE_FAILED",
        "department create failed",
        ctx.request_id
      );
    }

    // 4️⃣ Success
    return okResponse(
      {
        department: {
          id: data.id,
          department_code: data.department_code,
          department_name: data.department_name,
          status: data.status,
        },
      },
      ctx.request_id
    );
  } catch (err) {
    return errorResponse(
      (err as Error).message || "DEPARTMENT_CREATE_EXCEPTION",
      "department create exception",
      ctx.request_id
    );
  }
}
