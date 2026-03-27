/*
 * File-ID: 9.6A
 * File-Path: supabase/functions/api/_core/admin/user/get_user_scope.handler.ts
 * Gate: 9
 * Phase: 9
 * Domain: ADMIN
 * Purpose: Read exact user scope truth for Parent Company, Work Company, Project, and Department governance.
 * Authority: Backend
 */

import { getServiceRoleClientWithContext } from "../../../_shared/serviceRoleClient.ts";
import type { ContextResolution } from "../../../_pipeline/context.ts";
import { okResponse, errorResponse } from "../../response.ts";

type HandlerContext = {
  context: ContextResolution;
  request_id: string;
};

function assertAdmin(ctx: HandlerContext): void {
  if (ctx.context.status !== "RESOLVED" || ctx.context.isAdmin !== true) {
    throw new Error("ADMIN_ONLY");
  }
}

export async function getUserScopeHandler(
  req: Request,
  ctx: HandlerContext,
): Promise<Response> {
  try {
    assertAdmin(ctx);

    const url = new URL(req.url);
    const authUserId = url.searchParams.get("auth_user_id")?.trim();

    if (!authUserId) {
      return errorResponse(
        "USER_SCOPE_AUTH_USER_ID_REQUIRED",
        "auth_user_id required",
        ctx.request_id,
      );
    }

    const db = getServiceRoleClientWithContext(ctx.context);

    const { data: user } = await db
      .schema("erp_core").from("users")
      .select("auth_user_id, user_code, state, created_at")
      .eq("auth_user_id", authUserId)
      .maybeSingle();

    if (!user) {
      return errorResponse(
        "USER_SCOPE_USER_NOT_FOUND",
        "user not found",
        ctx.request_id,
      );
    }

    const { data: roleRow } = await db
      .schema("erp_acl").from("user_roles")
      .select("role_code, role_rank")
      .eq("auth_user_id", authUserId)
      .maybeSingle();

    const { data: signupRow } = await db
      .schema("erp_core").from("signup_requests")
      .select("name, parent_company_name, designation_hint, phone_number")
      .eq("auth_user_id", authUserId)
      .maybeSingle();

    const { data: parentRows } = await db
      .schema("erp_map").from("user_parent_companies")
      .select("company_id")
      .eq("auth_user_id", authUserId);

    const parentCompanyId = parentRows?.[0]?.company_id ?? null;

    const { data: workCompanyRows } = await db
      .schema("erp_map").from("user_companies")
      .select("company_id")
      .eq("auth_user_id", authUserId);

    const workCompanyIds = [...new Set((workCompanyRows ?? []).map((row) => row.company_id))];

    const { data: projectRows } = await db
      .schema("erp_map").from("user_projects")
      .select("project_id")
      .eq("auth_user_id", authUserId);

    const projectIds = [...new Set((projectRows ?? []).map((row) => row.project_id))];

    const { data: departmentRows } = await db
      .schema("erp_map").from("user_departments")
      .select("department_id")
      .eq("auth_user_id", authUserId);

    const departmentIds = [...new Set((departmentRows ?? []).map((row) => row.department_id))];

    const companyIdsToResolve = [...new Set([
      ...(parentCompanyId ? [parentCompanyId] : []),
      ...workCompanyIds,
    ])];

    const { data: scopedCompanies } = companyIdsToResolve.length === 0
      ? { data: [] }
      : await db
        .schema("erp_master").from("companies")
        .select("id, company_code, company_name, status")
        .in("id", companyIdsToResolve);

    const { data: scopedProjects } = projectIds.length === 0
      ? { data: [] }
      : await db
        .schema("erp_master").from("projects")
        .select("id, project_code, project_name, status")
        .in("id", projectIds);

    const { data: scopedDepartments } = departmentIds.length === 0
      ? { data: [] }
      : await db
        .schema("erp_master").from("departments")
        .select("id, department_code, department_name, company_id, status")
        .in("id", departmentIds);

    const companyMap = new Map((scopedCompanies ?? []).map((row) => [row.id, row]));
    const projectMap = new Map((scopedProjects ?? []).map((row) => [row.id, row]));
    const departmentMap = new Map((scopedDepartments ?? []).map((row) => [row.id, row]));

    const { data: availableCompanies } = await db
      .schema("erp_master").from("companies")
      .select("id, company_code, company_name, status")
      .eq("status", "ACTIVE")
      .order("company_name", { ascending: true });

    const { data: availableProjects } = await db
      .schema("erp_master").from("projects")
      .select("id, project_code, project_name, status")
      .eq("status", "ACTIVE")
      .order("project_name", { ascending: true });

    const { data: availableDepartments } = await db
      .schema("erp_master").from("departments")
      .select("id, department_code, department_name, company_id, status")
      .eq("status", "ACTIVE")
      .order("department_name", { ascending: true });

    return okResponse(
      {
        user: {
          ...user,
          role_code: roleRow?.role_code ?? null,
          role_rank: roleRow?.role_rank ?? null,
          name: signupRow?.name ?? null,
          parent_company_hint: signupRow?.parent_company_name ?? null,
          designation_hint: signupRow?.designation_hint ?? null,
          phone_number: signupRow?.phone_number ?? null,
        },
        scope: {
          parent_company: parentCompanyId ? companyMap.get(parentCompanyId) ?? null : null,
          work_companies: workCompanyIds
            .map((companyId) => companyMap.get(companyId))
            .filter(Boolean),
          projects: projectIds
            .map((projectId) => projectMap.get(projectId))
            .filter(Boolean),
          departments: departmentIds
            .map((departmentId) => departmentMap.get(departmentId))
            .filter(Boolean),
        },
        options: {
          companies: availableCompanies ?? [],
          projects: availableProjects ?? [],
          departments: availableDepartments ?? [],
        },
      },
      ctx.request_id,
    );
  } catch (err) {
    return errorResponse(
      (err as Error).message || "USER_SCOPE_READ_EXCEPTION",
      "user scope read exception",
      ctx.request_id,
    );
  }
}
