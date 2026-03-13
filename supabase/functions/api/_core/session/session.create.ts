/*
 * File-ID: 2.1C-SESSION-CREATE
 * File-Path: supabase/functions/api/_core/session/session.create.ts
 * Gate: 2
 * Phase: 2
 * Domain: SESSION
 * Purpose: Create ERP session with deterministic TTL + single-session enforcement
 * Authority: Backend
 */

import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { assertRlsEnabled } from "../../_shared/rls_assert.ts";

export async function createSession(
  authUserId: string,
  device?: {
    device_id: string;
    device_summary: string;
  }
): Promise<string> {
  assertRlsEnabled();

  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const expiresIso = new Date(now + 12 * 60 * 60 * 1000).toISOString(); // 12h TTL

  // ------------------------------------------------
  // Revoke all existing ACTIVE sessions (single-session policy)
  // ------------------------------------------------
  const { error: revokeError } = await serviceRoleClient
    .schema("erp_core").from("sessions")
    .update({
      status: "REVOKED",
      revoked_at: nowIso,
      revoked_reason: "NEW_LOGIN",
      revoked_by: authUserId,
    })
    .eq("auth_user_id", authUserId)
    .eq("status", "ACTIVE");

  if (revokeError) {
    throw new Error("SESSION_REVOKE_FAILED");
  }

  // ------------------------------------------------
  // Generate fresh session ID (fixation prevention)
  // ------------------------------------------------
  const sessionId = crypto.randomUUID();

  if (!sessionId) {
    throw new Error("SESSION_ID_GENERATION_FAILED");
  }

  // ------------------------------------------------
  // Insert new ACTIVE session
  // ------------------------------------------------
  const { error: insertError } = await serviceRoleClient
    .schema("erp_core").from("sessions")
    .insert({
  session_id: sessionId,
  auth_user_id: authUserId,
  status: "ACTIVE",
  created_at: nowIso,
  last_seen_at: nowIso,
  expires_at: expiresIso,
  device_id: device?.device_id ?? null,
  device_summary: device?.device_summary ?? null,
});

  if (insertError) {
    throw new Error("SESSION_CREATE_FAILED");
  }

  return sessionId;
}