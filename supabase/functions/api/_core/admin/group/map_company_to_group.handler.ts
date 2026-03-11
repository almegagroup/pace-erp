/*
 * File-ID: 9.3-H3
 * File-Path: supabase/functions/api/_core/admin/group/map_company_to_group.handler.ts
 * Gate: 9
 * Phase: 9
 * Domain: MASTER
 * Purpose: Map a company to a group (SA-only governance action)
 * Authority: Backend
 */

import { getServiceRoleClientWithContext } from "../../../_shared/serviceRoleClient.ts";
import type { ContextResolution } from "../../../_pipeline/context.ts";
import { okResponse, errorResponse } from "../../../_core/response.ts";

// --------------------------------------------------
// Admin guard
// --------------------------------------------------
function assertAdmin(ctx: { context: ContextResolution }): void {
  if (
    ctx.context.status !== "RESOLVED" ||
    ctx.context.isAdmin !== true
  ) {
    throw new Error("ADMIN_ONLY");
  }
}

// --------------------------------------------------
// Input contract
// --------------------------------------------------
type MapCompanyToGroupInput = {
  company_id?: string; // UUID
  group_id?: number;   // BIGINT
};

// --------------------------------------------------
// Handler
// --------------------------------------------------
export async function mapCompanyToGroupHandler(
  req: Request,
  ctx: { context: ContextResolution; request_id: string }
): Promise<Response> {
  try {
    // 1️⃣ Admin guard
    assertAdmin(ctx);

    // 2️⃣ Parse + validate input
    const body = (await req.json()) as MapCompanyToGroupInput;

   if (!body.company_id || body.group_id === undefined) {
      return errorResponse(
        "INVALID_INPUT",
        "company_id and group_id required",
        ctx.request_id
      );
    }

    const db = getServiceRoleClientWithContext(ctx.context);

    // 3️⃣ Ensure company exists
    const { data: company } = await db
      .from("erp_master.companies")
      .select("id")
      .eq("id", body.company_id)
      .maybeSingle();

    if (!company) {
      return errorResponse(
        "COMPANY_NOT_FOUND",
        "company not found",
        ctx.request_id
      );
    }

    // 4️⃣ Ensure group exists
    const { data: group } = await db
      .from("erp_master.groups")
      .select("id")
      .eq("id", body.group_id)
      .maybeSingle();

    if (!group) {
      return errorResponse(
        "GROUP_NOT_FOUND",
        "group not found",
        ctx.request_id
      );
    }

    // 5️⃣ Idempotent mapping (governance-safe)
// Rule: one company → one group

const { data: existing } = await db
  .from("erp_map.company_group")
  .select("id, group_id")
  .eq("company_id", body.company_id)
  .maybeSingle();

// Already mapped to same group → no-op
if (existing && existing.group_id === body.group_id) {
  return okResponse(
    {
      status: "ALREADY_MAPPED",
      company_id: body.company_id,
      group_id: body.group_id,
    },
    ctx.request_id
  );
}

// Mapped to a different group → replace mapping
if (existing) {
  await db
    .from("erp_map.company_group")
    .delete()
    .eq("company_id", body.company_id);
}

const { error: insertError } = await db
  .from("erp_map.company_group")
  .insert({
    company_id: body.company_id,
    group_id: body.group_id,
  });

  
    if (insertError) {
      return errorResponse(
        "COMPANY_GROUP_MAP_FAILED",
        "mapping failed",
        ctx.request_id
      );
    }

    // 6️⃣ Success
    return okResponse(
      {
        company_id: body.company_id,
        group_id: body.group_id,
      },
      ctx.request_id
    );
  } catch (err) {
    return errorResponse(
      (err as Error).message || "COMPANY_GROUP_MAP_EXCEPTION",
      "mapping exception",
      ctx.request_id
    );
  }
}
