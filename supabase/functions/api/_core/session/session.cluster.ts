/*
 * File-ID: 3.10B
 * File-Path: supabase/functions/api/_core/session/session.cluster.ts
 * Gate: 3
 * Phase: 3
 * Domain: SESSION
 * Purpose: Backend authority helpers for session-cluster lifecycle, admission, and controlled multi-window expansion.
 * Authority: Backend
 */

import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { assertRlsEnabled } from "../../_shared/rls_assert.ts";
import {
  SESSION_CLUSTER_MAX_WINDOWS,
  SESSION_CLUSTER_STATE,
  SESSION_CLUSTER_WINDOW_STATE,
} from "./session.cluster.types.ts";

type ClusterTerminationState =
  | SESSION_CLUSTER_STATE.REVOKED
  | SESSION_CLUSTER_STATE.REPLACED
  | SESSION_CLUSTER_STATE.EXPIRED
  | SESSION_CLUSTER_STATE.CLOSED;

type WindowTerminationState =
  | SESSION_CLUSTER_WINDOW_STATE.REVOKED
  | SESSION_CLUSTER_WINDOW_STATE.EXPIRED
  | SESSION_CLUSTER_WINDOW_STATE.CLOSED;

interface CreateClusterArgs {
  authUserId: string;
  sessionId: string;
  expiresAtIso: string;
}

interface ReplaceClusterArgs {
  clusterIds: string[];
  replacedByClusterId: string;
  replacedAtIso?: string;
}

interface TerminateClusterArgs {
  clusterId: string;
  clusterStatus: ClusterTerminationState;
  windowStatus: WindowTerminationState;
  sessionStatus?: "REVOKED" | "EXPIRED" | "IDLE";
  reason: string;
  actedByAuthUserId?: string | null;
  replacedByClusterId?: string | null;
  atIso?: string;
}

interface ClusterWindowAdmissionArgs {
  clusterId: string;
  sessionId: string;
  windowInstanceId: string;
  joinToken?: string | null;
}

interface IssueJoinTicketArgs {
  clusterId: string;
  windowToken: string;
}

interface CloseWindowArgs {
  clusterId: string;
  windowToken: string;
  reason?: string;
}

export interface ClusterWindowAdmission {
  clusterId: string;
  clusterWindowId: string;
  windowToken: string;
  windowSlot: number;
  maxWindowCount: number;
}

function nowIso() {
  return new Date().toISOString();
}

function nextAvailableWindowSlot(usedSlots: number[]): number | null {
  for (let slot = 1; slot <= SESSION_CLUSTER_MAX_WINDOWS; slot += 1) {
    if (!usedSlots.includes(slot)) {
      return slot;
    }
  }

  return null;
}

async function requireActiveCluster(clusterId: string) {
  const { data, error } = await serviceRoleClient
    .schema("erp_core")
    .from("session_clusters")
    .select("cluster_id, auth_user_id, status, max_window_count")
    .eq("cluster_id", clusterId)
    .maybeSingle();

  if (error || !data || data.status !== SESSION_CLUSTER_STATE.ACTIVE) {
    throw new Error("SESSION_CLUSTER_NOT_ACTIVE");
  }

  return data;
}

export async function createSessionCluster(
  args: CreateClusterArgs
): Promise<string> {
  assertRlsEnabled();

  const { data, error } = await serviceRoleClient
    .schema("erp_core")
    .from("session_clusters")
    .insert({
      auth_user_id: args.authUserId,
      root_session_id: args.sessionId,
      status: SESSION_CLUSTER_STATE.ACTIVE,
      expires_at: args.expiresAtIso,
      max_window_count: SESSION_CLUSTER_MAX_WINDOWS,
    })
    .select("cluster_id")
    .single();

  if (error || !data?.cluster_id) {
    throw new Error("SESSION_CLUSTER_CREATE_FAILED");
  }

  return data.cluster_id;
}

export async function replaceActiveClustersForFreshLogin(
  args: ReplaceClusterArgs
): Promise<void> {
  assertRlsEnabled();

  const replacedAt = args.replacedAtIso ?? nowIso();

  if (args.clusterIds.length === 0) {
    return;
  }

  const { error: clusterUpdateError } = await serviceRoleClient
    .schema("erp_core")
    .from("session_clusters")
    .update({
      status: SESSION_CLUSTER_STATE.REPLACED,
      replaced_at: replacedAt,
      replaced_by_cluster_id: args.replacedByClusterId,
    })
    .in("cluster_id", args.clusterIds);

  if (clusterUpdateError) {
    throw new Error("SESSION_CLUSTER_REPLACE_FAILED");
  }

  const { error: windowUpdateError } = await serviceRoleClient
    .schema("erp_core")
    .from("session_cluster_windows")
    .update({
      status: SESSION_CLUSTER_WINDOW_STATE.REVOKED,
      revoked_at: replacedAt,
      revoked_reason: "REPLACED_BY_NEW_LOGIN",
    })
    .in("cluster_id", args.clusterIds)
    .eq("status", SESSION_CLUSTER_WINDOW_STATE.ADMITTED);

  if (windowUpdateError) {
    throw new Error("SESSION_CLUSTER_WINDOW_REPLACE_FAILED");
  }
}

