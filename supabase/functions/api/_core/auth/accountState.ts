/*
 * File-ID: 2.1B-AUTH-ACCOUNT-STATE
 * File-Path: supabase/functions/api/_core/auth/accountState.ts
 * Gate: 2
 * Phase: 2
 * Domain: AUTH
 * Purpose: Check ERP account state for authenticated identity
 * Authority: Backend
 */

import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { assertRlsEnabled } from "../../_shared/rls_assert.ts";

export type AccountState = "ACTIVE" | "DISABLED" | "LOCKED";

export async function getAccountState(authUserId: string): Promise<AccountState | null> {
  // Governance contract (Gate-1)
  assertRlsEnabled();

  const { data, error } = await serviceRoleClient
    .schema("erp_core").from("users")
    .select("state")
    .eq("auth_user_id", authUserId)
    .single();

  if (error || !data) {
    return null;
  }

  return data.state as AccountState;
}
