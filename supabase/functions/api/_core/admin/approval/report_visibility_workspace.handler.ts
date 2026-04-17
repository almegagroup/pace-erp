import type { ContextResolution } from "../../../_pipeline/context.ts";
import { getServiceRoleClientWithContext } from "../../../_shared/serviceRoleClient.ts";
import { okResponse, errorResponse } from "../../response.ts";
import { log } from "../../../_lib/logger.ts";

type ReportVisibilityWorkspaceResource = {
  resource_code: string;
  title: string;
  route_path: string | null;
  menu_code: string | null;
  menu_active: boolean;
  module_code: string;
  module_name: string;
  project_code: string | null;
  project_name: string | null;
  available_actions: string[];
};

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

function deriveAvailableActions(resourceCode: string) {
  if (resourceCode.endsWith("_REGISTER")) return ["VIEW", "EXPORT"];
  if (resourceCode.includes("_SCOPE_HISTORY")) return ["VIEW"];
  if (resourceCode.includes("_MY_REQUESTS")) return ["VIEW"];
  return ["VIEW"];
}

function isWorkspaceResource(value: unknown): value is ReportVisibilityWorkspaceResource {
  return typeof value === "object" &&
    value !== null &&
    "resource_code" in value &&
    "module_code" in value &&
    "title" in value;
}

