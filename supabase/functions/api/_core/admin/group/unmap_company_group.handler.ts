/*
 * File-ID: 9.3C
 * File-Path: supabase/functions/api/_core/admin/group/unmap_company_group.handler.ts
 * Gate: 9
 * Phase: 9
 * Domain: MASTER
 * Purpose: Unmap company from group (SA-only governance action)
 * Authority: Backend
 */

import { getServiceRoleClientWithContext } from "../../../_shared/serviceRoleClient.ts";
import type { ContextResolution } from "../../../_pipeline/context.ts";
import { okResponse, errorResponse } from "../../../_core/response.ts";

type AdminContext = {
  context: ContextResolution;
  request_id: string;
};

function assertAdmin(ctx: AdminContext): void {
  if (
    ctx.context.status !== "RESOLVED" ||
    ctx.context.isAdmin !== true
  ) {
    throw new Error("ADMIN_ONLY");
  }
}

export async function unmapCompanyFromGroupHandler(
  req: Request,
  ctx: AdminContext
): Promise<Response> {
  try {
    // 1️⃣ Authority
    assertAdmin(ctx);

    // 2️⃣ Input
    const body = await req.json();
    const { company_id } = body ?? {};

    if (!company_id) {
      return errorResponse(
        "INVALID_INPUT",
        "company_id required",
        ctx.request_id
      );
    }

    const db = getServiceRoleClientWithContext(ctx.context);

    // 3️⃣ Check existing mapping
    const { data: existing } = await db
      .from("erp_map.company_group")
      .select("id")
      .eq("company_id", company_id)
      .maybeSingle();

    if (!existing) {
      // idempotent no-op
      return okResponse(
        { status: "NO_MAPPING_FOUND", company_id },
        ctx.request_id
      );
    }

    // 4️⃣ Delete mapping
    const { error } = await db
      .from("erp_map.company_group")
      .delete()
      .eq("company_id", company_id);

    if (error) {
      return errorResponse(
        "COMPANY_GROUP_UNMAP_FAILED",
        "unmap failed",
        ctx.request_id
      );
    }

    // 5️⃣ Success
    return okResponse(
      { status: "UNMAPPED", company_id },
      ctx.request_id
    );
  } catch (err) {
    return errorResponse(
      (err as Error).message || "UNMAP_EXCEPTION",
      "unmap exception",
      ctx.request_id
    );
  }
}
