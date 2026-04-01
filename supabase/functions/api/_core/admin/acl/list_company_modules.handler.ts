/*
 * File-ID: ID-9.9
 * File-Path: supabase/functions/api/_core/admin/acl/list_company_modules.handler.ts
 * gate_id: 9
 * Phase: 9
 * Domain: ACL
 * Purpose: List module enablement status for a company (admin governance).
 * Authority: Backend
 */

import { getServiceRoleClientWithContext } from "../../../_shared/serviceRoleClient.ts";
import type { ContextResolution } from "../../../_pipeline/context.ts";
import { okResponse, errorResponse } from "../../response.ts";
import { log } from "../../../_lib/logger.ts";
import { generateRequestId } from "../../../_lib/request_id.ts";

/* =========================================================
 * Types
 * ========================================================= */

type ListCompanyModulesInput = {
  company_id: string;
};

type CompanyRow = {
  id: string;
  company_code: string;
  company_name: string;
  status: string | null;
};

type AdminContext = {
  context: ContextResolution;
};

/* =========================================================
 * Guards
 * ========================================================= */

function assertAdmin(ctx: AdminContext): void {
  if (ctx.context.status !== "RESOLVED" || ctx.context.isAdmin !== true) {
    throw new Error("ADMIN_ONLY");
  }
}

/* =========================================================
 * Handler
 * ========================================================= */

export async function listCompanyModulesHandler(
  req: Request,
  ctx: AdminContext
): Promise<Response> {
  const requestId = generateRequestId();

  try {
    /* --------------------------------------------------
     * 1️⃣ Authority assertions
     * -------------------------------------------------- */
    
    assertAdmin(ctx);

    /* --------------------------------------------------
     * 2️⃣ Parse & validate input
     *     (GET preferred, but supports POST body too)
     * -------------------------------------------------- */
    let companyId: string | null = null;

    if (req.method === "GET") {
      const url = new URL(req.url);
      companyId = url.searchParams.get("company_id");
    } else {
      const body = (await req.json()) as Partial<ListCompanyModulesInput>;
      companyId = body.company_id ?? null;
    }

    if (!companyId) {
      log({
        level: "SECURITY",
        request_id: requestId,
        gate_id: "9.9",
        event: "LIST_COMPANY_MODULES_INVALID_INPUT",
        meta: { company_id: companyId },
      });

      return errorResponse(
        "INVALID_INPUT",
        "company_id required",
        requestId
      );
    }

    /* --------------------------------------------------
     * 3️⃣ Verify company
     * -------------------------------------------------- */
    const db = getServiceRoleClientWithContext(ctx.context);

    const { data: company } = await db
      .schema("erp_master")
      .from("companies")
      .select("id, company_code, company_name, status")
      .eq("id", companyId)
      .eq("company_kind", "BUSINESS")
      .maybeSingle();

    if (!company) {
      return errorResponse(
        "COMPANY_NOT_FOUND",
        "company not found",
        requestId
      );
    }

    /* --------------------------------------------------
     * 4️⃣ Resolve company-mapped projects
     * -------------------------------------------------- */
    const { data: companyProjects, error: companyProjectError } = await db
      .schema("erp_map")
      .from("company_projects")
      .select("project_id")
      .eq("company_id", companyId);

    if (companyProjectError) {
      log({
        level: "ERROR",
        request_id: requestId,
        gate_id: "9.9",
        event: "LIST_COMPANY_PROJECTS_DB_ERROR",
        meta: { error: companyProjectError.message },
      });

      return errorResponse(
        "COMPANY_PROJECT_LIST_FAILED",
        "project list failed",
        requestId
      );
    }

    const projectIds = (companyProjects ?? [])
      .map((row) => row.project_id)
      .filter(Boolean);

    if (projectIds.length === 0) {
      return okResponse(
        {
          company_id: companyId,
          company_code: (company as CompanyRow).company_code,
          company_name: (company as CompanyRow).company_name,
          company_status: (company as CompanyRow).status,
          modules: [],
        },
        requestId
      );
    }

    /* --------------------------------------------------
     * 5️⃣ Fetch modules only from mapped projects
     * -------------------------------------------------- */
    const [{ data: modules, error: moduleError }, { data: enabledRows, error: enabledError }, { data: projects, error: projectError }] =
      await Promise.all([
        db
          .schema("acl")
          .from("module_registry")
          .select("module_id, module_code, module_name, project_id, approval_required, approval_type, min_approvers, max_approvers, is_active")
          .in("project_id", projectIds)
          .order("module_code", { ascending: true }),
        db
          .schema("acl")
          .from("company_module_map")
          .select("module_code, enabled, created_at")
          .eq("company_id", companyId),
        db
          .schema("erp_master")
          .from("projects")
          .select("id, project_code, project_name, status")
          .in("id", projectIds),
      ]);

    if (moduleError || enabledError || projectError) {
      const errorMessage =
        moduleError?.message ?? enabledError?.message ?? projectError?.message ?? "unknown";
      log({
        level: "ERROR",
        request_id: requestId,
        gate_id: "9.9",
        event: "LIST_COMPANY_MODULES_DB_ERROR",
        meta: { error: errorMessage },
      });

      return errorResponse(
        "COMPANY_MODULE_LIST_FAILED",
        "List failed",
        requestId
      );
    }

    const enabledMap = new Map(
      (enabledRows ?? []).map((row) => [row.module_code, row]),
    );
    const projectMap = new Map(
      (projects ?? []).map((row) => [row.id, row]),
    );

    const data = (modules ?? []).map((row) => {
      const enabled = enabledMap.get(row.module_code) ?? null;
      const project = projectMap.get(row.project_id) ?? null;
      return {
        module_id: row.module_id,
        module_code: row.module_code,
        module_name: row.module_name,
        project_id: row.project_id,
        project_code: project?.project_code ?? "",
        project_name: project?.project_name ?? "",
        project_status: project?.status ?? null,
        approval_required: row.approval_required,
        approval_type: row.approval_type,
        min_approvers: row.min_approvers,
        max_approvers: row.max_approvers,
        module_active: row.is_active === true,
        enabled: enabled?.enabled === true,
        created_at: enabled?.created_at ?? null,
      };
    });

    /* --------------------------------------------------
     * 6️⃣ Success
     * -------------------------------------------------- */
    return okResponse(
      {
        company_id: companyId,
        company_code: (company as CompanyRow).company_code,
        company_name: (company as CompanyRow).company_name,
        company_status: (company as CompanyRow).status,
        modules: data ?? [],
      },
      requestId
    );
  } catch (err) {
    log({
      level: "ERROR",
      request_id: requestId,
      gate_id: "9.9",
      event: "LIST_COMPANY_MODULES_EXCEPTION",
      meta: { error: String(err) },
    });

    return errorResponse(
      (err as Error).message || "REQUEST_BLOCKED",
      "Unhandled error",
      requestId
    );
  }
}
