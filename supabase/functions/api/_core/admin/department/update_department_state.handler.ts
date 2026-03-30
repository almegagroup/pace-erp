/*
 * File-ID: 9.5C
 * File-Path: supabase/functions/api/_core/admin/department/update_department_state.handler.ts
 * Gate: 9
 * Phase: 9
 * Domain: MASTER
 * Purpose: Control department lifecycle and keep derived work context in sync
 * Authority: Backend
 */

import type { ContextResolution } from "../../../_pipeline/context.ts";
import { getServiceRoleClientWithContext } from "../../../_shared/serviceRoleClient.ts";
import { okResponse, errorResponse } from "../../../_core/response.ts";
import { ensureDepartmentWorkContext } from "../../../_shared/work_context_governance.ts";

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

type UpdateDepartmentStateInput = {
  department_id?: string;
  next_status?: "ACTIVE" | "INACTIVE";
};

export async function updateDepartmentStateHandler(
  req: Request,
  ctx: { context: ContextResolution; request_id: string },
): Promise<Response> {
  try {
    assertAdmin(ctx);

    const body = (await req.json()) as UpdateDepartmentStateInput;
    const departmentId = body.department_id?.trim();
    const nextStatus = body.next_status;

    if (!departmentId || !nextStatus) {
      return errorResponse(
        "DEPARTMENT_STATE_INPUT_INVALID",
        "department state input invalid",
        ctx.request_id,
      );
    }

    const db = getServiceRoleClientWithContext(ctx.context);

    const { data: department, error: departmentError } = await db
      .schema("erp_master").from("departments")
      .select("id, company_id, department_code, department_name, status")
      .eq("id", departmentId)
      .maybeSingle();

    if (departmentError || !department) {
      return errorResponse(
        "DEPARTMENT_NOT_FOUND",
        "department not found",
        ctx.request_id,
      );
    }

    const { data: company, error: companyError } = await db
      .schema("erp_master").from("companies")
      .select("status")
      .eq("id", department.company_id)
      .maybeSingle();

    if (companyError || !company) {
      return errorResponse(
        "COMPANY_NOT_FOUND",
        "company not found",
        ctx.request_id,
      );
    }

    const { error: updateError } = await db
      .schema("erp_master").from("departments")
      .update({ status: nextStatus })
      .eq("id", departmentId);

    if (updateError) {
      return errorResponse(
        "DEPARTMENT_STATE_UPDATE_FAILED",
        "department state update failed",
        ctx.request_id,
      );
    }

    await ensureDepartmentWorkContext(db, {
      companyId: department.company_id,
      departmentId: department.id,
      departmentCode: department.department_code,
      departmentName: department.department_name,
      isActive: company.status === "ACTIVE" && nextStatus === "ACTIVE",
    });

    return okResponse(
      {
        department_id: department.id,
        previous_status: department.status,
        current_status: nextStatus,
      },
      ctx.request_id,
    );
  } catch (err) {
    return errorResponse(
      (err as Error).message || "DEPARTMENT_STATE_UPDATE_EXCEPTION",
      "department state update exception",
      ctx.request_id,
    );
  }
}