export async function listReportVisibilityWorkspaceHandler(
  _req: Request,
  ctx: { context: ContextResolution; request_id: string },
): Promise<Response> {
  try {
    assertAdmin(ctx);

    const db = getServiceRoleClientWithContext(ctx.context);

    const [
      { data: companyRows, error: companyError },
      { data: projectRows, error: projectError },
      { data: moduleRows, error: moduleError },
      { data: resourceMapRows, error: resourceMapError },
      { data: menuRows, error: menuError },
      { data: workContextRows, error: workContextError },
      { data: departmentRows, error: departmentError },
      { data: userRows, error: userError },
      { data: signupRows, error: signupError },
      { data: roleRows, error: roleError },
      { data: parentCompanyRows, error: parentCompanyError },
      { data: viewerRows, error: viewerError },
    ] = await Promise.all([
      db
        .schema("erp_master")
        .from("companies")
        .select("id, company_code, company_name, status, company_kind")
        .eq("company_kind", "BUSINESS")
        .eq("status", "ACTIVE")
        .order("company_name", { ascending: true }),
      db
        .schema("erp_master")
        .from("projects")
        .select("id, project_code, project_name, status")
        .eq("status", "ACTIVE")
        .order("project_name", { ascending: true }),
      db
        .schema("acl")
        .from("module_registry")
        .select("module_id, module_code, module_name, project_id, is_active")
        .eq("is_active", true)
        .order("module_code", { ascending: true }),
      db
        .schema("acl")
        .from("module_resource_map")
        .select("resource_code, module_code"),
      db
        .schema("erp_menu")
        .from("menu_master")
        .select("menu_code, title, resource_code, route_path, is_active, universe")
        .eq("menu_type", "PAGE")
        .eq("universe", "ACL"),
      db
        .schema("erp_acl")
        .from("work_contexts")
        .select("work_context_id, company_id, work_context_code, work_context_name, department_id, is_active")
        .eq("is_active", true)
        .order("work_context_code", { ascending: true }),
      db
        .schema("erp_master")
        .from("departments")
        .select("id, company_id, department_code, department_name, status")
        .eq("status", "ACTIVE"),
      db
        .schema("erp_core")
        .from("users")
        .select("auth_user_id, user_code, state")
        .in("state", ["ACTIVE", "DISABLED"]),
      db
        .schema("erp_core")
        .from("signup_requests")
        .select("auth_user_id, name"),
      db
        .schema("erp_acl")
        .from("user_roles")
        .select("auth_user_id, role_code, role_rank"),
      db
        .schema("erp_map")
        .from("user_parent_companies")
        .select("auth_user_id, company_id"),
      db
        .schema("acl")
        .from("report_viewer_map")
        .select("viewer_id, company_id, module_code, resource_code, action_code, scope_type, subject_work_context_id, subject_user_id, viewer_role_code, viewer_user_id, created_at")
        .order("company_id", { ascending: true })
        .order("module_code", { ascending: true })
        .order("resource_code", { ascending: true }),
    ]);

    const firstError =
      companyError ?? projectError ?? moduleError ?? resourceMapError ?? menuError ??
      workContextError ?? departmentError ?? userError ?? signupError ?? roleError ??
      parentCompanyError ?? viewerError;

    if (firstError) {
      log({
        level: "ERROR",
        request_id: ctx.request_id,
        gate_id: "9.11",
        event: "REPORT_VISIBILITY_WORKSPACE_LIST_FAILED",
        meta: { error: firstError.message },
      });

      return errorResponse(
        "REPORT_VISIBILITY_WORKSPACE_LIST_FAILED",
        firstError.message,
        ctx.request_id,
      );
    }

    const projectMap = new Map((projectRows ?? []).map((row) => [row.id, row]));
    const companyMap = new Map((companyRows ?? []).map((row) => [row.id, row]));
    const departmentMap = new Map((departmentRows ?? []).map((row) => [row.id, row]));
    const menuMap = new Map((menuRows ?? []).map((row) => [row.resource_code, row]));
    const roleMap = new Map((roleRows ?? []).map((row) => [row.auth_user_id, row]));
    const signupMap = new Map((signupRows ?? []).map((row) => [row.auth_user_id, row]));
    const parentCompanyMap = new Map((parentCompanyRows ?? []).map((row) => [row.auth_user_id, row.company_id]));

    const modules = (moduleRows ?? []).map((row) => {
      const project = projectMap.get(row.project_id);
      return {
        module_id: row.module_id,
        module_code: row.module_code,
        module_name: row.module_name,
        project_id: row.project_id,
        project_code: project?.project_code ?? null,
        project_name: project?.project_name ?? null,
        is_active: row.is_active === true,
      };
    });

    const moduleMap = new Map(modules.map((row) => [row.module_code, row]));

    const resources = (resourceMapRows ?? [])
      .map((row) => {
        const moduleRow = moduleMap.get(row.module_code);
        const menuRow = menuMap.get(row.resource_code);
        if (!moduleRow || !menuRow) return null;

        const availableActions = deriveAvailableActions(row.resource_code);
        if (availableActions.length === 0) return null;

        return {
          resource_code: row.resource_code,
          title: menuRow.title ?? row.resource_code,
          route_path: menuRow.route_path ?? null,
          menu_code: menuRow.menu_code ?? null,
          menu_active: menuRow.is_active === true,
          module_code: moduleRow.module_code,
          module_name: moduleRow.module_name,
          project_code: moduleRow.project_code,
          project_name: moduleRow.project_name,
          available_actions: availableActions,
        };
      })
      .filter(isWorkspaceResource)
      .sort((left, right) =>
        `${left.project_code ?? ""} ${left.module_code} ${left.title}`.localeCompare(
          `${right.project_code ?? ""} ${right.module_code} ${right.title}`,
          "en",
          { numeric: true, sensitivity: "base" },
        ))
      ;

    const workContexts = (workContextRows ?? []).map((row) => {
      const company = companyMap.get(row.company_id);
      const department = row.department_id ? departmentMap.get(row.department_id) : null;
      return {
        work_context_id: row.work_context_id,
        company_id: row.company_id,
        company_code: company?.company_code ?? null,
        company_name: company?.company_name ?? null,
        work_context_code: row.work_context_code,
        work_context_name: row.work_context_name,
        department_id: row.department_id ?? null,
        department_code: department?.department_code ?? null,
        department_name: department?.department_name ?? null,
      };
    });

    const users = (userRows ?? [])
      .filter((row) => roleMap.has(row.auth_user_id))
      .map((row) => {
        const role = roleMap.get(row.auth_user_id);
        const signup = signupMap.get(row.auth_user_id);
        const parentCompanyId = parentCompanyMap.get(row.auth_user_id) ?? null;
        const parentCompany = parentCompanyId ? companyMap.get(parentCompanyId) : null;
        return {
          auth_user_id: row.auth_user_id,
          user_code: row.user_code ?? null,
          name: signup?.name ?? null,
          role_code: role?.role_code ?? null,
          role_rank: role?.role_rank ?? null,
          parent_company_id: parentCompanyId,
          parent_company_code: parentCompany?.company_code ?? null,
          parent_company_name: parentCompany?.company_name ?? null,
        };
      })
      .sort((left, right) =>
        `${left.user_code ?? ""} ${left.name ?? ""}`.localeCompare(
          `${right.user_code ?? ""} ${right.name ?? ""}`,
          "en",
          { numeric: true, sensitivity: "base" },
        ))
      ;

    return okResponse(
      {
        companies: companyRows ?? [],
        projects: projectRows ?? [],
        modules,
        resources,
        work_contexts: workContexts,
        users,
        viewer_rules: viewerRows ?? [],
      },
      ctx.request_id,
    );
  } catch (err) {
    log({
      level: "ERROR",
      request_id: ctx.request_id,
      gate_id: "9.11",
      event: "REPORT_VISIBILITY_WORKSPACE_EXCEPTION",
      meta: { error: String(err) },
    });

    return errorResponse(
      (err as Error).message || "REPORT_VISIBILITY_WORKSPACE_EXCEPTION",
      "report visibility workspace exception",
      ctx.request_id,
    );
  }
}
