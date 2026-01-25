/*
 * File-ID: 2.1C-SESSION-CREATE
 * File-Path: supabase/functions/api/_core/session/session.create.ts
 * Gate: 2
 * Phase: 2
 * Domain: SESSION
 * Purpose: Create ERP session with single-active-session enforcement
 *          + soft device tagging
 * Authority: Backend
 */

import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { assertRlsEnabled } from "../../_shared/rls_assert.ts";

/**
 * STEP 8.1 — Device tagging (soft)
 * Signal-only metadata, no enforcement
 */
type DeviceInfo = {
  device_id: string;
  device_summary: string;
};

/**
 * STEP 6.1 — 3.3A (Global revoke on login)
 *
 * Behaviour:
 * - Revoke ALL existing ERP sessions of this user
 * - Create exactly ONE new ACTIVE session
 * - Optionally attach device signal (3.5)
 */
export async function createSession(
  authUserId: string,
  device?: DeviceInfo
): Promise<string> {
  assertRlsEnabled();

  // ------------------------------------------------
  // 3.3A — Revoke all existing ACTIVE ERP sessions
  // ------------------------------------------------
  const { error: revokeError } = await serviceRoleClient
    .from("erp_core.sessions")
    .update({
      state: "REVOKED",
      revoked_at: new Date().toISOString(),
    })
    .eq("auth_user_id", authUserId)
    .eq("state", "ACTIVE");

  if (revokeError) {
    throw new Error("SESSION_REVOKE_FAILED");
  }

  // ------------------------------------------------
  // Create new ACTIVE session
  // ------------------------------------------------
  // STEP 9.1 — Session fixation prevention
// Always generate a brand-new session identifier on login
const sessionId = crypto.randomUUID();

if (!sessionId) {
  // Defensive guard: session reuse must NEVER happen
  throw new Error("SESSION_ID_GENERATION_FAILED");
}

  const { error: insertError } = await serviceRoleClient
    .from("erp_core.sessions")
    .insert({
      id: sessionId,
      auth_user_id: authUserId,
      state: "ACTIVE",
      created_at: new Date().toISOString(),

      // STEP 8.1 — Soft device tagging (nullable)
      device_id: device?.device_id ?? null,
      device_summary: device?.device_summary ?? null,
    });

  if (insertError) {
    throw new Error("SESSION_CREATE_FAILED");
  }

  return sessionId;
}
