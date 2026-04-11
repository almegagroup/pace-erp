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

function normalizeText(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
}

function compareText(left: unknown, right: unknown): number {
  return normalizeText(left).localeCompare(normalizeText(right), "en", {
    numeric: true,
    sensitivity: "base",
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function sortByCodeThenName(
  rows: Array<Record<string, unknown> | null | undefined> | null | undefined,
  codeKey: string,
  nameKey: string,
): Record<string, unknown>[] {
  return (rows ?? []).filter(isRecord).slice().sort((left, right) => {
    const codeCompare = compareText(left[codeKey], right[codeKey]);
    if (codeCompare !== 0) {
      return codeCompare;
    }

    const nameCompare = compareText(left[nameKey], right[nameKey]);
    if (nameCompare !== 0) {
      return nameCompare;
    }

    return 0;
  });
}

function enrichDepartmentRows(
  rows: Array<Record<string, unknown> | null | undefined> | null | undefined,
  companyLookup: Map<string, Record<string, unknown>>,
): Record<string, unknown>[] {
  return (rows ?? []).filter(isRecord).map((row) => {
    const companyId = normalizeText(row.company_id);
    const company = companyId ? companyLookup.get(companyId) ?? null : null;

    return {
      ...row,
      company_code: normalizeText(company?.company_code) || null,
      company_name: normalizeText(company?.company_name) || null,
    };
  });
}

function blocked(
  code: string,
  message: string,
  ctx: HandlerContext,
  routeKey = "GET:/api/admin/users/scope",
): Response {
  console.error("USER_SCOPE_READ_BLOCKED", {
    request_id: ctx.request_id,
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

export async function getUserScopeHandler(
  req: Request,
  ctx: HandlerContext,
): Promise<Response> {
  try {
    assertAdmin(ctx);

    const url = new URL(req.url);
    const authUserId = url.searchParams.get("auth_user_id")?.trim();

    if (!authUserId) {
      return blocked(
        "USER_SCOPE_AUTH_USER_ID_REQUIRED",
        "auth_user_id required",
        ctx,
      );
    }

    const db = getServiceRoleClientWithContext(ctx.context);

    const { data: user } = await db
      .schema("erp_core").from("users")
      .select("auth_user_id, user_code, state, created_at")
      .eq("auth_user_id", authUserId)
      .maybeSingle();

    if (!user) {
      return blocked(
        "USER_SCOPE_USER_NOT_FOUND",
        "user not found",
        ctx,
      );
    }

    const { data: roleRow } = await db
      .schema("erp_acl").from("user_roles")
      .select("role_code, role_rank")
      .eq("auth_user_id", authUserId)
      .maybeSingle();

    if (!roleRow?.role_code) {
      return blocked(
        "USER_SCOPE_ACL_USER_REQUIRED",
        "scope mapping is allowed only for ACL users",
        ctx,
      );
    }

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

    const { data: workContextRows } = await db
      .schema("erp_acl").from("user_work_contexts")
      .select(`
        work_context_id,
        work_context:work_context_id (
          department_id
        )
      `)
      .eq("auth_user_id", authUserId);

    const workContextIds = [...new Set((workContextRows ?? []).map((row) => row.work_context_id))];
    const departmentIdsFromWorkContexts = (workContextRows ?? []).flatMap((row) => {
      const relation = row.work_context;

      if (!relation) {
        return [];
      }

      if (Array.isArray(relation)) {
        return relation
          .map((item) => item.department_id ?? null)
          .filter(Boolean);
      }

      const singleRelation = relation as { department_id?: string | null };
      return singleRelation.department_id ? [singleRelation.department_id] : [];
    });

    const { data: departmentRows } = await db
      .schema("erp_map").from("user_departments")
      .select("department_id")
      .eq("auth_user_id", authUserId);

    const departmentIds = [...new Set([
      ...(departmentRows ?? []).map((row) => row.department_id),
      ...departmentIdsFromWorkContexts,
    ])];

    const companyIdsToResolve = [...new Set([
      ...(parentCompanyId ? [parentCompanyId] : []),
      ...workCompanyIds,
    ])];

    const { data: availableCompanies } = await db
      .schema("erp_master").from("companies")
      .select("id, company_code, company_name, state_name, full_address, pin_code, status")
      .eq("status", "ACTIVE")
      .eq("company_kind", "BUSINESS")
      .order("company_name", { ascending: true });

    const businessCompanyIds = (availableCompanies ?? []).map((company) => company.id);

    const { data: scopedCompanies } = companyIdsToResolve.length === 0
      ? { data: [] }
      : await db
        .schema("erp_master").from("companies")
        .select("id, company_code, company_name, state_name, full_address, pin_code, status")
        .in("id", companyIdsToResolve)
        .eq("status", "ACTIVE")
        .eq("company_kind", "BUSINESS");

    const eligibleScopeCompanyIds = [...new Set([
      ...(parentCompanyId ? [parentCompanyId] : []),
      ...workCompanyIds,
    ])];

    const { data: scopedProjectLinks } =
      projectIds.length === 0 || eligibleScopeCompanyIds.length === 0
        ? { data: [] }
        : await db
          .schema("erp_map")
          .from("company_projects")
          .select("project_id, company_id")
          .in("project_id", projectIds)
          .in("company_id", eligibleScopeCompanyIds);

    const scopedProjectCompanyMap = new Map<string, string>();
    for (const row of scopedProjectLinks ?? []) {
      if (!scopedProjectCompanyMap.has(row.project_id)) {
        scopedProjectCompanyMap.set(row.project_id, row.company_id);
      }
    }

    const { data: scopedProjects } = projectIds.length === 0
      ? { data: [] }
      : await db
        .schema("erp_master").from("projects")
        .select("id, project_code, project_name, status")
        .in("id", projectIds)
        .eq("status", "ACTIVE");

    const { data: scopedDepartments } = departmentIds.length === 0 || eligibleScopeCompanyIds.length === 0
      ? { data: [] }
      : await db
        .schema("erp_master").from("departments")
        .select("id, department_code, department_name, company_id, status")
        .in("id", departmentIds)
        .eq("status", "ACTIVE")
        .in("company_id", eligibleScopeCompanyIds);
    const { data: availableWorkContexts } = eligibleScopeCompanyIds.length === 0
      ? { data: [] }
      : await db
        .schema("erp_acl").from("work_contexts")
        .select("work_context_id, company_id, work_context_code, work_context_name, description, department_id, is_active")
        .eq("is_active", true)
        .in("company_id", eligibleScopeCompanyIds)
        .order("work_context_code", { ascending: true });

    const companyMap = new Map((scopedCompanies ?? []).map((row) => [row.id, row]));
    const projectMap = new Map((scopedProjects ?? []).map((row) => [row.id, row]));
    const departmentMap = new Map((scopedDepartments ?? []).map((row) => [row.id, row]));
    const workContextMap = new Map((availableWorkContexts ?? []).map((row) => [row.work_context_id, row]));
    const availableCompanyMap = new Map((availableCompanies ?? []).map((row) => [row.id, row]));

    const { data: availableProjectLinks } = eligibleScopeCompanyIds.length === 0
      ? { data: [] }
      : await db
        .schema("erp_map")
        .from("company_projects")
        .select("project_id, company_id")
        .in("company_id", eligibleScopeCompanyIds);

    const availableProjectIds = [...new Set((availableProjectLinks ?? []).map((row) => row.project_id))];
    const availableProjectCompanyMap = new Map<string, string>();
    for (const row of availableProjectLinks ?? []) {
      if (!availableProjectCompanyMap.has(row.project_id)) {
        availableProjectCompanyMap.set(row.project_id, row.company_id);
      }
    }

    const { data: availableProjects } = availableProjectIds.length === 0
      ? { data: [] }
      : await db
        .schema("erp_master").from("projects")
        .select("id, project_code, project_name, status")
        .eq("status", "ACTIVE")
        .in("id", availableProjectIds)
        .order("project_name", { ascending: true });

    const { data: availableDepartments } = eligibleScopeCompanyIds.length === 0
      ? { data: [] }
      : await db
      .schema("erp_master").from("departments")
      .select("id, department_code, department_name, company_id, status")
      .eq("status", "ACTIVE")
      .in("company_id", eligibleScopeCompanyIds)
      .order("department_name", { ascending: true });

    return okResponse(
      {
        user: {
          ...user,
          role_code: roleRow?.role_code ?? null,
          role_rank: roleRow?.role_rank ?? null,
          is_acl_user: Boolean(roleRow?.role_code),
          name: signupRow?.name ?? null,
          parent_company_hint: signupRow?.parent_company_name ?? null,
          designation_hint: signupRow?.designation_hint ?? null,
          phone_number: signupRow?.phone_number ?? null,
        },
        scope: {
          parent_company: parentCompanyId ? companyMap.get(parentCompanyId) ?? null : null,
          work_companies: sortByCodeThenName(
            workCompanyIds
            .map((companyId) => companyMap.get(companyId))
            .filter(Boolean),
            "company_code",
            "company_name",
          ),
          projects: sortByCodeThenName(
            projectIds
            .map((projectId) => {
              const project = projectMap.get(projectId);
              if (!project) {
                return null;
              }

              return {
                ...project,
                company_id: scopedProjectCompanyMap.get(projectId) ?? null,
              };
            })
            .filter(Boolean),
            "project_code",
            "project_name",
          ),
          departments: sortByCodeThenName(
            enrichDepartmentRows(
              departmentIds
                .map((departmentId) => departmentMap.get(departmentId))
                .filter(Boolean),
              companyMap,
            ),
            "department_code",
            "department_name",
          ),
          work_contexts: sortByCodeThenName(
            workContextIds
              .map((workContextId) => {
                const workContext = workContextMap.get(workContextId);
                if (!workContext) {
                  return null;
                }

                const company = companyMap.get(workContext.company_id) ?? null;
                const department = workContext.department_id
                  ? departmentMap.get(workContext.department_id) ?? null
                  : null;

                return {
                  id: workContext.work_context_id,
                  ...workContext,
                  company_code: company?.company_code ?? null,
                  company_name: company?.company_name ?? null,
                  department_code: department?.department_code ?? null,
                  department_name: department?.department_name ?? null,
                };
              })
              .filter(Boolean),
            "work_context_code",
            "work_context_name",
          ),
        },
        options: {
          companies: sortByCodeThenName(
            availableCompanies,
            "company_code",
            "company_name",
          ),
          projects: sortByCodeThenName(
            (availableProjects ?? []).map((project) => ({
              ...project,
              company_id: availableProjectCompanyMap.get(project.id) ?? null,
            })),
            "project_code",
            "project_name",
          ),
          departments: sortByCodeThenName(
            enrichDepartmentRows(
              availableDepartments,
              availableCompanyMap,
            ),
            "department_code",
            "department_name",
          ),
          work_contexts: sortByCodeThenName(
            (availableWorkContexts ?? []).map((workContext) => {
              const company = (availableCompanies ?? []).find(
                (row) => row.id === workContext.company_id,
              ) ?? null;
              const department = workContext.department_id
                ? (availableDepartments ?? []).find(
                  (row) => row.id === workContext.department_id,
                ) ?? null
                : null;

              return {
                id: workContext.work_context_id,
                ...workContext,
                company_code: company?.company_code ?? null,
                company_name: company?.company_name ?? null,
                department_code: department?.department_code ?? null,
                department_name: department?.department_name ?? null,
              };
            }),
            "work_context_code",
            "work_context_name",
          ),
        },
      },
      ctx.request_id,
    );
  } catch (err) {
    const message = (err as Error).message || "USER_SCOPE_READ_EXCEPTION";
    return blocked(
      message,
      "user scope read exception",
      ctx,
    );
  }
}
