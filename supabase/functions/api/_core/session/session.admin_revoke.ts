/*
 * File-ID: ID-3.4-ADMIN-REVOKE
 * File-Path: supabase/functions/api/_core/session/session.admin_revoke.ts
 * Gate: 3
 * Phase: 3
 * Domain: SESSION
 * Purpose: Admin force revoke of all ERP sessions and session clusters of a user.
 * Authority: Backend (SA only)
 */

import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { assertRlsEnabled } from "../../_shared/rls_assert.ts";
import { recordSessionTimeline } from "./session_timeline.ts";
import { terminateSessionCluster } from "./session.cluster.ts";
import {
  SESSION_CLUSTER_STATE,
  SESSION_CLUSTER_WINDOW_STATE,
} from "./session.cluster.types.ts";

export async function adminForceRevokeSessions(
  targetAuthUserId: string,
  revokedByAuthUserId: string
): Promise<void> {
  assertRlsEnabled();

  const { data: activeClusters, error: clusterReadError } = await serviceRoleClient
    .schema("erp_core")
    .from("session_clusters")
    .select("cluster_id")
    .eq("auth_user_id", targetAuthUserId)
    .eq("status", "ACTIVE");

  if (clusterReadError) {
    throw new Error("ADMIN_SESSION_CLUSTER_READ_FAILED");
  }

  for (const row of activeClusters ?? []) {
    if (!row.cluster_id) continue;

    await terminateSessionCluster({
      clusterId: row.cluster_id,
      clusterStatus: SESSION_CLUSTER_STATE.REVOKED,
      windowStatus: SESSION_CLUSTER_WINDOW_STATE.REVOKED,
      sessionStatus: "REVOKED",
      reason: "ADMIN_FORCE_REVOKE",
      actedByAuthUserId: revokedByAuthUserId,
    });
  }

  const { error } = await serviceRoleClient
    .schema("erp_core")
    .from("sessions")
    .update({
      status: "REVOKED",
      revoked_at: new Date().toISOString(),
      revoked_reason: "ADMIN_FORCE_REVOKE",
      revoked_by: revokedByAuthUserId,
    })
    .eq("auth_user_id", targetAuthUserId)
    .eq("status", "ACTIVE");

  recordSessionTimeline({
    requestId: "SYSTEM_ADMIN",
    userId: targetAuthUserId,
    event: "REVOKE",
  });

  if (error) {
    throw new Error("ADMIN_SESSION_REVOKE_FAILED");
  }
}
