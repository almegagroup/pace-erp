/*
 * File-ID: 9.5B
 * File-Path: supabase/functions/api/_core/admin/department/list_departments.handler.ts
 * Gate: 9
 * Phase: 9
 * Domain: MASTER
 * Purpose: List departments and derived work-context readiness for a target company
 * Authority: Backend
 */

import type { ContextResolution } from "../../../_pipeline/context.ts";
import { getServiceRoleClientWithContext } from "../../../_shared/serviceRoleClient.ts";
import { okResponse, errorResponse } from "../../../_core/response.ts";

type HandlerContext = {
  context: ContextResolution;
  request_id: string;
};

function assertAdmin(
  ctx: HandlerContext,
): asserts ctx is {
  context: Extract<ContextResolution, { status: "RESOLVED" }> & { isAdmin: true };
  request_id: string;
} {
  if (ctx.context.status !== "RESOLVED" || ctx.context.isAdmin !== true) {
    throw new Error("ADMIN_ONLY");
  }
}

export async function listDepartmentsHandler(
  req: Request,
  ctx: HandlerContext,
): Promise<Response> {
  try {
    assertAdmin(ctx);

    const url = new URL(req.url);
    const companyId = url.searchParams.get("company_id")?.trim() || ctx.context.companyId;
    const db = getServiceRoleClientWithContext(ctx.context);

    if (!companyId) {
      return errorResponse(
        "COMPANY_ID_REQUIRED",
        "company id required",
        ctx.request_id,
      );
    }

    const { data, error } = await db
      .schema("erp_master").from("departments")
      .select("id, company_id, department_code, department_name, status, created_at")
      .eq("company_id", companyId)
      .order("department_name", { ascending: true });

    if (error) {
      return errorResponse(
        "DEPARTMENT_LIST_FAILED",
        "department list failed",
        ctx.request_id,
      );
    }

    const departmentRows = data ?? [];
    const departmentIds = departmentRows.map((row) => row.id);

    const { data: workContexts, error: workContextError } = departmentIds.length === 0
      ? { data: [], error: null }
      : await db
        .schema("erp_acl").from("work_contexts")
        .select(
          "work_context_id, department_id, work_context_code, work_context_name, is_active",
        )
        .eq("company_id", companyId)
        .in("department_id", departmentIds);

    if (workContextError) {
      return errorResponse(
        "DEPARTMENT_WORK_CONTEXT_LIST_FAILED",
        "department work context list failed",
        ctx.request_id,
      );
    }

    const workContextRows = workContexts ?? [];
    const workContextIds = workContextRows.map((row) => row.work_context_id);

    const [{ data: capabilityRows, error: capabilityError }, { data: userScopeRows, error: userScopeError }] =
      workContextIds.length === 0
        ? [
            { data: [], error: null },
            { data: [], error: null },
          ]
        : await Promise.all([
            db
              .schema("acl")
              .from("work_context_capabilities")
              .select("work_context_id, capability_code")
              .in("work_context_id", workContextIds),
            db
              .schema("erp_acl")
              .from("user_work_contexts")
              .select("work_context_id, auth_user_id")
              .in("work_context_id", workContextIds),
          ]);

    if (capabilityError) {
      return errorResponse(
        "DEPARTMENT_CAPABILITY_LIST_FAILED",
        "department capability list failed",
        ctx.request_id,
      );
    }

    if (userScopeError) {
      return errorResponse(
        "DEPARTMENT_USER_SCOPE_LIST_FAILED",
        "department user scope list failed",
        ctx.request_id,
      );
    }

    const workContextByDepartmentId = new Map(
      workContextRows.map((row) => [row.department_id, row]),
    );
    const capabilityCountByContextId = new Map<string, number>();
    const assignedUserCountByContextId = new Map<string, number>();

    for (const row of capabilityRows ?? []) {
      capabilityCountByContextId.set(
        row.work_context_id,
        (capabilityCountByContextId.get(row.work_context_id) ?? 0) + 1,
      );
    }

    for (const row of userScopeRows ?? []) {
      assignedUserCountByContextId.set(
        row.work_context_id,
        (assignedUserCountByContextId.get(row.work_context_id) ?? 0) + 1,
      );
    }

    const payload = departmentRows.map((department) => {
      const workContext = workContextByDepartmentId.get(department.id) ?? null;

      return {
        ...department,
        derived_work_context: workContext
          ? {
              work_context_id: workContext.work_context_id,
              work_context_code: workContext.work_context_code,
              work_context_name: workContext.work_context_name,
              is_active: workContext.is_active,
              capability_count:
                capabilityCountByContextId.get(workContext.work_context_id) ?? 0,
              assigned_user_count:
                assignedUserCountByContextId.get(workContext.work_context_id) ?? 0,
            }
          : null,
      };
    });

    return okResponse({ departments: payload }, ctx.request_id);
  } catch (err) {
    return errorResponse(
      (err as Error).message || "DEPARTMENT_LIST_EXCEPTION",
      "department list exception",
      ctx.request_id,
    );
  }
}
