/*
 * File-ID: 9.5B
 * File-Path: supabase/functions/api/_core/admin/department/list_departments.handler.ts
 * Gate: 9
 * Phase: 9
 * Domain: MASTER
 * Purpose: List departments for a target company in SA bootstrap/governance
 * Authority: Backend
 */

import type { ContextResolution } from "../../../_pipeline/context.ts";
import { getServiceRoleClientWithContext } from "../../../_shared/serviceRoleClient.ts";
import { okResponse, errorResponse } from "../../../_core/response.ts";

type HandlerContext = {
  context: ContextResolution;
  request_id: string;
};

function assertAdmin(
  ctx: HandlerContext,
): asserts ctx is {
  context: Extract<ContextResolution, { status: "RESOLVED" }> & { isAdmin: true };
  request_id: string;
} {
  if (ctx.context.status !== "RESOLVED" || ctx.context.isAdmin !== true) {
    throw new Error("ADMIN_ONLY");
  }
}

export async function listDepartmentsHandler(
  req: Request,
  ctx: HandlerContext,
): Promise<Response> {
  try {
    assertAdmin(ctx);

    const url = new URL(req.url);
    const companyId = url.searchParams.get("company_id")?.trim() || ctx.context.companyId;
    const db = getServiceRoleClientWithContext(ctx.context);

    const { data, error } = await db
      .schema("erp_master").from("departments")
      .select("id, company_id, department_code, department_name, status, created_at")
      .eq("company_id", companyId)
      .order("department_name", { ascending: true });

    if (error) {
      return errorResponse(
        "DEPARTMENT_LIST_FAILED",
        "department list failed",
        ctx.request_id,
      );
    }

    return okResponse({ departments: data ?? [] }, ctx.request_id);
  } catch (err) {
    return errorResponse(
      (err as Error).message || "DEPARTMENT_LIST_EXCEPTION",
      "department list exception",
      ctx.request_id,
    );
  }
}
