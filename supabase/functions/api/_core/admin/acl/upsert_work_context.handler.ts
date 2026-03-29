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

    if (existing?.is_system === true && isActive === false) {
      return errorResponse(
        "SYSTEM_WORK_CONTEXT_IMMUTABLE",
        "System work context cannot be disabled",
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
