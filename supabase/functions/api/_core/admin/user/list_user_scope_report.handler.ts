import { getServiceRoleClientWithContext } from "../../../_shared/serviceRoleClient.ts";
import type { ContextResolution } from "../../../_pipeline/context.ts";
import { okResponse, errorResponse } from "../../response.ts";

type HandlerContext = {
  context: ContextResolution;
  request_id: string;
};

type UserRow = {
  auth_user_id: string;
  user_code: string;
  state: string | null;
  created_at: string | null;
};

type RoleRow = {
  auth_user_id: string;
  role_code: string | null;
  role_rank: number | null;
};

type SignupRow = {
  auth_user_id: string;
  name: string | null;
  designation_hint: string | null;
  phone_number: string | null;
};

type IdRow = { auth_user_id: string; company_id?: string | null; project_id?: string | null; department_id?: string | null; work_context_id?: string | null; is_primary?: boolean | null };
type CompanyRow = { id: string; company_code: string | null; company_name: string | null };
type ProjectRow = { id: string; project_code: string | null; project_name: string | null; company_id: string | null };
type DepartmentRow = { id: string; department_code: string | null; department_name: string | null; company_id: string | null };
type WorkContextRow = { work_context_id: string; work_context_code: string | null; work_context_name: string | null; company_id: string | null; department_id: string | null; is_active: boolean | null };

function assertAdmin(ctx: HandlerContext): void {
  if (ctx.context.status !== "RESOLVED" || ctx.context.isAdmin !== true) {
    throw new Error("ADMIN_ONLY");
  }
}

