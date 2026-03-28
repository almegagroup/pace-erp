/*
 * File-ID: 2.2C
 * File-Path: supabase/functions/api/_pipeline/session.ts
 * Gate: 2
 * Phase: 2
 * Domain: SESSION
 * Purpose: Session lookup + bind invariant enforcement with session-cluster validation.
 * Authority: Backend
 */

import { serviceRoleClient } from "../_shared/serviceRoleClient.ts";
import { assertRlsEnabled } from "../_shared/rls_assert.ts";
import { log } from "../_lib/logger.ts";
import { recordSessionTimeline } from "../_core/session/session_timeline.ts";
import { recordSecurityEvent } from "../_security/security_events.ts";

export type SessionResolution =
  | { status: "ABSENT"; action: "LOGOUT" }
  | {
      status: "ACTIVE";
      sessionId: string;
      authUserId: string;
      roleCode: string;
      clusterId: string | null;
      clusterWindowToken: string | null;
      created_at: string;
      last_seen_at: string;
      expires_at: string;
    }
  | { status: "REVOKED"; action: "LOGOUT" }
  | { status: "EXPIRED"; action: "LOGOUT" };

function readCookie(req: Request, name: string): string | null {
  const cookie = req.headers.get("cookie");
  if (!cookie) return null;

  const parts = cookie.split(";").map((part) => part.trim());
  for (const part of parts) {
    if (part.startsWith(`${name}=`)) {
      return part.slice(name.length + 1);
    }
  }

  return null;
}

function readHeader(req: Request, name: string): string | null {
  const raw = req.headers.get(name);
  if (!raw) return null;

  const value = raw.trim();
  return value.length > 0 ? value : null;
}

export async function stepSession(
  req: Request,
  requestId: string
): Promise<SessionResolution> {
  const sessionId = readCookie(req, "erp_session");
  const clusterWindowToken = readHeader(req, "x-erp-window-token");

  if (!sessionId) {
    log({
      level: "OBSERVABILITY",
      request_id: requestId,
      event: "SESSION_ABSENT",
    });
    recordSecurityEvent(req, requestId, "SESSION_COOKIE_MISSING", "SESSION");

    return { status: "ABSENT", action: "LOGOUT" };
  }

  assertRlsEnabled();

  const { data, error } = await serviceRoleClient
    .schema("erp_core")
    .from("sessions")
    .select(
      "session_id, auth_user_id, role_code, status, cluster_id, created_at, last_seen_at, expires_at"
    )
    .eq("session_id", sessionId)
    .single();

  if (error || !data) {
    log({
      level: "OBSERVABILITY",
      request_id: requestId,
      event: "SESSION_REVOKED",
      meta: { session_id: sessionId },
    });
    recordSecurityEvent(req, requestId, "SESSION_REVOKED", "SESSION");

    return { status: "REVOKED", action: "LOGOUT" };
  }

  if (data.status === "REVOKED") {
    recordSecurityEvent(req, requestId, "SESSION_REVOKED", "SESSION");
    return { status: "REVOKED", action: "LOGOUT" };
  }

  if (
    data.status === "EXPIRED" ||
    data.status === "DEAD" ||
    data.status === "IDLE" ||
    data.status === "CREATED"
  ) {
    return { status: "EXPIRED", action: "LOGOUT" };
  }

  if (data.cluster_id) {
    const { data: clusterRow, error: clusterError } = await serviceRoleClient
      .schema("erp_core")
      .from("session_clusters")
      .select("cluster_id, status")
      .eq("cluster_id", data.cluster_id)
      .maybeSingle();

    if (
      clusterError ||
      !clusterRow ||
      clusterRow.status !== "ACTIVE"
    ) {
      recordSecurityEvent(req, requestId, "SESSION_CLUSTER_INVALID", "SESSION");
      return { status: "REVOKED", action: "LOGOUT" };
    }

    if (clusterWindowToken) {
      const { data: clusterWindow, error: clusterWindowError } =
        await serviceRoleClient
          .schema("erp_core")
          .from("session_cluster_windows")
          .select("cluster_window_id")
          .eq("cluster_id", data.cluster_id)
          .eq("window_token", clusterWindowToken)
          .eq("status", "ADMITTED")
          .maybeSingle();

      if (clusterWindowError || !clusterWindow?.cluster_window_id) {
        recordSecurityEvent(
          req,
          requestId,
          "SESSION_CLUSTER_WINDOW_INVALID",
          "SESSION"
        );
        return { status: "REVOKED", action: "LOGOUT" };
      }
    }
  }

  log({
    level: "OBSERVABILITY",
    request_id: requestId,
    event: "SESSION_ACTIVE",
    meta: { session_id: sessionId },
  });

  recordSessionTimeline({
    requestId,
    sessionId,
    userId: data.auth_user_id,
    event: "ACTIVE",
  });

  const { data: userRow } = await serviceRoleClient
    .schema("erp_core")
    .from("users")
    .select("user_code")
    .eq("auth_user_id", data.auth_user_id)
    .single();

  const userCode = userRow?.user_code || "";
  let roleCode = data.role_code;

  if (userCode.startsWith("SA")) {
    roleCode = "SA";
  } else if (userCode.startsWith("GA")) {
    roleCode = "GA";
  } else if (!roleCode) {
    log({
      level: "SECURITY",
      request_id: requestId,
      event: "ROLE_MISSING_DENY",
      meta: { session_id: sessionId },
    });

    return { status: "REVOKED", action: "LOGOUT" };
  }

  return {
    status: "ACTIVE",
    sessionId,
    authUserId: data.auth_user_id,
    roleCode,
    clusterId: data.cluster_id ?? null,
    clusterWindowToken,
    created_at: data.created_at,
    last_seen_at: data.last_seen_at,
    expires_at: data.expires_at,
  };
}
