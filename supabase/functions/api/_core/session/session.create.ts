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
import {
  createSessionCluster,
  prepareActiveClustersForFreshLogin,
  replaceActiveClustersForFreshLogin,
} from "./session.cluster.ts";

export async function createSession(
  authUserId: string,
  roleCode: string,
  selectedCompanyId: string | null,
  selectedWorkContextId: string | null,
  device?: {
    device_id: string;
    device_summary: string;
  },
  workspaceMode?: "SINGLE" | "MULTI" | null,
): Promise<{ sessionId: string; clusterId: string }> {
  assertRlsEnabled();

  if (!roleCode || typeof roleCode !== "string") {
    throw new Error("INVALID_ROLE_CODE");
  }

  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const expiresIso = new Date(now + 12 * 60 * 60 * 1000).toISOString();
  const replacedClusterIds = await prepareActiveClustersForFreshLogin(
    authUserId,
    nowIso,
  );

  const { error: revokeError } = await serviceRoleClient
    .schema("erp_core")
    .from("sessions")
    .update({
      status: "REVOKED",
      revoked_at: nowIso,
      revoked_reason: "NEW_LOGIN",
      revoked_by: authUserId,
    })
    .eq("auth_user_id", authUserId)
    .eq("status", "ACTIVE");

  if (revokeError) {
    console.error("SESSION_REVOKE_FAILED", revokeError);
    throw new Error("SESSION_REVOKE_FAILED");
  }

  const { error: snapshotDeleteError } = await serviceRoleClient
    .schema("erp_cache")
    .from("session_menu_snapshot")
    .delete()
    .eq("auth_user_id", authUserId);

  if (snapshotDeleteError) {
    console.error("SNAPSHOT_DELETE_FAILED", snapshotDeleteError);
    throw new Error("SNAPSHOT_DELETE_FAILED");
  }

  const sessionId = crypto.randomUUID();

  if (!sessionId) {
    throw new Error("SESSION_ID_GENERATION_FAILED");
  }

  const { error: insertError } = await serviceRoleClient
    .schema("erp_core")
    .from("sessions")
    .insert({
      session_id: sessionId,
      auth_user_id: authUserId,
      role_code: roleCode,
      selected_company_id: selectedCompanyId,
      selected_work_context_id: selectedWorkContextId,
      workspace_mode: workspaceMode ?? null,
      status: "ACTIVE",
      created_at: nowIso,
      last_seen_at: nowIso,
      expires_at: expiresIso,
      device_id: device?.device_id ?? null,
      device_summary: device?.device_summary ?? null,
    });

  if (insertError) {
    console.error("SESSION_CREATE_FAILED", insertError);
    throw new Error("SESSION_CREATE_FAILED");
  }

  const clusterId = await createSessionCluster({
    authUserId,
    sessionId,
    expiresAtIso: expiresIso,
  });

  const { error: sessionClusterLinkError } = await serviceRoleClient
    .schema("erp_core")
    .from("sessions")
    .update({
      cluster_id: clusterId,
    })
    .eq("session_id", sessionId);

  if (sessionClusterLinkError) {
    console.error("SESSION_CLUSTER_LINK_FAILED", sessionClusterLinkError);
    throw new Error("SESSION_CLUSTER_LINK_FAILED");
  }

  await replaceActiveClustersForFreshLogin({
    clusterIds: replacedClusterIds,
    replacedByClusterId: clusterId,
    replacedAtIso: nowIso,
  });

  return {
    sessionId,
    clusterId,
  };
}