function normalizeText(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

function compareText(left: unknown, right: unknown): number {
  return normalizeText(left).localeCompare(normalizeText(right), "en", {
    numeric: true,
    sensitivity: "base",
  });
}

function buildReportRow({
  user,
  role,
  signup,
  parentCompany,
  identityDepartment,
  assignmentType,
  assignmentCompany,
  project,
  workContext,
  workContextDepartment,
  isPrimaryWorkContext = false,
}: {
  user: UserRow;
  role: RoleRow | null;
  signup: SignupRow | null;
  parentCompany: CompanyRow | null;
  identityDepartment: DepartmentRow | null;
  assignmentType: string;
  assignmentCompany?: CompanyRow | null;
  project?: ProjectRow | null;
  workContext?: WorkContextRow | null;
  workContextDepartment?: DepartmentRow | null;
  isPrimaryWorkContext?: boolean;
}) {
  return {
    auth_user_id: user.auth_user_id,
    user_code: user.user_code,
    user_name: signup?.name ?? null,
    user_state: user.state ?? null,
    created_at: user.created_at ?? null,
    role_code: role?.role_code ?? null,
    role_rank: role?.role_rank ?? null,
    designation_hint: signup?.designation_hint ?? null,
    phone_number: signup?.phone_number ?? null,
    parent_company_code: parentCompany?.company_code ?? null,
    parent_company_name: parentCompany?.company_name ?? null,
    identity_department_code: identityDepartment?.department_code ?? null,
    identity_department_name: identityDepartment?.department_name ?? null,
    assignment_type: assignmentType,
    assignment_company_code: assignmentCompany?.company_code ?? null,
    assignment_company_name: assignmentCompany?.company_name ?? null,
    project_code: project?.project_code ?? null,
    project_name: project?.project_name ?? null,
    work_context_code: workContext?.work_context_code ?? null,
    work_context_name: workContext?.work_context_name ?? null,
    work_context_department_code: workContextDepartment?.department_code ?? null,
    work_context_department_name: workContextDepartment?.department_name ?? null,
    is_primary_work_context: isPrimaryWorkContext ? "YES" : "NO",
  };
}

export async function listUserScopeReportHandler(
  req: Request,
  ctx: HandlerContext,
): Promise<Response> {
  try {
    assertAdmin(ctx);
    const db = getServiceRoleClientWithContext(ctx.context);
    const url = new URL(req.url);
    const companyIdFilter = url.searchParams.get("company_id")?.trim() || "";

    const { data: users, error: usersError } = await db
      .schema("erp_core")
      .from("users")
      .select("auth_user_id, user_code, state, created_at")
      .in("state", ["ACTIVE", "DISABLED"])
      .order("created_at", { ascending: true });

    if (usersError) {
      return errorResponse("USER_SCOPE_REPORT_USERS_FAILED", "user report failed", ctx.request_id);
    }

    const safeUsers = (users ?? []) as UserRow[];
    const authUserIds = safeUsers.map((row) => row.auth_user_id);

    const [
      { data: roles },
      { data: signups },
      { data: parentCompanyRows },
      { data: workCompanyRows },
      { data: projectRows },
      { data: departmentRows },
      { data: workContextRows },
    ] = await Promise.all([
      authUserIds.length === 0
        ? Promise.resolve({ data: [] as RoleRow[] })
        : db.schema("erp_acl").from("user_roles").select("auth_user_id, role_code, role_rank").in("auth_user_id", authUserIds),
      authUserIds.length === 0
        ? Promise.resolve({ data: [] as SignupRow[] })
        : db.schema("erp_core").from("signup_requests").select("auth_user_id, name, designation_hint, phone_number").in("auth_user_id", authUserIds),
      authUserIds.length === 0
        ? Promise.resolve({ data: [] as IdRow[] })
        : db.schema("erp_map").from("user_parent_companies").select("auth_user_id, company_id").in("auth_user_id", authUserIds),
      authUserIds.length === 0
        ? Promise.resolve({ data: [] as IdRow[] })
        : db.schema("erp_map").from("user_companies").select("auth_user_id, company_id").in("auth_user_id", authUserIds),
      authUserIds.length === 0
        ? Promise.resolve({ data: [] as IdRow[] })
        : db.schema("erp_map").from("user_projects").select("auth_user_id, project_id").in("auth_user_id", authUserIds),
      authUserIds.length === 0
        ? Promise.resolve({ data: [] as IdRow[] })
        : db.schema("erp_map").from("user_departments").select("auth_user_id, department_id").in("auth_user_id", authUserIds),
      authUserIds.length === 0
        ? Promise.resolve({ data: [] as IdRow[] })
        : db.schema("erp_acl").from("user_work_contexts").select("auth_user_id, work_context_id, is_primary").in("auth_user_id", authUserIds),
    ]);

    const companyIds = new Set<string>();
    const projectIds = new Set<string>();
    const departmentIds = new Set<string>();
    const workContextIds = new Set<string>();

    for (const row of (parentCompanyRows ?? []) as IdRow[]) if (row.company_id) companyIds.add(row.company_id);
    for (const row of (workCompanyRows ?? []) as IdRow[]) if (row.company_id) companyIds.add(row.company_id);
    for (const row of (projectRows ?? []) as IdRow[]) if (row.project_id) projectIds.add(row.project_id);
    for (const row of (departmentRows ?? []) as IdRow[]) if (row.department_id) departmentIds.add(row.department_id);
    for (const row of (workContextRows ?? []) as IdRow[]) if (row.work_context_id) workContextIds.add(row.work_context_id);

    const [
      { data: companies },
      { data: projects },
      { data: departments },
      { data: workContexts },
    ] = await Promise.all([
      companyIds.size === 0
        ? Promise.resolve({ data: [] as CompanyRow[] })
        : db.schema("erp_master").from("companies").select("id, company_code, company_name").in("id", [...companyIds]),
      projectIds.size === 0
        ? Promise.resolve({ data: [] as ProjectRow[] })
        : db.schema("erp_master").from("projects").select("id, project_code, project_name, company_id").in("id", [...projectIds]),
      departmentIds.size === 0
        ? Promise.resolve({ data: [] as DepartmentRow[] })
        : db.schema("erp_master").from("departments").select("id, department_code, department_name, company_id").in("id", [...departmentIds]),
      workContextIds.size === 0
        ? Promise.resolve({ data: [] as WorkContextRow[] })
        : db.schema("erp_acl").from("work_contexts").select("work_context_id, work_context_code, work_context_name, company_id, department_id, is_active").in("work_context_id", [...workContextIds]),
    ]);

    const roleMap = new Map(((roles ?? []) as RoleRow[]).map((row) => [row.auth_user_id, row]));
    const signupMap = new Map(((signups ?? []) as SignupRow[]).map((row) => [row.auth_user_id, row]));
    const parentCompanyMap = new Map(((parentCompanyRows ?? []) as IdRow[]).map((row) => [row.auth_user_id, row.company_id ?? null]));
    const workCompanyMap = new Map<string, string[]>();
    const projectMapByUser = new Map<string, string[]>();
    const departmentMapByUser = new Map<string, string[]>();
    const workContextMapByUser = new Map<string, Array<{ work_context_id: string; is_primary: boolean }>>();

    for (const row of (workCompanyRows ?? []) as IdRow[]) {
      const current = workCompanyMap.get(row.auth_user_id) ?? [];
      if (row.company_id) current.push(row.company_id);
      workCompanyMap.set(row.auth_user_id, current);
    }
    for (const row of (projectRows ?? []) as IdRow[]) {
      const current = projectMapByUser.get(row.auth_user_id) ?? [];
      if (row.project_id) current.push(row.project_id);
      projectMapByUser.set(row.auth_user_id, current);
    }
    for (const row of (departmentRows ?? []) as IdRow[]) {
      const current = departmentMapByUser.get(row.auth_user_id) ?? [];
      if (row.department_id) current.push(row.department_id);
      departmentMapByUser.set(row.auth_user_id, current);
    }
    for (const row of (workContextRows ?? []) as IdRow[]) {
      const current = workContextMapByUser.get(row.auth_user_id) ?? [];
      if (row.work_context_id) {
        current.push({
          work_context_id: row.work_context_id,
          is_primary: row.is_primary === true,
        });
      }
      workContextMapByUser.set(row.auth_user_id, current);
    }

    const companyMap = new Map(((companies ?? []) as CompanyRow[]).map((row) => [row.id, row]));
    const projectMap = new Map(((projects ?? []) as ProjectRow[]).map((row) => [row.id, row]));
    const departmentMap = new Map(((departments ?? []) as DepartmentRow[]).map((row) => [row.id, row]));
    const workContextMap = new Map(((workContexts ?? []) as WorkContextRow[]).map((row) => [row.work_context_id, row]));

    const reportRows = [];

    for (const user of safeUsers) {
      const parentCompany = companyMap.get(parentCompanyMap.get(user.auth_user_id) ?? "") ?? null;
      const identityDepartmentIds = departmentMapByUser.get(user.auth_user_id) ?? [];
      const identityDepartment = identityDepartmentIds[0]
        ? departmentMap.get(identityDepartmentIds[0]) ?? null
        : null;
      const role = roleMap.get(user.auth_user_id) ?? null;
      const signup = signupMap.get(user.auth_user_id) ?? null;
      const workCompanies = workCompanyMap.get(user.auth_user_id) ?? [];
      const projectsForUser = projectMapByUser.get(user.auth_user_id) ?? [];
      const workContextsForUser = workContextMapByUser.get(user.auth_user_id) ?? [];

      const candidateCompanyIds = new Set<string>();
      if (parentCompany?.id) candidateCompanyIds.add(parentCompany.id);
      for (const companyId of workCompanies) candidateCompanyIds.add(companyId);
      for (const projectId of projectsForUser) {
        const project = projectMap.get(projectId);
        if (project?.company_id) candidateCompanyIds.add(project.company_id);
      }
      for (const workContextAssignment of workContextsForUser) {
        const workContext = workContextMap.get(workContextAssignment.work_context_id);
        if (workContext?.company_id) candidateCompanyIds.add(workContext.company_id);
      }

      if (companyIdFilter && !candidateCompanyIds.has(companyIdFilter)) {
        continue;
      }

      reportRows.push(
        buildReportRow({
          user,
          role,
          signup,
          parentCompany,
          identityDepartment,
          assignmentType: "BASE",
        }),
      );

      for (const companyId of workCompanies) {
        reportRows.push(
          buildReportRow({
            user,
            role,
            signup,
            parentCompany,
            identityDepartment,
            assignmentType: "WORK_COMPANY",
            assignmentCompany: companyMap.get(companyId) ?? null,
          }),
        );
      }

      for (const projectId of projectsForUser) {
        const project = projectMap.get(projectId) ?? null;
        reportRows.push(
          buildReportRow({
            user,
            role,
            signup,
            parentCompany,
            identityDepartment,
            assignmentType: "PROJECT",
            assignmentCompany: project?.company_id ? companyMap.get(project.company_id) ?? null : null,
            project,
          }),
        );
      }

      for (const workContextAssignment of workContextsForUser) {
        const workContext = workContextMap.get(workContextAssignment.work_context_id) ?? null;
        const workContextDepartment = workContext?.department_id
          ? departmentMap.get(workContext.department_id) ?? null
          : null;
        reportRows.push(
          buildReportRow({
            user,
            role,
            signup,
            parentCompany,
            identityDepartment,
            assignmentType: "WORK_CONTEXT",
            assignmentCompany: workContext?.company_id ? companyMap.get(workContext.company_id) ?? null : null,
            workContext,
            workContextDepartment,
            isPrimaryWorkContext: workContextAssignment.is_primary,
          }),
        );
      }
    }

    reportRows.sort((left, right) => {
      const companyCompare = compareText(left.parent_company_code, right.parent_company_code);
      if (companyCompare !== 0) return companyCompare;
      const userCompare = compareText(left.user_code, right.user_code);
      if (userCompare !== 0) return userCompare;
      const typeCompare = compareText(left.assignment_type, right.assignment_type);
      if (typeCompare !== 0) return typeCompare;
      return compareText(left.assignment_company_code || left.work_context_code || left.project_code, right.assignment_company_code || right.work_context_code || right.project_code);
    });

    return okResponse({ rows: reportRows }, ctx.request_id);
  } catch (error) {
    return errorResponse((error as Error).message || "USER_SCOPE_REPORT_EXCEPTION", "user scope report exception", ctx.request_id);
  }
}
