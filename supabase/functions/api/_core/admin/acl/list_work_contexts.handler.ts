/*
 * File-ID: ID-9.7C
 * File-Path: supabase/functions/api/_core/admin/acl/list_work_contexts.handler.ts
 * Gate: 9
 * Phase: 9
 * Domain: ACL
 * Purpose: List governed work contexts with company and department labels
 * Authority: Backend
 */

import { getServiceRoleClientWithContext } from "../../../_shared/serviceRoleClient.ts";
import type { ContextResolution } from "../../../_pipeline/context.ts";
import { okResponse, errorResponse } from "../../response.ts";
import { generateRequestId } from "../../../_lib/request_id.ts";

type AdminContext = {
  context: ContextResolution;
};

function assertAdmin(ctx: AdminContext): void {
  if (ctx.context.status !== "RESOLVED" || ctx.context.isAdmin !== true) {
    throw new Error("ADMIN_ONLY");
  }
}

export async function listWorkContextsHandler(
  req: Request,
  ctx: AdminContext,
): Promise<Response> {
  const requestId = generateRequestId();

  try {
    assertAdmin(ctx);

    const db = getServiceRoleClientWithContext(ctx.context);
    const url = new URL(req.url);
    const companyId = url.searchParams.get("company_id")?.trim() ?? "";

    let query = db
      .schema("erp_acl")
      .from("work_contexts")
      .select(`
        work_context_id,
        company_id,
        work_context_code,
        work_context_name,
        description,
        department_id,
        is_system,
        is_active,
        company:company_id!inner (
          company_code,
          company_name
        ),
        department:department_id (
          department_code,
          department_name
        )
      `)
      .order("work_context_code", { ascending: true });

    if (companyId) {
      query = query.eq("company_id", companyId);
    }

    const { data, error } = await query;

    if (error) {
      return errorResponse(
        "WORK_CONTEXT_LIST_FAILED",
        error.message,
        requestId,
      );
    }

    return okResponse(
      {
        work_contexts: (data ?? []).map((row) => ({
          work_context_id: row.work_context_id,
          company_id: row.company_id,
          company_code: row.company?.company_code ?? null,
          company_name: row.company?.company_name ?? null,
          work_context_code: row.work_context_code,
          work_context_name: row.work_context_name,
          description: row.description ?? null,
          department_id: row.department_id ?? null,
          department_code: row.department?.department_code ?? null,
          department_name: row.department?.department_name ?? null,
          is_system: row.is_system === true,
          is_active: row.is_active === true,
        })),
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
