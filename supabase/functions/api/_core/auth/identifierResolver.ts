/*
 * File-ID: 2.1D-AUTH-IDENTIFIER-RESOLVER
 * File-Path: supabase/functions/api/_core/auth/identifierResolver.ts
 * Gate: 2
 * Phase: 2
 * Domain: AUTH
 * Purpose: Resolve ERP identifier (email or ERP code) before login
 * Authority: Backend
 */

import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { assertRlsEnabled } from "../../_shared/rls_assert.ts";

export type ResolvedIdentifier =
  | { kind: "email"; email: string }
  | { kind: "erp"; authUserId: string };

/**
 * ERP identifier resolver
 * - Enumeration safe (returns null on any failure)
 * - No password handling
 * - No session handling
 */
export async function resolveIdentifier(
  rawIdentifier: string
): Promise<ResolvedIdentifier | null> {
  const identifier = rawIdentifier.trim();

  if (!identifier) return null;

  /**
   * EMAIL PATH
   */
  if (identifier.includes("@")) {
    const email = identifier.toLowerCase();

    // minimal sanity (not RFC)
    if (email.length > 254 || !email.includes(".")) {
      return null;
    }

    return { kind: "email", email };
  }

  /**
   * ERP CODE PATH (e.g. P0001)
   */
  const ERP_CODE_REGEX = /^P\d{4,}$/;

  if (!ERP_CODE_REGEX.test(identifier)) {
    return null;
  }

  // Governance contract (Gate-1)
  assertRlsEnabled();

  const { data, error } = await serviceRoleClient
    .schema("erp_core").from("users")
    .select("auth_user_id")
    .eq("user_code", identifier)
    .single();

  if (error || !data?.auth_user_id) {
    return null;
  }

  return {
    kind: "erp",
    authUserId: data.auth_user_id,
  };
}
