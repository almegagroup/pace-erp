/*
 * File-ID: 9.2B
 * File-Path: supabase/functions/api/_core/admin/company/list_companies.handler.ts
 * Gate: 9
 * Phase: 9
 * Domain: MASTER
 * Purpose: List business companies for SA bootstrap/governance
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

type CompanyRow = {
  id: string;
  company_code: string;
  company_name: string;
  gst_number: string | null;
  status: string | null;
  company_kind: string | null;
  created_at: string | null;
};

type MappingRow = {
  company_id: string;
  group_id: number;
};

type GroupRow = {
  id: number;
  group_code: string;
  name: string;
  state: string | null;
};

export async function listCompaniesHandler(
  _req: Request,
  ctx: HandlerContext,
): Promise<Response> {
  try {
    assertAdmin(ctx);

    const db = getServiceRoleClientWithContext(ctx.context);

    const { data: companies, error: companyError } = await db
      .schema("erp_master").from("companies")
      .select("id, company_code, company_name, gst_number, status, company_kind, created_at")
      .eq("company_kind", "BUSINESS")
      .order("company_name", { ascending: true });

    if (companyError) {
      return errorResponse(
        "COMPANY_LIST_FAILED",
        "company list failed",
        ctx.request_id,
      );
    }

    const companyRows = (companies ?? []) as CompanyRow[];
    const companyIds = companyRows.map((row) => row.id);

    const { data: mappings, error: mappingError } = companyIds.length === 0
      ? { data: [], error: null }
      : await db
        .schema("erp_map").from("company_group")
        .select("company_id, group_id")
        .in("company_id", companyIds);

    if (mappingError) {
      return errorResponse(
        "COMPANY_GROUP_MAPPING_LIST_FAILED",
        "company group mapping list failed",
        ctx.request_id,
      );
    }

    const mappingRows = (mappings ?? []) as MappingRow[];
    const groupIds = [...new Set(mappingRows.map((row) => row.group_id))];

    const { data: groups, error: groupError } = groupIds.length === 0
      ? { data: [], error: null }
      : await db
        .schema("erp_master").from("groups")
        .select("id, group_code, name, state")
        .in("id", groupIds);

    if (groupError) {
      return errorResponse(
        "GROUP_LIST_FAILED",
        "group list failed",
        ctx.request_id,
      );
    }

    const groupMap = new Map(
      ((groups ?? []) as GroupRow[]).map((row) => [String(row.id), row]),
    );
    const mappingMap = new Map(
      mappingRows.map((row) => [row.company_id, row]),
    );

    const payload = companyRows.map((row) => {
      const mapping = mappingMap.get(row.id) ?? null;
      const group = mapping ? groupMap.get(String(mapping.group_id)) ?? null : null;

      return {
        ...row,
        group_id: mapping?.group_id ?? null,
        group_code: group?.group_code ?? null,
        group_name: group?.name ?? null,
        group_state: group?.state ?? null,
      };
    });

    return okResponse({ companies: payload }, ctx.request_id);
  } catch (err) {
    return errorResponse(
      (err as Error).message || "COMPANY_LIST_EXCEPTION",
      "company list exception",
      ctx.request_id,
    );
  }
}
