/*
 * File-ID: 9.6B
 * File-Path: supabase/functions/api/_core/admin/user/update_user_scope.handler.ts
 * Gate: 9
 * Phase: 9
 * Domain: ADMIN
 * Purpose: Persist Parent Company, Work Company, Project, and Department scope for an ERP user.
 * Authority: Backend
 */

import { getServiceRoleClientWithContext } from "../../../_shared/serviceRoleClient.ts";
import type { ContextResolution } from "../../../_pipeline/context.ts";
import { okResponse, errorResponse } from "../../response.ts";

type HandlerContext = {
  context: ContextResolution;
  request_id: string;
  auth_user_id: string;
};

type UpdateUserScopeInput = {
  auth_user_id?: string;
  parent_company_id?: string;
  work_company_ids?: string[];
  project_ids?: string[];
  department_ids?: string[];
  work_context_ids?: string[];
};

function assertAdmin(ctx: HandlerContext): void {
  if (ctx.context.status !== "RESOLVED" || ctx.context.isAdmin !== true) {
    throw new Error("ADMIN_ONLY");
  }
}

function normalizeIdArray(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

export async function updateUserScopeHandler(
  req: Request,
  ctx: HandlerContext,
): Promise<Response> {
  try {
    assertAdmin(ctx);

    const body = (await req.json()) as UpdateUserScopeInput;

    const targetAuthUserId = body.auth_user_id?.trim();
    const parentCompanyId = body.parent_company_id?.trim();
    const workCompanyIds = normalizeIdArray(body.work_company_ids);
    const projectIds = normalizeIdArray(body.project_ids);
    const departmentIds = normalizeIdArray(body.department_ids);
    const explicitWorkContextIds = normalizeIdArray(body.work_context_ids);

    if (!targetAuthUserId || !parentCompanyId) {
      return errorResponse(
        "USER_SCOPE_INPUT_INVALID",
        "auth_user_id and parent_company_id required",
        ctx.request_id,
      );
    }

    const db = getServiceRoleClientWithContext(ctx.context);

    const { data: activeBusinessCompanies } = await db
      .schema("erp_master").from("companies")
      .select("id")
      .eq("status", "ACTIVE")
      .eq("company_kind", "BUSINESS");

    const activeBusinessCompanyIds = new Set(
      (activeBusinessCompanies ?? []).map((row) => row.id),
    );

    const { data: user } = await db
      .schema("erp_core").from("users")
      .select("auth_user_id")
      .eq("auth_user_id", targetAuthUserId)
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
      .select("role_code")
      .eq("auth_user_id", targetAuthUserId)
      .maybeSingle();

    if (!roleRow?.role_code) {
      return errorResponse(
        "USER_SCOPE_ACL_USER_REQUIRED",
        "scope mapping is allowed only for ACL users",
        ctx.request_id,
      );
    }

    const companyIdsToValidate = [...new Set([parentCompanyId, ...workCompanyIds])];
    const validCompanyCount = companyIdsToValidate.filter((companyId) =>
      activeBusinessCompanyIds.has(companyId)
    ).length;

    if (validCompanyCount !== companyIdsToValidate.length) {
      return errorResponse(
        "USER_SCOPE_COMPANY_INVALID",
        "one or more companies are invalid or non-business",
        ctx.request_id,
      );
    }

    const { data: validProjects } = projectIds.length === 0
      ? { data: [] }
      : await db
        .schema("erp_master").from("projects")
        .select("id, company_id")
        .in("id", projectIds)
        .eq("status", "ACTIVE");

    const validProjectCount = (validProjects ?? []).filter((project) =>
      activeBusinessCompanyIds.has(project.company_id)
    ).length;

    if (validProjectCount !== projectIds.length) {
      return errorResponse(
        "USER_SCOPE_PROJECT_INVALID",
        "one or more projects are invalid or not mapped to a business company",
        ctx.request_id,
      );
    }

    const { data: validDepartments } = departmentIds.length === 0
      ? { data: [] }
      : await db
        .schema("erp_master").from("departments")
        .select("id, company_id")
        .in("id", departmentIds)
        .eq("status", "ACTIVE");

    const validDepartmentCount = (validDepartments ?? []).filter((department) =>
      activeBusinessCompanyIds.has(department.company_id)
    ).length;

    if (validDepartmentCount !== departmentIds.length) {
      return errorResponse(
        "USER_SCOPE_DEPARTMENT_INVALID",
        "one or more departments are invalid or not mapped to a business company",
        ctx.request_id,
      );
    }

    const { data: validWorkContexts } = workCompanyIds.length === 0
      ? { data: [] }
      : await db
        .schema("erp_acl").from("work_contexts")
        .select("work_context_id, company_id, work_context_code")
        .eq("is_active", true)
        .in("company_id", workCompanyIds);

    const validWorkContextMap = new Map(
      (validWorkContexts ?? []).map((row) => [row.work_context_id, row]),
    );

    if (
      explicitWorkContextIds.some((workContextId) => !validWorkContextMap.has(workContextId))
    ) {
      return errorResponse(
        "USER_SCOPE_WORK_CONTEXT_INVALID",
        "one or more work contexts are invalid or outside the selected work companies",
        ctx.request_id,
      );
    }

    const defaultWorkContextIds = workCompanyIds
      .map((companyId) =>
        (validWorkContexts ?? []).find((row) =>
          row.company_id === companyId && row.work_context_code === "GENERAL_OPS"
        )?.work_context_id ?? null
      )
      .filter(Boolean) as string[];

    const workContextIds = [...new Set([
      ...defaultWorkContextIds,
      ...explicitWorkContextIds,
    ])];

    const parentPayload = {
      auth_user_id: targetAuthUserId,
      company_id: parentCompanyId,
    };

    const { error: parentError } = await db
      .schema("erp_map").from("user_parent_companies")
      .upsert(parentPayload, {
        onConflict: "auth_user_id",
      });

    if (parentError) {
      return errorResponse(
        "USER_SCOPE_PARENT_SAVE_FAILED",
        "parent company save failed",
        ctx.request_id,
      );
    }

    const { error: workDeleteError } = await db
      .schema("erp_map").from("user_companies")
      .delete()
      .eq("auth_user_id", targetAuthUserId);

    if (workDeleteError) {
      return errorResponse(
        "USER_SCOPE_WORK_DELETE_FAILED",
        "work company reset failed",
        ctx.request_id,
      );
    }

    if (workCompanyIds.length > 0) {
      const { error: workInsertError } = await db
        .schema("erp_map").from("user_companies")
        .insert(
          workCompanyIds.map((companyId) => ({
            auth_user_id: targetAuthUserId,
            company_id: companyId,
            is_primary: false,
          })),
        );

      if (workInsertError) {
        return errorResponse(
          "USER_SCOPE_WORK_SAVE_FAILED",
          "work company save failed",
          ctx.request_id,
        );
      }
    }

    const { error: projectDeleteError } = await db
      .schema("erp_map").from("user_projects")
      .delete()
      .eq("auth_user_id", targetAuthUserId);

    if (projectDeleteError) {
      return errorResponse(
        "USER_SCOPE_PROJECT_DELETE_FAILED",
        "project scope reset failed",
        ctx.request_id,
      );
    }

    if (projectIds.length > 0) {
      const { error: projectInsertError } = await db
        .schema("erp_map").from("user_projects")
        .insert(
          projectIds.map((projectId) => ({
            auth_user_id: targetAuthUserId,
            project_id: projectId,
          })),
        );

      if (projectInsertError) {
        return errorResponse(
          "USER_SCOPE_PROJECT_SAVE_FAILED",
          "project scope save failed",
          ctx.request_id,
        );
      }
    }

    const { error: departmentDeleteError } = await db
      .schema("erp_map").from("user_departments")
      .delete()
      .eq("auth_user_id", targetAuthUserId);

    if (departmentDeleteError) {
      return errorResponse(
        "USER_SCOPE_DEPARTMENT_DELETE_FAILED",
        "department scope reset failed",
        ctx.request_id,
      );
    }

    if (departmentIds.length > 0) {
      const { error: departmentInsertError } = await db
        .schema("erp_map").from("user_departments")
        .insert(
          departmentIds.map((departmentId) => ({
            auth_user_id: targetAuthUserId,
            department_id: departmentId,
          })),
        );

      if (departmentInsertError) {
        return errorResponse(
          "USER_SCOPE_DEPARTMENT_SAVE_FAILED",
          "department scope save failed",
          ctx.request_id,
        );
      }
    }

    const { error: workContextDeleteError } = await db
      .schema("erp_acl").from("user_work_contexts")
      .delete()
      .eq("auth_user_id", targetAuthUserId);

    if (workContextDeleteError) {
      return errorResponse(
        "USER_SCOPE_WORK_CONTEXT_DELETE_FAILED",
        "work context reset failed",
        ctx.request_id,
      );
    }

    if (workContextIds.length > 0) {
      const { error: workContextInsertError } = await db
        .schema("erp_acl")
        .from("user_work_contexts")
        .insert(
          workContextIds.map((workContextId) => ({
            auth_user_id: targetAuthUserId,
            company_id: validWorkContextMap.get(workContextId)?.company_id ?? null,
            work_context_id: workContextId,
            is_primary: defaultWorkContextIds.includes(workContextId),
          })),
        );

      if (workContextInsertError) {
        return errorResponse(
          "USER_SCOPE_WORK_CONTEXT_SAVE_FAILED",
          "work context save failed",
          ctx.request_id,
        );
      }
    }

    return okResponse(
      {
        auth_user_id: targetAuthUserId,
        parent_company_id: parentCompanyId,
        work_company_ids: workCompanyIds,
        project_ids: projectIds,
        department_ids: departmentIds,
        work_context_ids: workContextIds,
        updated_by: ctx.auth_user_id,
      },
      ctx.request_id,
    );
  } catch (err) {
    return errorResponse(
      (err as Error).message || "USER_SCOPE_UPDATE_EXCEPTION",
      "user scope update exception",
      ctx.request_id,
    );
  }
}
