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

function blocked(
  code: string,
  message: string,
  ctx: HandlerContext,
  routeKey = "POST:/api/admin/users/scope",
): Response {
  console.error("USER_SCOPE_SAVE_BLOCKED", {
    request_id: ctx.request_id,
    actor_auth_user_id: ctx.auth_user_id,
    code,
    message,
    route_key: routeKey,
  });
  return errorResponse(
    code,
    message,
    ctx.request_id,
    "NONE",
    403,
    {
      gateId: "SA.USER_SCOPE",
      routeKey,
      decisionTrace: code,
    },
  );
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
      return blocked(
        "USER_SCOPE_INPUT_INVALID",
        "auth_user_id and parent_company_id required",
        ctx,
      );
    }

    const db = getServiceRoleClientWithContext(ctx.context);

    const { data: activeBusinessCompanies, error: activeBusinessCompaniesError } = await db
      .schema("erp_master").from("companies")
      .select("id")
      .eq("status", "ACTIVE")
      .eq("company_kind", "BUSINESS");

    if (activeBusinessCompaniesError) {
      return blocked(
        `USER_SCOPE_COMPANY_LOOKUP_FAILED:${activeBusinessCompaniesError.message}`,
        "business company lookup failed",
        ctx,
      );
    }

    const activeBusinessCompanyIds = new Set(
      (activeBusinessCompanies ?? []).map((row) => row.id),
    );

    const { data: user, error: userLookupError } = await db
      .schema("erp_core").from("users")
      .select("auth_user_id")
      .eq("auth_user_id", targetAuthUserId)
      .maybeSingle();

    if (userLookupError) {
      return blocked(
        `USER_SCOPE_USER_LOOKUP_FAILED:${userLookupError.message}`,
        "user lookup failed",
        ctx,
      );
    }

    if (!user) {
      return blocked(
        "USER_SCOPE_USER_NOT_FOUND",
        "user not found",
        ctx,
      );
    }

    const { data: roleRow, error: roleLookupError } = await db
      .schema("erp_acl").from("user_roles")
      .select("role_code")
      .eq("auth_user_id", targetAuthUserId)
      .maybeSingle();

    if (roleLookupError) {
      return blocked(
        `USER_SCOPE_ROLE_LOOKUP_FAILED:${roleLookupError.message}`,
        "role lookup failed",
        ctx,
      );
    }

    if (!roleRow?.role_code) {
      return blocked(
        "USER_SCOPE_ACL_USER_REQUIRED",
        "scope mapping is allowed only for ACL users",
        ctx,
      );
    }

    const companyIdsToValidate = [...new Set([parentCompanyId, ...workCompanyIds])];
    const eligibleCompanyIds = [...companyIdsToValidate];
    const validCompanyCount = companyIdsToValidate.filter((companyId) =>
      activeBusinessCompanyIds.has(companyId)
    ).length;

    if (validCompanyCount !== companyIdsToValidate.length) {
      return blocked(
        "USER_SCOPE_COMPANY_INVALID",
        "one or more companies are invalid or non-business",
        ctx,
      );
    }

    const { data: projectCompanyLinks, error: projectCompanyLinksError } = projectIds.length === 0
      ? { data: [], error: null }
      : await db
        .schema("erp_map")
        .from("company_projects")
        .select("project_id, company_id")
        .in("project_id", projectIds)
        .in("company_id", eligibleCompanyIds);

    if (projectCompanyLinksError) {
      return blocked(
        `USER_SCOPE_PROJECT_LINK_LOOKUP_FAILED:${projectCompanyLinksError.message}`,
        "project company mapping lookup failed",
        ctx,
      );
    }

    const linkedProjectIds = [...new Set(
      (projectCompanyLinks ?? [])
        .filter((row) =>
          eligibleCompanyIds.includes(row.company_id) &&
          activeBusinessCompanyIds.has(row.company_id)
        )
        .map((row) => row.project_id)
    )];

    const { data: activeProjects, error: activeProjectsError } = linkedProjectIds.length === 0
      ? { data: [], error: null }
      : await db
        .schema("erp_master")
        .from("projects")
        .select("id, status")
        .in("id", linkedProjectIds)
        .eq("status", "ACTIVE");

    if (activeProjectsError) {
      return blocked(
        `USER_SCOPE_PROJECT_LOOKUP_FAILED:${activeProjectsError.message}`,
        "active project lookup failed",
        ctx,
      );
    }

    const activeProjectIds = new Set((activeProjects ?? []).map((row) => row.id));

    const linkedProjectIdSet = new Set(linkedProjectIds);
    const droppedProjects = projectIds
      .filter((projectId) => !(linkedProjectIdSet.has(projectId) && activeProjectIds.has(projectId)))
      .map((projectId) => ({
        project_id: projectId,
        reason: linkedProjectIdSet.has(projectId)
          ? "PROJECT_NOT_ACTIVE"
          : "PROJECT_NOT_MAPPED_TO_SELECTED_COMPANY",
      }));

    const persistedProjectIds = projectIds.filter((projectId) =>
      linkedProjectIdSet.has(projectId) && activeProjectIds.has(projectId)
    );

    const { data: validDepartments, error: validDepartmentsError } = departmentIds.length === 0
      ? { data: [], error: null }
      : await db
        .schema("erp_master").from("departments")
        .select("id, company_id")
        .in("id", departmentIds)
        .in("company_id", eligibleCompanyIds)
        .eq("status", "ACTIVE");

    if (validDepartmentsError) {
      return blocked(
        `USER_SCOPE_DEPARTMENT_LOOKUP_FAILED:${validDepartmentsError.message}`,
        "department lookup failed",
        ctx,
      );
    }

    const validDepartmentCount = (validDepartments ?? []).filter((department) =>
      eligibleCompanyIds.includes(department.company_id) &&
      activeBusinessCompanyIds.has(department.company_id)
    ).length;

    if (validDepartmentCount !== departmentIds.length) {
      return blocked(
        "USER_SCOPE_DEPARTMENT_INVALID",
        "one or more departments are invalid or not mapped to a business company",
        ctx,
      );
    }

    const { data: validWorkContexts, error: validWorkContextsError } = await db
      .schema("erp_acl").from("work_contexts")
      .select("work_context_id, company_id, work_context_code, department_id")
      .eq("is_active", true)
      .in("company_id", eligibleCompanyIds);

    if (validWorkContextsError) {
      return blocked(
        `USER_SCOPE_WORK_CONTEXT_LOOKUP_FAILED:${validWorkContextsError.message}`,
        "work context lookup failed",
        ctx,
      );
    }

    const validWorkContextMap = new Map(
      (validWorkContexts ?? []).map((row) => [row.work_context_id, row]),
    );

    if (
      explicitWorkContextIds.some((workContextId) => !validWorkContextMap.has(workContextId))
    ) {
      return blocked(
        "USER_SCOPE_WORK_CONTEXT_INVALID",
        "one or more work contexts are invalid or outside the selected work companies",
        ctx,
      );
    }

    if (departmentIds.length > 1) {
      return blocked(
        "USER_SCOPE_SINGLE_DEPARTMENT_REQUIRED",
        "only one department can be assigned to a user",
        ctx,
      );
    }

    const selectedDepartmentId = departmentIds[0] ?? null;

    const explicitWorkContextRows = explicitWorkContextIds
      .map((workContextId) => validWorkContextMap.get(workContextId) ?? null)
      .filter(Boolean);

    const filteredExplicitWorkContextRows = explicitWorkContextRows.filter((row) =>
      !row?.department_id || row.department_id === selectedDepartmentId
    );

    const droppedWorkContexts = explicitWorkContextRows
      .filter((row) => row?.department_id && row.department_id !== selectedDepartmentId)
      .map((row) => ({
        work_context_id: row?.work_context_id ?? null,
        reason: "WORK_CONTEXT_DEPARTMENT_MISMATCH",
        department_id: row?.department_id ?? null,
      }))
      .filter((row) => row.work_context_id);

    const departmentWorkContextIds = selectedDepartmentId
      ? [
          (validWorkContexts ?? []).find((row) => row.department_id === selectedDepartmentId)?.work_context_id ??
            null,
        ]
      : [];

    if (selectedDepartmentId && departmentWorkContextIds.some((workContextId) => !workContextId)) {
      return blocked(
        "USER_SCOPE_DEPARTMENT_WORK_CONTEXT_MISSING",
        "one or more departments are missing a governed department work context",
        ctx,
      );
    }

    const persistedDepartmentIds = selectedDepartmentId ? [selectedDepartmentId] : [];

    const autoDepartmentWorkContextIds = (departmentWorkContextIds.filter(Boolean)) as string[];

    const workContextIds = [...new Set([
      ...autoDepartmentWorkContextIds,
      ...filteredExplicitWorkContextRows
        .map((row) => row?.work_context_id ?? null)
        .filter(Boolean),
    ])];

    const primaryWorkContextId =
      filteredExplicitWorkContextRows.find((row) =>
        row?.company_id === parentCompanyId && row?.work_context_code === "GENERAL_OPS"
      )?.work_context_id ??
      filteredExplicitWorkContextRows.find((row) => row?.company_id === parentCompanyId)?.work_context_id ??
      filteredExplicitWorkContextRows[0]?.work_context_id ??
      departmentWorkContextIds.find(Boolean) ??
      null;

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
      return blocked(
        `USER_SCOPE_PARENT_SAVE_FAILED:${parentError.message}`,
        "parent company save failed",
        ctx,
      );
    }

    const { error: workDeleteError } = await db
      .schema("erp_map").from("user_companies")
      .delete()
      .eq("auth_user_id", targetAuthUserId);

    if (workDeleteError) {
      return blocked(
        `USER_SCOPE_WORK_DELETE_FAILED:${workDeleteError.message}`,
        "work company reset failed",
        ctx,
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
        return blocked(
          `USER_SCOPE_WORK_SAVE_FAILED:${workInsertError.message}`,
          "work company save failed",
          ctx,
        );
      }
    }

    const { error: projectDeleteError } = await db
      .schema("erp_map").from("user_projects")
      .delete()
      .eq("auth_user_id", targetAuthUserId);

    if (projectDeleteError) {
      return blocked(
        `USER_SCOPE_PROJECT_DELETE_FAILED:${projectDeleteError.message}`,
        "project scope reset failed",
        ctx,
      );
    }

    if (persistedProjectIds.length > 0) {
      const { error: projectInsertError } = await db
        .schema("erp_map").from("user_projects")
        .insert(
          persistedProjectIds.map((projectId) => ({
            auth_user_id: targetAuthUserId,
            project_id: projectId,
          })),
        );

      if (projectInsertError) {
        return blocked(
          `USER_SCOPE_PROJECT_SAVE_FAILED:${projectInsertError.message}`,
          "project scope save failed",
          ctx,
        );
      }
    }

    const { error: departmentDeleteError } = await db
      .schema("erp_map").from("user_departments")
      .delete()
      .eq("auth_user_id", targetAuthUserId);

    if (departmentDeleteError) {
      return blocked(
        `USER_SCOPE_DEPARTMENT_DELETE_FAILED:${departmentDeleteError.message}`,
        "department scope reset failed",
        ctx,
      );
    }

    if (persistedDepartmentIds.length > 0) {
      const { error: departmentInsertError } = await db
        .schema("erp_map").from("user_departments")
        .insert(
          persistedDepartmentIds.map((departmentId) => ({
            auth_user_id: targetAuthUserId,
            department_id: departmentId,
          })),
        );

      if (departmentInsertError) {
        return blocked(
          `USER_SCOPE_DEPARTMENT_SAVE_FAILED:${departmentInsertError.message}`,
          "department scope save failed",
          ctx,
        );
      }
    }

    const { error: workContextDeleteError } = await db
      .schema("erp_acl").from("user_work_contexts")
      .delete()
      .eq("auth_user_id", targetAuthUserId);

    if (workContextDeleteError) {
      return blocked(
        `USER_SCOPE_WORK_CONTEXT_DELETE_FAILED:${workContextDeleteError.message}`,
        "work context reset failed",
        ctx,
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
            is_primary: workContextId === primaryWorkContextId,
          })),
        );

      if (workContextInsertError) {
        return blocked(
          `USER_SCOPE_WORK_CONTEXT_SAVE_FAILED:${workContextInsertError.message}`,
          "work context save failed",
          ctx,
        );
      }
    }

    const adjustments = {
      dropped_project_ids: droppedProjects.map((row) => row.project_id),
      dropped_projects: droppedProjects,
      derived_department_ids: [],
      dropped_work_context_ids: droppedWorkContexts.map((row) => row.work_context_id),
      dropped_work_contexts: droppedWorkContexts,
      derived_work_context_ids: workContextIds.filter((workContextId) => !explicitWorkContextIds.includes(workContextId)),
    };

    if (projectIds.length > 0) {
      console.info("USER_SCOPE_PROJECT_VALIDATION", {
        request_id: ctx.request_id,
        target_auth_user_id: targetAuthUserId,
        eligible_company_ids: eligibleCompanyIds,
        requested_project_ids: projectIds,
        linked_project_ids: linkedProjectIds,
        active_project_ids: [...activeProjectIds],
        dropped_projects: droppedProjects,
      });
    }

    console.info("USER_SCOPE_SAVE_APPLIED", {
      request_id: ctx.request_id,
      target_auth_user_id: targetAuthUserId,
      actor_auth_user_id: ctx.auth_user_id,
      requested: {
        parent_company_id: parentCompanyId,
        work_company_ids: workCompanyIds,
        project_ids: projectIds,
        department_ids: departmentIds,
        work_context_ids: explicitWorkContextIds,
      },
      persisted: {
        parent_company_id: parentCompanyId,
        work_company_ids: workCompanyIds,
        project_ids: persistedProjectIds,
        department_ids: persistedDepartmentIds,
        work_context_ids: workContextIds,
      },
      adjustments,
    });

    return okResponse(
      {
        auth_user_id: targetAuthUserId,
        parent_company_id: parentCompanyId,
        work_company_ids: workCompanyIds,
        project_ids: persistedProjectIds,
        department_ids: persistedDepartmentIds,
        work_context_ids: workContextIds,
        adjustments,
        updated_by: ctx.auth_user_id,
      },
      ctx.request_id,
    );
  } catch (err) {
    const message = (err as Error).message || "USER_SCOPE_UPDATE_EXCEPTION";
    return blocked(
      message,
      "user scope update exception",
      ctx,
    );
  }
}