export async function prepareActiveClustersForFreshLogin(
  authUserId: string,
  replacedAtIso?: string
): Promise<string[]> {
  assertRlsEnabled();

  const replacedAt = replacedAtIso ?? nowIso();
  const { data: activeRows, error: readError } = await serviceRoleClient
    .schema("erp_core")
    .from("session_clusters")
    .select("cluster_id")
    .eq("auth_user_id", authUserId)
    .eq("status", SESSION_CLUSTER_STATE.ACTIVE);

  if (readError) {
    throw new Error("SESSION_CLUSTER_REPLACE_READ_FAILED");
  }

  const clusterIds = (activeRows ?? [])
    .map((row) => row.cluster_id)
    .filter((value): value is string => typeof value === "string");

  if (clusterIds.length === 0) {
    return [];
  }

  const { error: clusterUpdateError } = await serviceRoleClient
    .schema("erp_core")
    .from("session_clusters")
    .update({
      status: SESSION_CLUSTER_STATE.REPLACED,
      replaced_at: replacedAt,
      replaced_by_cluster_id: null,
    })
    .in("cluster_id", clusterIds)
    .eq("status", SESSION_CLUSTER_STATE.ACTIVE);

  if (clusterUpdateError) {
    throw new Error("SESSION_CLUSTER_PREPARE_REPLACE_FAILED");
  }

  const { error: windowUpdateError } = await serviceRoleClient
    .schema("erp_core")
    .from("session_cluster_windows")
    .update({
      status: SESSION_CLUSTER_WINDOW_STATE.REVOKED,
      revoked_at: replacedAt,
      revoked_reason: "REPLACED_BY_NEW_LOGIN",
    })
    .in("cluster_id", clusterIds)
    .eq("status", SESSION_CLUSTER_WINDOW_STATE.ADMITTED);

  if (windowUpdateError) {
    throw new Error("SESSION_CLUSTER_WINDOW_PREPARE_REPLACE_FAILED");
  }

  return clusterIds;
}

export async function terminateSessionCluster(
  args: TerminateClusterArgs
): Promise<void> {
  assertRlsEnabled();

  const atIso = args.atIso ?? nowIso();
  const clusterPatch: Record<string, unknown> = {
    status: args.clusterStatus,
    last_seen_at: atIso,
  };

  if (args.clusterStatus === SESSION_CLUSTER_STATE.REPLACED) {
    clusterPatch.replaced_at = atIso;
    clusterPatch.replaced_by_cluster_id = args.replacedByClusterId ?? null;
  }

  if (
    args.clusterStatus === SESSION_CLUSTER_STATE.REVOKED ||
    args.clusterStatus === SESSION_CLUSTER_STATE.EXPIRED
  ) {
    clusterPatch.revoked_at = atIso;
    clusterPatch.revoked_reason = args.reason;
  }

  if (args.clusterStatus === SESSION_CLUSTER_STATE.CLOSED) {
    clusterPatch.closed_at = atIso;
  }

  const { error: clusterError } = await serviceRoleClient
    .schema("erp_core")
    .from("session_clusters")
    .update(clusterPatch)
    .eq("cluster_id", args.clusterId)
    .eq("status", SESSION_CLUSTER_STATE.ACTIVE);

  if (clusterError) {
    throw new Error("SESSION_CLUSTER_TERMINATION_FAILED");
  }

  const windowPatch: Record<string, unknown> = {
    status: args.windowStatus,
  };

  if (args.windowStatus === SESSION_CLUSTER_WINDOW_STATE.CLOSED) {
    windowPatch.closed_at = atIso;
    windowPatch.close_reason = args.reason;
  } else {
    windowPatch.revoked_at = atIso;
    windowPatch.revoked_reason = args.reason;
  }

  const { error: windowError } = await serviceRoleClient
    .schema("erp_core")
    .from("session_cluster_windows")
    .update(windowPatch)
    .eq("cluster_id", args.clusterId)
    .eq("status", SESSION_CLUSTER_WINDOW_STATE.ADMITTED);

  if (windowError) {
    throw new Error("SESSION_CLUSTER_WINDOW_TERMINATION_FAILED");
  }

  if (!args.sessionStatus) {
    return;
  }

  const sessionPatch: Record<string, unknown> = {
    status: args.sessionStatus,
    revoked_at: atIso,
    revoked_reason: args.reason,
  };

  if (args.actedByAuthUserId) {
    sessionPatch.revoked_by = args.actedByAuthUserId;
  }

  const { error: sessionError } = await serviceRoleClient
    .schema("erp_core")
    .from("sessions")
    .update(sessionPatch)
    .eq("cluster_id", args.clusterId)
    .eq("status", "ACTIVE");

  if (sessionError) {
    throw new Error("SESSION_CLUSTER_SESSION_TERMINATION_FAILED");
  }
}

