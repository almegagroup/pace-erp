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
import { log } from "../../../_lib/logger.ts";

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
        is_active
      `)
      .order("work_context_code", { ascending: true });

    if (companyId) {
      query = query.eq("company_id", companyId);
    }

    const { data, error } = await query;

    if (error) {
      log({
        level: "ERROR",
        request_id: requestId,
        gate_id: "9.7C",
        event: "WORK_CONTEXT_LIST_BASE_QUERY_FAILED",
        meta: {
          company_id: companyId || null,
          error: error.message,
        },
      });

      return errorResponse(
        "WORK_CONTEXT_LIST_FAILED",
        error.message,
        requestId,
      );
    }

    const rows = data ?? [];
    const companyIds = [...new Set(rows.map((row) => row.company_id).filter(Boolean))];
    const departmentIds = [
      ...new Set(rows.map((row) => row.department_id).filter(Boolean)),
    ];

    const { data: companies, error: companyError } = companyIds.length === 0
      ? { data: [], error: null }
      : await db
        .schema("erp_master")
        .from("companies")
        .select("id, company_code, company_name")
        .in("id", companyIds);

    if (companyError) {
      log({
        level: "ERROR",
        request_id: requestId,
        gate_id: "9.7C",
        event: "WORK_CONTEXT_LIST_COMPANY_LOOKUP_FAILED",
        meta: {
          company_ids: companyIds,
          error: companyError.message,
        },
      });

      return errorResponse(
        "WORK_CONTEXT_LIST_FAILED",
        companyError.message,
        requestId,
      );
    }

    const { data: departments, error: departmentError } = departmentIds.length === 0
      ? { data: [], error: null }
      : await db
        .schema("erp_master")
        .from("departments")
        .select("id, department_code, department_name")
        .in("id", departmentIds);

    if (departmentError) {
      log({
        level: "ERROR",
        request_id: requestId,
        gate_id: "9.7C",
        event: "WORK_CONTEXT_LIST_DEPARTMENT_LOOKUP_FAILED",
        meta: {
          department_ids: departmentIds,
          error: departmentError.message,
        },
      });

      return errorResponse(
        "WORK_CONTEXT_LIST_FAILED",
        departmentError.message,
        requestId,
      );
    }

    const companyMap = new Map(
      (companies ?? []).map((row) => [row.id, row]),
    );
    const departmentMap = new Map(
      (departments ?? []).map((row) => [row.id, row]),
    );

    return okResponse(
      {
        work_contexts: rows.map((row) => ({
          work_context_id: row.work_context_id,
          company_id: row.company_id,
          company_code: companyMap.get(row.company_id)?.company_code ?? null,
          company_name: companyMap.get(row.company_id)?.company_name ?? null,
          work_context_code: row.work_context_code,
          work_context_name: row.work_context_name,
          description: row.description ?? null,
          department_id: row.department_id ?? null,
          department_code: row.department_id
            ? departmentMap.get(row.department_id)?.department_code ?? null
            : null,
          department_name: row.department_id
            ? departmentMap.get(row.department_id)?.department_name ?? null
            : null,
          is_system: row.is_system === true,
          is_active: row.is_active === true,
        })),
      },
      requestId,
    );
  } catch (err) {
    log({
      level: "ERROR",
      request_id: requestId,
      gate_id: "9.7C",
      event: "WORK_CONTEXT_LIST_EXCEPTION",
      meta: { error: String(err) },
    });

    return errorResponse(
      (err as Error).message || "REQUEST_BLOCKED",
      "Unhandled error",
      requestId,
    );
  }
}
