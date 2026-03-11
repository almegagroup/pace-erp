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
import { recordSessionTimeline } from "./session_timeline.ts";

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
      status: "REVOKED",               // ✅ FIXED
      revoked_at: new Date().toISOString(),
      revoked_reason: "ADMIN_FORCE_REVOKE", // ✅ FIXED
      revoked_by: revokedByAuthUserId,
    })
    .eq("auth_user_id", targetAuthUserId)
    .eq("status", "ACTIVE");           // ✅ FIXED

    recordSessionTimeline({
  requestId: "SYSTEM_ADMIN",
  userId: targetAuthUserId,
  event: "REVOKE",
});

  if (error) {
    throw new Error("ADMIN_SESSION_REVOKE_FAILED");
  }
}