export async function issueSessionClusterJoinTicket(
  args: IssueJoinTicketArgs
): Promise<string> {
  assertRlsEnabled();

  await requireActiveCluster(args.clusterId);

  const { data: issuingWindow, error: issuingWindowError } = await serviceRoleClient
    .schema("erp_core")
    .from("session_cluster_windows")
    .select("cluster_window_id")
    .eq("cluster_id", args.clusterId)
    .eq("window_token", args.windowToken)
    .eq("status", SESSION_CLUSTER_WINDOW_STATE.ADMITTED)
    .maybeSingle();

  if (issuingWindowError || !issuingWindow?.cluster_window_id) {
    throw new Error("SESSION_CLUSTER_WINDOW_NOT_ADMITTED");
  }

  const { count, error: countError } = await serviceRoleClient
    .schema("erp_core")
    .from("session_cluster_windows")
    .select("cluster_window_id", { count: "exact", head: true })
    .eq("cluster_id", args.clusterId)
    .eq("status", SESSION_CLUSTER_WINDOW_STATE.ADMITTED);

  if (countError) {
    throw new Error("SESSION_CLUSTER_WINDOW_COUNT_FAILED");
  }

  if ((count ?? 0) >= SESSION_CLUSTER_MAX_WINDOWS) {
    throw new Error("SESSION_CLUSTER_MAX_WINDOWS_EXCEEDED");
  }

  const expiresAtIso = new Date(Date.now() + 60 * 1000).toISOString();

  const { data, error } = await serviceRoleClient
    .schema("erp_core")
    .from("session_cluster_join_tickets")
    .insert({
      cluster_id: args.clusterId,
      issued_by_window_id: issuingWindow.cluster_window_id,
      expires_at: expiresAtIso,
    })
    .select("join_token")
    .single();

  if (error || !data?.join_token) {
    throw new Error("SESSION_CLUSTER_JOIN_TICKET_CREATE_FAILED");
  }

  return data.join_token;
}

