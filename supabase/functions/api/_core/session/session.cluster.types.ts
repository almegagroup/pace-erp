/*
 * File-ID: 3.10A
 * File-Path: supabase/functions/api/_core/session/session.cluster.types.ts
 * Gate: 3
 * Phase: 3
 * Domain: SESSION
 * Purpose: Typed authority contract for backend-authoritative session clusters and governed window slots.
 * Authority: Backend
 */

export const SESSION_CLUSTER_MAX_WINDOWS = 3 as const;

export enum SESSION_CLUSTER_STATE {
  ACTIVE = "ACTIVE",
  REPLACED = "REPLACED",
  REVOKED = "REVOKED",
  EXPIRED = "EXPIRED",
  CLOSED = "CLOSED",
}

export enum SESSION_CLUSTER_WINDOW_STATE {
  ADMITTED = "ADMITTED",
  CLOSED = "CLOSED",
  REVOKED = "REVOKED",
  EXPIRED = "EXPIRED",
}

export const SESSION_CLUSTER_SYNC_EVENTS = [
  "IDLE_WARNING",
  "WARNING_ACKNOWLEDGED",
  "LOCK",
  "UNLOCK",
  "LOGOUT",
  "REVOKE",
  "EXPIRED",
  "REPLACED_BY_NEW_LOGIN",
] as const;

export type SessionClusterSyncEvent =
  (typeof SESSION_CLUSTER_SYNC_EVENTS)[number];
