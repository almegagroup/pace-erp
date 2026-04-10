/*
 * File-ID: ID-9.7C
 * File-Path: supabase/functions/api/_core/admin/acl/upsert_work_context.handler.ts
 * Gate: 9
 * Phase: 9
 * Domain: ACL
 * Purpose: Create or update a governed work context
 * Authority: Backend
 */

import { getServiceRoleClientWithContext } from "../../../_shared/serviceRoleClient.ts";
import type { ContextResolution } from "../../../_pipeline/context.ts";
import { okResponse, errorResponse } from "../../response.ts";
import { generateRequestId } from "../../../_lib/request_id.ts";

type UpsertWorkContextInput = {
  company_id?: string;
  work_context_code?: string;
  work_context_name?: string;
  description?: string;
  department_id?: string | null;
  is_active?: boolean;
};

type CompanyRow = {
  id: string;
  status: string | null;
  company_kind: string | null;
};

type DepartmentRow = {
  id: string;
  company_id: string;
  status: string | null;
};

type AdminContext = {
  context: ContextResolution;
};

function assertAdmin(ctx: AdminContext): void {
  if (ctx.context.status !== "RESOLVED" || ctx.context.isAdmin !== true) {
    throw new Error("ADMIN_ONLY");
  }
}

export async function upsertWorkContextHandler(
  req: Request,
  ctx: AdminContext,
): Promise<Response> {
  const requestId = generateRequestId();

  try {
    assertAdmin(ctx);

    const body = (await req.json()) as UpsertWorkContextInput;
    const companyId = body.company_id?.trim() ?? "";
    const workContextCode = body.work_context_code?.trim().toUpperCase() ?? "";
    const workContextName = body.work_context_name?.trim() ?? "";
    const description = body.description?.trim() ?? null;
    const departmentId = typeof body.department_id === "string"
      ? body.department_id.trim() || null
      : null;
    const isActive = body.is_active !== false;

    if (!companyId || !workContextCode || !workContextName) {
      return errorResponse(
        "WORK_CONTEXT_INPUT_INVALID",
        "company_id, work_context_code, and work_context_name required",
        requestId,
      );
    }

    const db = getServiceRoleClientWithContext(ctx.context);
    const { data: company, error: companyError } = await db
      .schema("erp_master")
      .from("companies")
      .select("id, status, company_kind")
      .eq("id", companyId)
      .maybeSingle<CompanyRow>();

    if (companyError) {
      return errorResponse(
        "WORK_CONTEXT_COMPANY_FETCH_FAILED",
        companyError.message,
        requestId,
      );
    }

    if (!company) {
      return errorResponse(
        "WORK_CONTEXT_COMPANY_NOT_FOUND",
        "Selected company not found",
        requestId,
      );
    }

    if (company.company_kind !== "BUSINESS") {
      return errorResponse(
        "WORK_CONTEXT_COMPANY_INVALID",
        "Work contexts can only be governed for business companies",
        requestId,
      );
    }

    if (
      workContextCode === "GENERAL_OPS" || workContextCode.startsWith("DEPT_")
    ) {
      return errorResponse(
        "WORK_CONTEXT_CODE_RESERVED",
        "System work-context codes are reserved for company and department foundations",
        requestId,
      );
    }

    if (departmentId) {
      const { data: department, error: departmentError } = await db
        .schema("erp_master")
        .from("departments")
        .select("id, company_id, status")
        .eq("id", departmentId)
        .maybeSingle<DepartmentRow>();

      if (departmentError) {
        return errorResponse(
          "WORK_CONTEXT_DEPARTMENT_FETCH_FAILED",
          departmentError.message,
          requestId,
        );
      }

      if (!department) {
        return errorResponse(
          "WORK_CONTEXT_DEPARTMENT_NOT_FOUND",
          "Selected department not found",
          requestId,
        );
      }

      if (department.company_id !== companyId) {
        return errorResponse(
          "WORK_CONTEXT_DEPARTMENT_COMPANY_MISMATCH",
          "Department must belong to the same company as the work context",
          requestId,
        );
      }

      if (department.status !== "ACTIVE") {
        return errorResponse(
          "WORK_CONTEXT_DEPARTMENT_INACTIVE",
          "Only active departments can be linked to a manual work context",
          requestId,
        );
      }
    }

    const { data: existing, error: existingError } = await db
      .schema("erp_acl")
      .from("work_contexts")
      .select("work_context_id, is_system")
      .eq("company_id", companyId)
      .eq("work_context_code", workContextCode)
      .maybeSingle();

    if (existingError) {
      return errorResponse(
        "WORK_CONTEXT_FETCH_FAILED",
        existingError.message,
        requestId,
      );
    }

    if (existing?.is_system === true) {
      return errorResponse(
        "SYSTEM_WORK_CONTEXT_IMMUTABLE",
        "System work context must be managed from company or department foundations",
        requestId,
      );
    }

    const { data, error } = await db
      .schema("erp_acl")
      .from("work_contexts")
      .upsert(
        {
          company_id: companyId,
          work_context_code: workContextCode,
          work_context_name: workContextName,
          description,
          department_id: departmentId,
          is_active: isActive,
        },
        {
          onConflict: "company_id,work_context_code",
        },
      )
      .select(`
        work_context_id,
        company_id,
        work_context_code,
        work_context_name,
        description,
        department_id,
        is_system,
        is_active
      `)
      .single();

    if (error || !data) {
      return errorResponse(
        "WORK_CONTEXT_UPSERT_FAILED",
        error?.message ?? "Work context upsert failed",
        requestId,
      );
    }

    return okResponse(
      {
        work_context: data,
      },
      requestId,
    );
  } catch (err) {
    return errorResponse(
      (err as Error).message || "REQUEST_BLOCKED",
      "Unhandled error",
      requestId,
    );
  }
}
