/*
 * File-ID: ID-3.4-ADMIN-REVOKE
 * File-Path: supabase/functions/api/_core/session/session.admin_revoke.ts
 * Gate: 3
 * Phase: 3
 * Domain: SESSION
 * Purpose: Admin force revoke of all ERP sessions of a user
 * Authority: Backend (SA only)
 */

import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { assertRlsEnabled } from "../../_shared/rls_assert.ts";

/**
 * STEP 7.1 — Admin force revoke (3.4)
 *
 * Behaviour:
 * - Revoke ALL ERP sessions of the target user
 * - No grace window
 * - Immediate effect on next request (3.4A)
 *
 * NOTE:
 * - Caller authentication & SA authorization must be enforced upstream
 */
export async function adminForceRevokeSessions(
  targetAuthUserId: string,
  revokedByAuthUserId: string
): Promise<void> {
  assertRlsEnabled();

  const { error } = await serviceRoleClient
    .from("erp_core.sessions")
    .update({
      state: "REVOKED",
      revoked_at: new Date().toISOString(),
      revoked_by: revokedByAuthUserId,
      revoke_reason: "ADMIN_FORCE_REVOKE",
    })
    .eq("auth_user_id", targetAuthUserId)
    .eq("state", "ACTIVE");

  if (error) {
    throw new Error("ADMIN_SESSION_REVOKE_FAILED");
  }
}