export async function admitSessionClusterWindow(
  args: ClusterWindowAdmissionArgs
): Promise<ClusterWindowAdmission> {
  assertRlsEnabled();

  const cluster = await requireActiveCluster(args.clusterId);
  const currentIso = nowIso();

  const { data: existingWindow, error: existingError } = await serviceRoleClient
    .schema("erp_core")
    .from("session_cluster_windows")
    .select("cluster_window_id, window_token, window_slot, status")
    .eq("cluster_id", args.clusterId)
    .eq("window_instance_id", args.windowInstanceId)
    .maybeSingle();

  if (existingError) {
    throw new Error("SESSION_CLUSTER_WINDOW_LOOKUP_FAILED");
  }

  if (existingWindow?.status === SESSION_CLUSTER_WINDOW_STATE.ADMITTED) {
    return {
      clusterId: args.clusterId,
      clusterWindowId: existingWindow.cluster_window_id,
      windowToken: existingWindow.window_token,
      windowSlot: existingWindow.window_slot,
      maxWindowCount: cluster.max_window_count ?? SESSION_CLUSTER_MAX_WINDOWS,
    };
  }

  let joinTicketId: string | null = null;

  if (args.joinToken) {
    const { data: joinTicket, error: joinError } = await serviceRoleClient
      .schema("erp_core")
      .from("session_cluster_join_tickets")
      .select("join_token")
      .eq("join_token", args.joinToken)
      .eq("cluster_id", args.clusterId)
      .is("consumed_at", null)
      .gt("expires_at", currentIso)
      .maybeSingle();

    if (joinError || !joinTicket?.join_token) {
      throw new Error("SESSION_CLUSTER_JOIN_TICKET_INVALID");
    }

    joinTicketId = joinTicket.join_token;
  }

  const { data: admittedRows, error: admittedError } = await serviceRoleClient
    .schema("erp_core")
    .from("session_cluster_windows")
    .select("window_slot")
    .eq("cluster_id", args.clusterId)
    .eq("status", SESSION_CLUSTER_WINDOW_STATE.ADMITTED);

  if (admittedError) {
    throw new Error("SESSION_CLUSTER_ADMISSION_LOOKUP_FAILED");
  }

  const admittedSlots = (admittedRows ?? [])
    .map((row) => row.window_slot)
    .filter((value): value is number => typeof value === "number");

  const availableSlot = existingWindow?.window_slot && !admittedSlots.includes(existingWindow.window_slot)
    ? existingWindow.window_slot
    : nextAvailableWindowSlot(admittedSlots);

  if (availableSlot == null) {
    throw new Error("SESSION_CLUSTER_MAX_WINDOWS_EXCEEDED");
  }

  if (!args.joinToken && admittedSlots.length > 0 && !existingWindow) {
    throw new Error("SESSION_CLUSTER_JOIN_REQUIRED");
  }

  const mutation = {
    session_id: args.sessionId,
    cluster_id: args.clusterId,
    window_instance_id: args.windowInstanceId,
    window_slot: availableSlot,
    status: SESSION_CLUSTER_WINDOW_STATE.ADMITTED,
    admitted_at: currentIso,
    last_seen_at: currentIso,
    closed_at: null,
    close_reason: null,
    revoked_at: null,
    revoked_reason: null,
  };

  const { data: admittedWindow, error: admitError } = existingWindow
    ? await serviceRoleClient
        .schema("erp_core")
        .from("session_cluster_windows")
        .update(mutation)
        .eq("cluster_window_id", existingWindow.cluster_window_id)
        .select("cluster_window_id, window_token, window_slot")
        .single()
    : await serviceRoleClient
        .schema("erp_core")
        .from("session_cluster_windows")
        .insert(mutation)
        .select("cluster_window_id, window_token, window_slot")
        .single();

  if (admitError || !admittedWindow?.cluster_window_id) {
    throw new Error("SESSION_CLUSTER_ADMISSION_FAILED");
  }

  if (joinTicketId) {
    const { error: consumeError } = await serviceRoleClient
      .schema("erp_core")
      .from("session_cluster_join_tickets")
      .update({
        consumed_at: currentIso,
        consumed_by_window_id: admittedWindow.cluster_window_id,
      })
      .eq("join_token", joinTicketId)
      .is("consumed_at", null);

    if (consumeError) {
      throw new Error("SESSION_CLUSTER_JOIN_TICKET_CONSUME_FAILED");
    }
  }

  await serviceRoleClient
    .schema("erp_core")
    .from("session_clusters")
    .update({ last_seen_at: currentIso })
    .eq("cluster_id", args.clusterId);

  return {
    clusterId: args.clusterId,
    clusterWindowId: admittedWindow.cluster_window_id,
    windowToken: admittedWindow.window_token,
    windowSlot: admittedWindow.window_slot,
    maxWindowCount: cluster.max_window_count ?? SESSION_CLUSTER_MAX_WINDOWS,
  };
}

export async function closeSessionClusterWindow(
  args: CloseWindowArgs
): Promise<void> {
  assertRlsEnabled();

  const closeReason = args.reason ?? "WINDOW_CLOSED";

  const { error } = await serviceRoleClient
    .schema("erp_core")
    .from("session_cluster_windows")
    .update({
      status: SESSION_CLUSTER_WINDOW_STATE.CLOSED,
      closed_at: nowIso(),
      close_reason: closeReason,
    })
    .eq("cluster_id", args.clusterId)
    .eq("window_token", args.windowToken)
    .eq("status", SESSION_CLUSTER_WINDOW_STATE.ADMITTED);

  if (error) {
    throw new Error("SESSION_CLUSTER_WINDOW_CLOSE_FAILED");
  }
}

export async function touchSessionClusterWindow(
  clusterId: string,
  windowToken: string
): Promise<void> {
  assertRlsEnabled();

  const currentIso = nowIso();

  await serviceRoleClient
    .schema("erp_core")
    .from("session_clusters")
    .update({ last_seen_at: currentIso })
    .eq("cluster_id", clusterId)
    .eq("status", SESSION_CLUSTER_STATE.ACTIVE);

  await serviceRoleClient
    .schema("erp_core")
    .from("session_cluster_windows")
    .update({ last_seen_at: currentIso })
    .eq("cluster_id", clusterId)
    .eq("window_token", windowToken)
    .eq("status", SESSION_CLUSTER_WINDOW_STATE.ADMITTED);
}
