import { getServiceRoleClientWithContext } from "../../../_shared/serviceRoleClient.ts";
import type { ContextResolution } from "../../../_pipeline/context.ts";
import { okResponse, errorResponse } from "../../response.ts";

type HandlerContext = {
  context: ContextResolution;
  request_id: string;
};

type CompanyRow = {
  id: string;
  company_code: string;
  company_name: string;
  status: string | null;
};

type DepartmentRow = {
  id: string;
  company_id: string;
  department_code: string | null;
  department_name: string | null;
  status: string | null;
};

type WorkContextRow = {
  work_context_id: string;
  company_id: string;
  work_context_code: string | null;
  work_context_name: string | null;
  is_system: boolean | null;
  is_active: boolean | null;
};

type WorkContextCapabilityRow = {
  work_context_id: string;
  capability_code: string;
};

type WorkContextProjectRow = {
  work_context_id: string;
  project_id: string;
};

type CompanyProjectRow = {
  company_id: string;
  project_id: string;
};

type ProjectRow = {
  id: string;
  project_code: string | null;
  project_name: string | null;
};

type ModuleMapRow = {
  company_id: string;
  module_code: string;
  enabled: boolean | null;
};

type ModuleRegistryRow = {
  module_code: string;
  module_name: string | null;
  project_id: string | null;
};

type VersionRow = {
  company_id: string;
  version_number: number;
  description: string | null;
  is_active: boolean;
  created_at: string | null;
};

function assertAdmin(ctx: HandlerContext): void {
  if (ctx.context.status !== "RESOLVED" || ctx.context.isAdmin !== true) {
    throw new Error("ADMIN_ONLY");
  }
}

function compareText(left: unknown, right: unknown): number {
  return String(left ?? "").localeCompare(String(right ?? ""), "en", {
    numeric: true,
    sensitivity: "base",
  });
}

function toJoinedUnique(values: Array<string | null | undefined>): string | null {
  const joined = [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))].join(", ");
  return joined || null;
}

