/*
 * File-ID: 0.5B
 * File-Path: supabase/functions/api/_shared/canonical_access.ts
 * Gate: 0
 * Phase: 0
 * Domain: SECURITY
 * Purpose: Resolve canonical role and company access using SSOT tables
 * Authority: Backend
 */

import { createClient } from "@supabase/supabase-js";

type DbClient = ReturnType<typeof createClient>;

export type CanonicalAccessProfile = {
  userCode: string;
  roleCode: string | null;
  isAdmin: boolean;
};

export type WorkContextOption = {
  work_context_id: string;
  company_id: string;
  work_context_code: string;
  work_context_name: string;
  description: string | null;
  department_id: string | null;
};

export async function resolveCanonicalAccessProfile(
  db: DbClient,
  authUserId: string,
): Promise<CanonicalAccessProfile> {
  const [{ data: userRow, error: userError }, { data: roleRow, error: roleError }] =
    await Promise.all([
      db
        .schema("erp_core")
        .from("users")
        .select("user_code")
        .eq("auth_user_id", authUserId)
        .single(),
      db
        .schema("erp_acl")
        .from("user_roles")
        .select("role_code")
        .eq("auth_user_id", authUserId)
        .maybeSingle(),
    ]);

  if (userError || !userRow?.user_code) {
    throw new Error("USER_NOT_FOUND");
  }

  const userCode = String(userRow.user_code);
  let roleCode = roleRow?.role_code ?? null;

  if (userCode.startsWith("SA")) {
    roleCode = "SA";
  } else if (userCode.startsWith("GA")) {
    roleCode = "GA";
  }

  if (roleError) {
    throw new Error("ROLE_RESOLUTION_FAILED");
  }

  return {
    userCode,
    roleCode,
    isAdmin: roleCode === "SA" || roleCode === "GA",
  };
}

export async function listCanonicalCompanyIds(
  db: DbClient,
  authUserId: string,
): Promise<string[]> {
  const { data, error } = await db
    .schema("erp_map")
    .from("user_companies")
    .select("company_id")
    .eq("auth_user_id", authUserId)
    .order("is_primary", { ascending: false });

  if (error) {
    throw new Error("COMPANY_RESOLUTION_FAILED");
  }

  const candidateCompanyIds = [...new Set((data ?? []).map((row) => row.company_id).filter(Boolean))];

  if (candidateCompanyIds.length === 0) {
    return [];
  }

  const { data: activeCompanies, error: companyError } = await db
    .schema("erp_master")
    .from("companies")
    .select("id")
    .in("id", candidateCompanyIds)
    .eq("status", "ACTIVE")
    .eq("company_kind", "BUSINESS");

  if (companyError) {
    throw new Error("COMPANY_RESOLUTION_FAILED");
  }

  const allowedIds = new Set((activeCompanies ?? []).map((row) => row.id));

  return candidateCompanyIds.filter((companyId) => allowedIds.has(companyId));
}

export async function resolveDefaultWorkCompanyId(
  db: DbClient,
  authUserId: string,
): Promise<string | null> {
  const { data, error } = await db
    .schema("erp_map")
    .from("user_companies")
    .select("company_id, is_primary")
    .eq("auth_user_id", authUserId)
    .order("is_primary", { ascending: false })
    .limit(20);

  if (error || !data) {
    throw new Error("WORK_COMPANY_RESOLUTION_FAILED");
  }

  const candidateCompanyIds = data
    .map((row) => row.company_id)
    .filter(Boolean);

  if (candidateCompanyIds.length === 0) {
    return null;
  }

  const { data: activeCompanies, error: companyError } = await db
    .schema("erp_master")
    .from("companies")
    .select("id")
    .in("id", candidateCompanyIds)
    .eq("status", "ACTIVE")
    .eq("company_kind", "BUSINESS");

  if (companyError) {
    throw new Error("WORK_COMPANY_RESOLUTION_FAILED");
  }

  const allowedIds = new Set((activeCompanies ?? []).map((row) => row.id));
  const resolved = data.find((row) => row.company_id && allowedIds.has(row.company_id));

  return resolved?.company_id ?? null;
}

export async function listAvailableWorkContexts(
  db: DbClient,
  authUserId: string,
  companyId: string,
): Promise<WorkContextOption[]> {
  const { data, error } = await db
    .schema("erp_acl")
    .from("user_work_contexts")
    .select(`
      work_context_id,
      company_id,
      work_context:work_context_id!inner (
        work_context_id,
        company_id,
        work_context_code,
        work_context_name,
        description,
        department_id,
        is_active
      )
    `)
    .eq("auth_user_id", authUserId)
    .eq("company_id", companyId)
    .order("is_primary", { ascending: false });

  if (error) {
    throw new Error("WORK_CONTEXT_RESOLUTION_FAILED");
  }

  const deduped = new Map<string, WorkContextOption>();

  for (const row of (data ?? []).map((item) => item.work_context).filter(Boolean)) {
    if (row.is_active !== true || deduped.has(row.work_context_id)) {
      continue;
    }

    deduped.set(row.work_context_id, {
      work_context_id: row.work_context_id,
      company_id: row.company_id,
      work_context_code: row.work_context_code,
      work_context_name: row.work_context_name,
      description: row.description ?? null,
      department_id: row.department_id ?? null,
    });
  }

  return Array.from(deduped.values()).sort((left, right) =>
    `${left.work_context_code}|${left.work_context_name}`.localeCompare(
      `${right.work_context_code}|${right.work_context_name}`,
      "en",
      { numeric: true, sensitivity: "base" },
    )
  );
}

export async function resolveDefaultWorkContextId(
  db: DbClient,
  authUserId: string,
  companyId: string,
): Promise<string | null> {
  const { data, error } = await db
    .schema("erp_acl")
    .from("user_work_contexts")
    .select(`
      work_context_id,
      work_context:work_context_id!inner (
        work_context_id,
        is_active
      )
    `)
    .eq("auth_user_id", authUserId)
    .eq("company_id", companyId)
    .order("is_primary", { ascending: false })
    .limit(20);

  if (error || !data) {
    throw new Error("WORK_CONTEXT_RESOLUTION_FAILED");
  }

  const resolved = data.find((row) => row.work_context?.is_active === true);
  return resolved?.work_context_id ?? null;
}

export async function resolveCanonicalPrimaryCompanyId(
  db: DbClient,
  authUserId: string,
): Promise<string | null> {
  const { data, error } = await db
    .schema("erp_map")
    .rpc("get_primary_company", {
      p_auth_user_id: authUserId,
    }) as { data: string | null; error: unknown };

  if (error) {
    throw new Error("PRIMARY_COMPANY_RESOLUTION_FAILED");
  }

  return data ?? null;
}
