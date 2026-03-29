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

  return [...new Set((data ?? []).map((row) => row.company_id).filter(Boolean))];
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
