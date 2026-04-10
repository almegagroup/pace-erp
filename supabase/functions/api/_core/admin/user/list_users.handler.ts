/*
 * File-ID: 9.6
 * File-Path: supabase/functions/api/_core/admin/user/list_users.handler.ts
 * Gate: 9
 * Phase: 9
 * Domain: ADMIN
 * Purpose: List governable ERP users for Admin Universe governance
 * Authority: Backend
 */

import { getServiceRoleClientWithContext } from "../../../_shared/serviceRoleClient.ts";
import type { ContextResolution } from "../../../_pipeline/context.ts";
import { okResponse } from "../../response.ts";

function normalizeText(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
}

function compareText(left: unknown, right: unknown): number {
  return normalizeText(left).localeCompare(normalizeText(right), "en", {
    numeric: true,
    sensitivity: "base",
  });
}

/**
 * List Users (Admin Governance)
 *
 * Behaviour:
 * - Admin universe only (enforced upstream)
 * - Context must be RESOLVED
 * - Returns ACTIVE + DISABLED users
 * - Enumeration-safe
 * - No role inference
 * - No ACL materialization
 */
type HandlerContext = {
  context: ContextResolution;
  request_id: string;
};

type ParentCompanyRow = {
  auth_user_id: string;
  company_id: string;
};

type CompanyRow = {
  id: string;
  company_code: string;
  company_name: string;
};

type CompanyGroupRow = {
  company_id: string;
  group_id: number;
};

type GroupRow = {
  id: number;
  group_code: string;
  name: string;
};

export async function listUsersHandler(
  _req: Request,
  ctx: HandlerContext
): Promise<Response> {
  // --------------------------------------------------
  // Context gate (NO resolution here)
  // --------------------------------------------------
  if (ctx.context.status !== "RESOLVED") {
    return okResponse([], ctx.request_id);
  }

  // --------------------------------------------------
  // Context-aware DB client
  // --------------------------------------------------
  const db = getServiceRoleClientWithContext(ctx.context);

  // --------------------------------------------------
  // Fetch governable users
  // --------------------------------------------------
  const { data: users } = await db
    .schema("erp_core").from("users")
    .select(
      "auth_user_id, user_code, state, created_at"
    )
    .in("state", ["ACTIVE", "DISABLED"])
    .order("created_at", { ascending: true });

  const authUserIds = (users ?? []).map((user) => user.auth_user_id);

  const { data: roleRows } = authUserIds.length === 0
    ? { data: [] }
    : await db
      .schema("erp_acl").from("user_roles")
      .select("auth_user_id, role_code, role_rank")
      .in("auth_user_id", authUserIds);

  const { data: signupRows } = authUserIds.length === 0
    ? { data: [] }
    : await db
      .schema("erp_core").from("signup_requests")
      .select(
        "auth_user_id, name, parent_company_name, designation_hint, phone_number, decision, submitted_at"
      )
      .in("auth_user_id", authUserIds);

  const { data: parentCompanyRows } = authUserIds.length === 0
    ? { data: [] }
    : await db
      .schema("erp_map").from("user_parent_companies")
      .select("auth_user_id, company_id")
      .in("auth_user_id", authUserIds);

  const parentCompanyIds = [...new Set(
    ((parentCompanyRows ?? []) as ParentCompanyRow[]).map((row) => row.company_id),
  )];

  const { data: parentCompanies } = parentCompanyIds.length === 0
    ? { data: [] }
    : await db
      .schema("erp_master").from("companies")
      .select("id, company_code, company_name")
      .in("id", parentCompanyIds);

  const { data: companyGroupRows } = parentCompanyIds.length === 0
    ? { data: [] }
    : await db
      .schema("erp_map").from("company_group")
      .select("company_id, group_id")
      .in("company_id", parentCompanyIds);

  const groupIds = [...new Set(
    ((companyGroupRows ?? []) as CompanyGroupRow[]).map((row) => row.group_id),
  )];

  const { data: groups } = groupIds.length === 0
    ? { data: [] }
    : await db
      .schema("erp_master").from("groups")
      .select("id, group_code, name")
      .in("id", groupIds);

  const roleMap = new Map(
    (roleRows ?? []).map((row) => [row.auth_user_id, row])
  );
  const signupMap = new Map(
    (signupRows ?? []).map((row) => [row.auth_user_id, row])
  );
  const parentCompanyMapByUser = new Map(
    ((parentCompanyRows ?? []) as ParentCompanyRow[]).map((row) => [row.auth_user_id, row.company_id]),
  );
  const companyMap = new Map(
    ((parentCompanies ?? []) as CompanyRow[]).map((row) => [row.id, row]),
  );
  const companyGroupMap = new Map(
    ((companyGroupRows ?? []) as CompanyGroupRow[]).map((row) => [row.company_id, row.group_id]),
  );
  const groupMap = new Map(
    ((groups ?? []) as GroupRow[]).map((row) => [String(row.id), row]),
  );

  const payload = (users ?? []).map((user) => {
    const roleRow = roleMap.get(user.auth_user_id);
    const signupRow = signupMap.get(user.auth_user_id);
    const parentCompanyId = parentCompanyMapByUser.get(user.auth_user_id) ?? null;
    const parentCompany = parentCompanyId ? companyMap.get(parentCompanyId) ?? null : null;
    const groupId = parentCompanyId ? companyGroupMap.get(parentCompanyId) ?? null : null;
    const group = groupId ? groupMap.get(String(groupId)) ?? null : null;

    return {
      ...user,
      role_code: roleRow?.role_code ?? null,
      role_rank: roleRow?.role_rank ?? null,
      is_acl_user: Boolean(roleRow?.role_code),
      name: signupRow?.name ?? null,
      parent_company_id: parentCompanyId,
      parent_company_code: parentCompany?.company_code ?? null,
      parent_company_name:
        parentCompany?.company_name ?? signupRow?.parent_company_name ?? null,
      group_id: groupId ?? null,
      group_code: group?.group_code ?? null,
      group_name: group?.name ?? null,
      designation_hint: signupRow?.designation_hint ?? null,
      phone_number: signupRow?.phone_number ?? null,
      signup_decision: signupRow?.decision ?? null,
      signup_submitted_at: signupRow?.submitted_at ?? null,
    };
  }).sort((left, right) => {
    const codeCompare = compareText(left.user_code, right.user_code);
    if (codeCompare !== 0) {
      return codeCompare;
    }

    const nameCompare = compareText(left.name, right.name);
    if (nameCompare !== 0) {
      return nameCompare;
    }

    return compareText(left.auth_user_id, right.auth_user_id);
  });

  // --------------------------------------------------
  // Deterministic response
  // --------------------------------------------------
  return okResponse(payload, ctx.request_id);
}