export async function listGovernanceSummaryReportHandler(
  req: Request,
  ctx: HandlerContext
): Promise<Response> {
  try {
    assertAdmin(ctx);

    const url = new URL(req.url);
    const companyIdFilter = url.searchParams.get("company_id")?.trim() ?? "";
    const db = getServiceRoleClientWithContext(ctx.context);

    const { data: companies, error: companyError } = await db
      .schema("erp_master")
      .from("companies")
      .select("id, company_code, company_name, status")
      .eq("company_kind", "BUSINESS")
      .order("company_code", { ascending: true });

    if (companyError) {
      return errorResponse(
        "GOVERNANCE_SUMMARY_COMPANY_READ_FAILED",
        companyError.message,
        ctx.request_id
      );
    }

    const scopedCompanies = ((companies ?? []) as CompanyRow[]).filter((company) =>
      companyIdFilter ? company.id === companyIdFilter : true
    );
    const companyIds = scopedCompanies.map((company) => company.id);

    const [
      { data: departments },
      { data: workContexts },
      { data: workContextCapabilities },
      { data: workContextProjects },
      { data: companyProjects },
      { data: projects },
      { data: companyModules },
      { data: moduleRegistry },
      { data: aclVersions },
    ] = await Promise.all([
      companyIds.length === 0
        ? Promise.resolve({ data: [] as DepartmentRow[] })
        : db
            .schema("erp_master")
            .from("departments")
            .select("id, company_id, department_code, department_name, status")
            .in("company_id", companyIds)
            .eq("status", "ACTIVE"),
      companyIds.length === 0
        ? Promise.resolve({ data: [] as WorkContextRow[] })
        : db
            .schema("erp_acl")
            .from("work_contexts")
            .select("work_context_id, company_id, work_context_code, work_context_name, is_system, is_active")
            .in("company_id", companyIds)
            .eq("is_active", true),
      companyIds.length === 0
        ? Promise.resolve({ data: [] as WorkContextCapabilityRow[] })
        : db
            .schema("acl")
            .from("work_context_capabilities")
            .select("work_context_id, capability_code"),
      companyIds.length === 0
        ? Promise.resolve({ data: [] as WorkContextProjectRow[] })
        : db
            .schema("erp_map")
            .from("work_context_projects")
            .select("work_context_id, project_id"),
      companyIds.length === 0
        ? Promise.resolve({ data: [] as CompanyProjectRow[] })
        : db
            .schema("erp_map")
            .from("company_projects")
            .select("company_id, project_id")
            .in("company_id", companyIds),
      db
        .schema("erp_master")
        .from("projects")
        .select("id, project_code, project_name")
        .eq("status", "ACTIVE"),
      companyIds.length === 0
        ? Promise.resolve({ data: [] as ModuleMapRow[] })
        : db
            .schema("acl")
            .from("company_module_map")
            .select("company_id, module_code, enabled")
            .in("company_id", companyIds)
            .eq("enabled", true),
      db
        .schema("acl")
        .from("module_registry")
        .select("module_code, module_name, project_id")
        .eq("is_active", true),
      companyIds.length === 0
        ? Promise.resolve({ data: [] as VersionRow[] })
        : db
            .schema("acl")
            .from("acl_versions")
            .select("company_id, version_number, description, is_active, created_at")
            .in("company_id", companyIds)
            .order("version_number", { ascending: false }),
    ]);

    const departmentMapByCompany = new Map<string, DepartmentRow[]>();
    const workContextMapByCompany = new Map<string, WorkContextRow[]>();
    const capabilityRowsByWorkContext = new Map<string, WorkContextCapabilityRow[]>();
    const projectRowsByWorkContext = new Map<string, WorkContextProjectRow[]>();
    const companyProjectRowsByCompany = new Map<string, CompanyProjectRow[]>();
    const moduleRowsByCompany = new Map<string, ModuleMapRow[]>();
    const versionRowsByCompany = new Map<string, VersionRow[]>();
    const projectMap = new Map(((projects ?? []) as ProjectRow[]).map((row) => [row.id, row]));
    const moduleRegistryMap = new Map(
      ((moduleRegistry ?? []) as ModuleRegistryRow[]).map((row) => [row.module_code, row])
    );
    for (const row of (departments ?? []) as DepartmentRow[]) {
      const current = departmentMapByCompany.get(row.company_id) ?? [];
      current.push(row);
      departmentMapByCompany.set(row.company_id, current);
    }
    for (const row of (workContexts ?? []) as WorkContextRow[]) {
      const current = workContextMapByCompany.get(row.company_id) ?? [];
      current.push(row);
      workContextMapByCompany.set(row.company_id, current);
    }
    for (const row of (workContextCapabilities ?? []) as WorkContextCapabilityRow[]) {
      const current = capabilityRowsByWorkContext.get(row.work_context_id) ?? [];
      current.push(row);
      capabilityRowsByWorkContext.set(row.work_context_id, current);
    }
    for (const row of (workContextProjects ?? []) as WorkContextProjectRow[]) {
      const current = projectRowsByWorkContext.get(row.work_context_id) ?? [];
      current.push(row);
      projectRowsByWorkContext.set(row.work_context_id, current);
    }
    for (const row of (companyProjects ?? []) as CompanyProjectRow[]) {
      const current = companyProjectRowsByCompany.get(row.company_id) ?? [];
      current.push(row);
      companyProjectRowsByCompany.set(row.company_id, current);
    }
    for (const row of (companyModules ?? []) as ModuleMapRow[]) {
      const current = moduleRowsByCompany.get(row.company_id) ?? [];
      current.push(row);
      moduleRowsByCompany.set(row.company_id, current);
    }
    for (const row of (aclVersions ?? []) as VersionRow[]) {
      const current = versionRowsByCompany.get(row.company_id) ?? [];
      current.push(row);
      versionRowsByCompany.set(row.company_id, current);
    }

    const rows = scopedCompanies.map((company) => {
      const companyDepartments = (departmentMapByCompany.get(company.id) ?? []).sort((left, right) =>
        compareText(left.department_code, right.department_code)
      );
      const companyWorkContexts = (workContextMapByCompany.get(company.id) ?? []).sort((left, right) =>
        compareText(left.work_context_code, right.work_context_code)
      );
      const companyProjectLinks = companyProjectRowsByCompany.get(company.id) ?? [];
      const enabledModules = (moduleRowsByCompany.get(company.id) ?? []).sort((left, right) =>
        compareText(left.module_code, right.module_code)
      );
      const versions = versionRowsByCompany.get(company.id) ?? [];
      const activeVersion = versions.find((row) => row.is_active) ?? null;

      const capabilityBindings = companyWorkContexts.flatMap((workContext) =>
        (capabilityRowsByWorkContext.get(workContext.work_context_id) ?? []).map(
          (binding) => `${workContext.work_context_code}:${binding.capability_code}`
        )
      );

      const inheritedProjectBindings = companyWorkContexts.flatMap((workContext) =>
        (projectRowsByWorkContext.get(workContext.work_context_id) ?? []).map((binding) => {
          const project = projectMap.get(binding.project_id);
          return `${workContext.work_context_code}:${project?.project_code ?? binding.project_id}`;
        })
      );

      const companyProjectCodes = companyProjectLinks.map(
        (binding) => projectMap.get(binding.project_id)?.project_code ?? binding.project_id
      );
      const companyProjectNames = companyProjectLinks.map(
        (binding) => projectMap.get(binding.project_id)?.project_name ?? binding.project_id
      );

      const enabledModuleCodes = enabledModules.map((row) => row.module_code);
      const enabledModuleNames = enabledModules.map(
        (row) => moduleRegistryMap.get(row.module_code)?.module_name ?? row.module_code
      );
      const enabledModuleProjects = enabledModules.map((row) => {
        const module = moduleRegistryMap.get(row.module_code);
        const project = module?.project_id ? projectMap.get(module.project_id) ?? null : null;
        return project?.project_code ?? null;
      });

      return {
        company_code: company.company_code,
        company_name: company.company_name,
        company_status: company.status ?? null,
        department_codes: toJoinedUnique(companyDepartments.map((row) => row.department_code)),
        department_names: toJoinedUnique(companyDepartments.map((row) => row.department_name)),
        work_context_codes: toJoinedUnique(companyWorkContexts.map((row) => row.work_context_code)),
        work_context_names: toJoinedUnique(companyWorkContexts.map((row) => row.work_context_name)),
        manual_work_context_codes: toJoinedUnique(
          companyWorkContexts.filter((row) => row.is_system !== true).map((row) => row.work_context_code)
        ),
        capability_bindings: toJoinedUnique(capabilityBindings),
        company_project_codes: toJoinedUnique(companyProjectCodes),
        company_project_names: toJoinedUnique(companyProjectNames),
        inherited_project_bindings: toJoinedUnique(inheritedProjectBindings),
        enabled_module_codes: toJoinedUnique(enabledModuleCodes),
        enabled_module_names: toJoinedUnique(enabledModuleNames),
        enabled_module_project_codes: toJoinedUnique(enabledModuleProjects),
        active_acl_version_number: activeVersion?.version_number ?? null,
        active_acl_version_description: activeVersion?.description ?? null,
        active_acl_version_created_at: activeVersion?.created_at ?? null,
        all_acl_versions: toJoinedUnique(
          versions.map((row) => `v${row.version_number}${row.is_active ? " ACTIVE" : ""}${row.description ? ` ${row.description}` : ""}`)
        ),
      };
    });

    return okResponse({ rows }, ctx.request_id);
  } catch (error) {
    return errorResponse(
      (error as Error).message || "GOVERNANCE_SUMMARY_REPORT_EXCEPTION",
      "governance summary report exception",
      ctx.request_id
    );
  }
}
