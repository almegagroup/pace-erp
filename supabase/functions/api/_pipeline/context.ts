/*
 * File-ID: 5.6
 * File-Path: supabase/functions/api/_pipeline/context.ts
 * Gate: 5
 * Phase: 5
 * Domain: SECURITY
 * Purpose: Deterministic backend-only runtime context resolution
 * Authority: Backend
 */

import { serviceRoleClient } from "../_shared/serviceRoleClient.ts";
import { isSuperAdmin, isGlobalAdmin } from "../_shared/role_ladder.ts";
import { hasEffectiveProjectAccess } from "../_shared/effective_project_access.ts";

export type ContextResolution =
  | {
      status: "UNRESOLVED";
      source: "BACKEND";
      errorCode: "CONTEXT_UNRESOLVED";
    }
  | {
      status: "RESOLVED";
      source: "BACKEND";
      companyId?: string;
      workContextId?: string;
      workContextCode?: string;
      projectId?: string;
      departmentId?: string;
      roleCode: string;
      isAdmin: boolean;
    };

export type PipelineSession = {
  authUserId: string;
  roleCode: string;
  selectedCompanyId?: string | null;
  selectedWorkContextId?: string | null;
};

function sanitizeContextInput(): void {
  return;
}

function isAdminUniverse(session: PipelineSession): boolean {
  return isSuperAdmin(session.roleCode) || isGlobalAdmin(session.roleCode);
}

function unresolved(): ContextResolution {
  return {
    status: "UNRESOLVED",
    source: "BACKEND",
    errorCode: "CONTEXT_UNRESOLVED",
  };
}

async function resolveCompanyId(
  authUserId: string,
  selectedCompanyId: string | null | undefined,
): Promise<string | null> {
  let companyId =
    typeof selectedCompanyId === "string" && selectedCompanyId.trim().length > 0
      ? selectedCompanyId.trim()
      : null;

  if (companyId) {
    const { data: membership, error: membershipError } = await serviceRoleClient
      .schema("erp_map")
      .from("user_companies")
      .select("company_id")
      .eq("auth_user_id", authUserId)
      .eq("company_id", companyId)
      .maybeSingle();

    if (membershipError) {
      throw new Error("CONTEXT_UNRESOLVED");
    }

    if (!membership) {
      companyId = null;
    }
  }

  if (!companyId) {
    const { data: fallbackCompany, error: fallbackError } = await serviceRoleClient
      .schema("erp_map")
      .from("user_companies")
      .select("company_id, is_primary")
      .eq("auth_user_id", authUserId)
      .order("is_primary", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (fallbackError) {
      throw new Error("CONTEXT_UNRESOLVED");
    }

    companyId = fallbackCompany?.company_id ?? null;
  }

  return companyId;
}

async function resolveContextFromDb(
  req: Request,
  session: PipelineSession,
): Promise<ContextResolution> {
  const authUserId = session.authUserId;
  const companyId = await resolveCompanyId(authUserId, session.selectedCompanyId);

  if (!companyId) {
    return unresolved();
  }

  const { data: workContextRows, error: workContextError } = await serviceRoleClient
    .schema("erp_acl")
    .from("user_work_contexts")
    .select(`
      is_primary,
      work_context:work_context_id!inner (
        work_context_id,
        company_id,
        work_context_code,
        department_id,
        is_active
      )
    `)
    .eq("auth_user_id", authUserId)
    .eq("company_id", companyId)
    .order("is_primary", { ascending: false });

  if (workContextError) {
    return unresolved();
  }

  const flattenWorkContext = (
    value: unknown,
  ): {
    work_context_id: string;
    company_id: string;
    work_context_code: string;
    department_id: string | null;
    is_active: boolean;
  } | null => {
    if (!value) {
      return null;
    }

    const row = Array.isArray(value) ? value[0] : value;
    if (!row || typeof row !== "object") {
      return null;
    }

    return row as {
      work_context_id: string;
      company_id: string;
      work_context_code: string;
      department_id: string | null;
      is_active: boolean;
    };
  };

  const availableWorkContexts = (workContextRows ?? [])
    .map((row) => flattenWorkContext(row.work_context))
    .filter((
      row,
    ): row is {
      work_context_id: string;
      company_id: string;
      work_context_code: string;
      department_id: string | null;
      is_active: boolean;
    } => Boolean(row && row.is_active === true));

  if (availableWorkContexts.length === 0) {
    return unresolved();
  }

  const workContext =
    availableWorkContexts.find(
      (row) => row.work_context_id === session.selectedWorkContextId,
    ) ?? availableWorkContexts[0] ?? null;

  if (!workContext?.work_context_id) {
    return unresolved();
  }

  let projectId: string | undefined;
  const projectHeader = req.headers.get("x-project-id");

  if (projectHeader) {
    const projectAllowed = await hasEffectiveProjectAccess(
      serviceRoleClient,
      authUserId,
      companyId,
      projectHeader,
    );

    if (!projectAllowed) {
      return unresolved();
    }

    projectId = projectHeader;
  }

  let departmentId: string | undefined = workContext.department_id ?? undefined;
  const departmentHeader = req.headers.get("x-department-id");

  if (departmentHeader) {
    if (departmentId && departmentId !== departmentHeader) {
      return unresolved();
    }

    const { data: departmentMembership } = await serviceRoleClient
      .schema("erp_map")
      .from("user_departments")
      .select("department_id")
      .eq("auth_user_id", authUserId)
      .eq("department_id", departmentHeader)
      .maybeSingle();

    if (!departmentMembership) {
      return unresolved();
    }

    const { data: departmentScope } = await serviceRoleClient
      .schema("erp_master")
      .from("departments")
      .select("id")
      .eq("id", departmentHeader)
      .eq("company_id", companyId)
      .maybeSingle();

    if (!departmentScope) {
      return unresolved();
    }

    departmentId = departmentHeader;
  }

  return {
    status: "RESOLVED",
    source: "BACKEND",
    companyId,
    workContextId: workContext.work_context_id,
    workContextCode: workContext.work_context_code,
    projectId,
    departmentId,
    roleCode: session.roleCode,
    isAdmin: false,
  };
}

function enforceContextInvariants(ctx: ContextResolution): ContextResolution {
  if (ctx.status === "UNRESOLVED") {
    return ctx;
  }

  if (!ctx.companyId && !ctx.isAdmin) {
    return unresolved();
  }

  if (!ctx.isAdmin && !ctx.workContextId) {
    return unresolved();
  }

  return ctx;
}

export async function stepContext(
  req: Request,
  session: PipelineSession,
): Promise<ContextResolution> {
  sanitizeContextInput();

  if (isAdminUniverse(session)) {
    return {
      status: "RESOLVED",
      source: "BACKEND",
      roleCode: session.roleCode,
      isAdmin: true,
      companyId: undefined,
      workContextId: undefined,
      workContextCode: undefined,
    };
  }

  const resolved = await resolveContextFromDb(req, session).catch(() => unresolved());
  return enforceContextInvariants(resolved);
}
