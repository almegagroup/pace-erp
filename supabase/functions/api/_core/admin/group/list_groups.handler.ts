/*
 * File-ID: 9.3-H4
 * File-Path: supabase/functions/api/_core/admin/group/list_groups.handler.ts
 * Gate: 9
 * Phase: 9
 * Domain: MASTER
 * Purpose: List groups with company counts for SA governance
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

type GroupRow = {
  id: number;
  group_code: string;
  name: string;
  state: string | null;
  created_at: string | null;
};

type MappingRow = {
  group_id: number;
  company_id: string;
};

export async function listGroupsHandler(
  _req: Request,
  ctx: HandlerContext,
): Promise<Response> {
  try {
    assertAdmin(ctx);

    const db = getServiceRoleClientWithContext(ctx.context);

    const { data: groups, error: groupError } = await db
      .schema("erp_master").from("groups")
      .select("id, group_code, name, state, created_at")
      .order("name", { ascending: true });

    if (groupError) {
      return errorResponse(
        "GROUP_LIST_FAILED",
        "group list failed",
        ctx.request_id,
      );
    }

    const groupRows = (groups ?? []) as GroupRow[];
    const groupIds = groupRows.map((row) => row.id);

    const { data: mappings, error: mappingError } = groupIds.length === 0
      ? { data: [], error: null }
      : await db
        .schema("erp_map").from("company_group")
        .select("group_id, company_id")
        .in("group_id", groupIds);

    if (mappingError) {
      return errorResponse(
        "GROUP_MAPPING_LIST_FAILED",
        "group mapping list failed",
        ctx.request_id,
      );
    }

    const countMap = new Map<number, number>();
    for (const row of (mappings ?? []) as MappingRow[]) {
      countMap.set(row.group_id, (countMap.get(row.group_id) ?? 0) + 1);
    }

    const payload = groupRows.map((row) => ({
      ...row,
      company_count: countMap.get(row.id) ?? 0,
    }));

    return okResponse({ groups: payload }, ctx.request_id);
  } catch (err) {
    return errorResponse(
      (err as Error).message || "GROUP_LIST_EXCEPTION",
      "group list exception",
      ctx.request_id,
    );
  }
}
