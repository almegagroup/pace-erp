/*
 * File-ID: 3.10C
 * File-Path: supabase/functions/api/_core/session/session.cluster.handler.ts
 * Gate: 3
 * Phase: 3
 * Domain: SESSION
 * Purpose: Protected handlers for governed session-cluster admission and multi-window expansion.
 * Authority: Backend
 */

import { okResponse, errorResponse } from "../response.ts";
import type { SessionResolution } from "../../_pipeline/session.ts";
import {
  admitSessionClusterWindow,
  closeSessionClusterWindow,
  issueSessionClusterJoinTicket,
} from "./session.cluster.ts";

interface SessionClusterHandlerContext {
  session: Extract<SessionResolution, { status: "ACTIVE" }>;
  requestId: string;
  req: Request;
}

export async function admitSessionClusterWindowHandler(
  ctx: SessionClusterHandlerContext
): Promise<Response> {
  const { session, requestId, req } = ctx;
  const body = await req.json().catch(() => null);
  const windowInstanceId = body?.window_instance_id;
  const joinToken = body?.join_token ?? null;

  if (!session.clusterId) {
    return errorResponse(
      "SESSION_CLUSTER_MISSING",
      "Session cluster missing",
      requestId,
      "NONE",
      403,
      undefined,
      req
    );
  }

  if (!windowInstanceId || typeof windowInstanceId !== "string") {
    return errorResponse(
      "SESSION_CLUSTER_WINDOW_INSTANCE_REQUIRED",
      "Window instance is required",
      requestId,
      "NONE",
      400,
      undefined,
      req
    );
  }

  try {
    const admitted = await admitSessionClusterWindow({
      clusterId: session.clusterId,
      sessionId: session.sessionId,
      windowInstanceId,
      joinToken,
    });

    return okResponse(
      {
        cluster_id: admitted.clusterId,
        cluster_window_id: admitted.clusterWindowId,
        window_token: admitted.windowToken,
        window_slot: admitted.windowSlot,
        max_window_count: admitted.maxWindowCount,
      },
      requestId,
      req
    );
  } catch (error) {
    return errorResponse(
      "SESSION_CLUSTER_ADMISSION_BLOCKED",
      error instanceof Error ? error.message : "Admission blocked",
      requestId,
      "NONE",
      403,
      undefined,
      req
    );
  }
}

export async function issueSessionClusterJoinTicketHandler(
  ctx: SessionClusterHandlerContext
): Promise<Response> {
  const { session, requestId, req } = ctx;

  if (!session.clusterId || !session.clusterWindowToken) {
    return errorResponse(
      "SESSION_CLUSTER_WINDOW_NOT_ADMITTED",
      "Current window is not admitted",
      requestId,
      "NONE",
      403,
      undefined,
      req
    );
  }

  try {
    const joinToken = await issueSessionClusterJoinTicket({
      clusterId: session.clusterId,
      windowToken: session.clusterWindowToken,
    });

    return okResponse(
      {
        join_token: joinToken,
        cluster_id: session.clusterId,
      },
      requestId,
      req
    );
  } catch (error) {
    return errorResponse(
      "SESSION_CLUSTER_OPEN_WINDOW_BLOCKED",
      error instanceof Error ? error.message : "Open window blocked",
      requestId,
      "NONE",
      403,
      undefined,
      req
    );
  }
}

export async function closeSessionClusterWindowHandler(
  ctx: SessionClusterHandlerContext
): Promise<Response> {
  const { session, requestId, req } = ctx;
  const body = await req.json().catch(() => null);
  const closeReason =
    typeof body?.reason === "string" && body.reason.trim().length > 0
      ? body.reason.trim()
      : "WINDOW_CLOSED";

  if (!session.clusterId || !session.clusterWindowToken) {
    return okResponse({ closed: false }, requestId, req);
  }

  try {
    await closeSessionClusterWindow({
      clusterId: session.clusterId,
      windowToken: session.clusterWindowToken,
      reason: closeReason,
    });

    return okResponse({ closed: true }, requestId, req);
  } catch {
    return okResponse({ closed: false }, requestId, req);
  }
}
