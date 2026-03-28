/*
 * File-ID: 1A
 * File-Path: supabase/functions/api/_pipeline/runner.ts
 * Gate: 1
 * Phase: 1
 * Domain: BACKEND
 * Purpose: Execute request pipeline in locked order
 * Authority: Backend
 */

import { stepHeaders } from "./step_headers.ts";
import { stepCors } from "./cors.ts";
import { stepCsrf } from "./csrf.ts";
import { stepRateLimit } from "./rate_limit.ts";
import { stepSession } from "./session.ts";
import { enforceIdleLifecycle } from "./session_lifecycle.ts";
import { stepContext } from "./context.ts";
import { stepAcl } from "./acl.ts";

import { serviceRoleClient } from "../_shared/serviceRoleClient.ts";
import { dispatchProtectedRoute } from "./protected_routes.dispatch.ts";
import { dispatchPublicRoute } from "./public_routes.dispatch.ts";
import { errorResponse } from "../_core/response.ts";
import {
  terminateSessionCluster,
  touchSessionClusterWindow,
} from "../_core/session/session.cluster.ts";
import {
  SESSION_CLUSTER_STATE,
  SESSION_CLUSTER_WINDOW_STATE,
} from "../_core/session/session.cluster.types.ts";

import { log } from "../_lib/logger.ts";

import type { SessionResolution } from "./session.ts";
import type { ContextResolution } from "./context.ts";

/**
 * SESSION logout enforcement
 */
function isPassiveSessionProbe(req: Request): boolean {
  const url = new URL(req.url);
  return url.searchParams.get("session_mode") === "passive";
}

function enforceSessionLogout(
  result: { action?: string } | null,
  requestId: string
): Response | null {
 if (result?.action === "LOGOUT") {
  return errorResponse(
    "SESSION_LOGOUT",
    "Session expired",
    requestId,
    "LOGOUT",
    401,
  );
}
  return null;
}

async function persistLifecycleTermination(
  session: SessionResolution | null,
  lifecycleResult: { status?: string } | null
): Promise<void> {
  if (!session || session.status !== "ACTIVE" || !lifecycleResult?.status) {
    return;
  }

  const nowIso = new Date().toISOString();

  if (lifecycleResult.status === "IDLE_EXPIRED") {
    if (session.clusterId) {
      await terminateSessionCluster({
        clusterId: session.clusterId,
        clusterStatus: SESSION_CLUSTER_STATE.EXPIRED,
        windowStatus: SESSION_CLUSTER_WINDOW_STATE.EXPIRED,
        sessionStatus: "IDLE",
        reason: "IDLE_TIMEOUT",
        actedByAuthUserId: session.authUserId,
        atIso: nowIso,
      });
      return;
    }

    await serviceRoleClient
      .schema("erp_core")
      .from("sessions")
      .update({
        status: "IDLE",
        revoked_at: nowIso,
        revoked_reason: "IDLE_TIMEOUT",
      })
      .eq("session_id", session.sessionId)
      .eq("status", "ACTIVE");
    return;
  }

  if (lifecycleResult.status === "TTL_EXPIRED") {
    if (session.clusterId) {
      await terminateSessionCluster({
        clusterId: session.clusterId,
        clusterStatus: SESSION_CLUSTER_STATE.EXPIRED,
        windowStatus: SESSION_CLUSTER_WINDOW_STATE.EXPIRED,
        sessionStatus: "EXPIRED",
        reason: "TTL_EXPIRED",
        actedByAuthUserId: session.authUserId,
        atIso: nowIso,
      });
      return;
    }

    await serviceRoleClient
      .schema("erp_core")
      .from("sessions")
      .update({
        status: "EXPIRED",
        revoked_at: nowIso,
        revoked_reason: "TTL_EXPIRED",
      })
      .eq("session_id", session.sessionId)
      .eq("status", "ACTIVE");
  }
}

export async function runPipeline(
  req: Request,
  requestId: string
): Promise<Response> {

  // --------------------------------------------------
  // Pre-flight steps (always)
  // --------------------------------------------------

  log({
    level: "OBSERVABILITY",
    request_id: requestId,
    gate_id: "10.5",
    event: "PIPELINE_STAGE",
    meta: { stage: "HEADERS" },
  });
  await stepHeaders(req, requestId);

  log({
    level: "OBSERVABILITY",
    request_id: requestId,
    gate_id: "10.5",
    event: "PIPELINE_STAGE",
    meta: { stage: "CORS" },
  });
  await stepCors(req, requestId);

  log({
    level: "OBSERVABILITY",
    request_id: requestId,
    gate_id: "10.5",
    event: "PIPELINE_STAGE",
    meta: { stage: "CSRF" },
  });
  await stepCsrf(req, requestId);

  log({
    level: "OBSERVABILITY",
    request_id: requestId,
    gate_id: "10.5",
    event: "PIPELINE_STAGE",
    meta: { stage: "RATE_LIMIT" },
  });
  await stepRateLimit(req, requestId);

  // --------------------------------------------------
  // Route detection
  // --------------------------------------------------

  const url = new URL(req.url);
  const routeKey = `${req.method}:${url.pathname}`;

  const PUBLIC_ROUTES = new Set([
    "POST:/api/login",
    "POST:/api/signup",
  ]);

  let sessionResult: SessionResolution | null = null;
  let contextResult: ContextResolution;

  if (routeKey === "POST:/api/logout") {
    sessionResult = await stepSession(req, requestId);

    return await dispatchPublicRoute(
      routeKey,
      req,
      requestId,
      sessionResult
    );
  }

  // --------------------------------------------------
  // PROTECTED ROUTES
  // --------------------------------------------------

  if (!PUBLIC_ROUTES.has(routeKey)) {

    // Gate-2: Session
    log({
      level: "OBSERVABILITY",
      request_id: requestId,
      gate_id: "10.5",
      route_key: routeKey,
      event: "PIPELINE_STAGE",
      meta: { stage: "SESSION" },
    });

    const tSession0 = performance.now();

sessionResult = await stepSession(req, requestId);

if (!sessionResult) {
  return errorResponse(
  "SESSION_RESOLUTION_FAILED",
  "Session resolution failed",
  requestId,
  "NONE",
  401,
  undefined,
  req
);
}

const sessionMs = Math.round((performance.now() - tSession0) * 100) / 100;

console.log("PIPELINE_SESSION_END", {
  request_id: requestId,
  route: routeKey,
  duration_ms: sessionMs
});

    const gate2Logout = enforceSessionLogout(
      "action" in sessionResult ? sessionResult : null,
      requestId
    );

    if (gate2Logout) return gate2Logout;

    // --------------------------------------------------
    // Gate-3: Lifecycle
    // --------------------------------------------------

    log({
      level: "OBSERVABILITY",
      request_id: requestId,
      gate_id: "10.5",
      route_key: routeKey,
      event: "PIPELINE_STAGE",
      meta: { stage: "SESSION_LIFECYCLE" },
    });

    const lifecycleResult = enforceIdleLifecycle(sessionResult, new Date());

    await persistLifecycleTermination(
      sessionResult,
      lifecycleResult && "status" in lifecycleResult ? lifecycleResult : null
    );

const gate3Logout = enforceSessionLogout(
  "action" in lifecycleResult ? lifecycleResult : null,
  requestId
);

if (gate3Logout) return gate3Logout;

// 🔥 FORCE ACTIVE narrowing (after logout filter)
if (sessionResult.status !== "ACTIVE") {
  return errorResponse(
    "SESSION_NOT_ACTIVE",
    "Session invalid",
    requestId,
    "LOGOUT",
    401,
  undefined,
  req
  );
}

// 🔥 SAFE ACTIVE SESSION
const activeSession = sessionResult as Extract<
  SessionResolution,
  { status: "ACTIVE" }
>;

// attach warning if present
if (
  lifecycleResult &&
  "status" in lifecycleResult &&
  (lifecycleResult.status === "ABSOLUTE_WARNING" ||
   lifecycleResult.status === "IDLE_WARNING")
) {
  (activeSession as any).__session_warning = lifecycleResult;
}

// expose active session to response layer
(req as any).session = activeSession;

// Passive session probes must never extend the backend session clock.
if (!isPassiveSessionProbe(req)) {
  const nowIso = new Date().toISOString();
  await serviceRoleClient
    .schema("erp_core")
    .from("sessions")
    .update({
      last_seen_at: nowIso,
    })
    .eq("session_id", activeSession.sessionId);

  if (activeSession.clusterId && activeSession.clusterWindowToken) {
    await touchSessionClusterWindow(
      activeSession.clusterId,
      activeSession.clusterWindowToken
    );
  }
}


    // --------------------------------------------------
    // Gate-5: Context
    // --------------------------------------------------

    log({
      level: "OBSERVABILITY",
      request_id: requestId,
      gate_id: "10.5",
      route_key: routeKey,
      event: "PIPELINE_STAGE",
      meta: { stage: "CONTEXT" },
    });

    const tContext0 = performance.now();

contextResult = await stepContext(req, {
  authUserId: activeSession.authUserId,
  roleCode: activeSession.roleCode,
});

const contextMs = Math.round((performance.now() - tContext0) * 100) / 100;

console.log("PIPELINE_CONTEXT_END", {
  request_id: requestId,
  route: routeKey,
  duration_ms: contextMs
});

    if (contextResult.status === "UNRESOLVED") {
      return errorResponse(
        "CONTEXT_UNRESOLVED",
        "Context resolution failed",
        requestId,
        "NONE",
        403,
        {
          gateId: "5",
          routeKey,
          decisionTrace: "CONTEXT_RESOLUTION_FAILED"
        },
        req
      );
    }

    // --------------------------------------------------
    // Gate-6: ACL
    // --------------------------------------------------

    log({
      level: "OBSERVABILITY",
      request_id: requestId,
      gate_id: "10.5",
      route_key: routeKey,
      event: "PIPELINE_STAGE",
      meta: { stage: "ACL" },
    });

    // 🔥 ADD THIS
if (contextResult.status !== "RESOLVED") {
  throw new Error("CONTEXT_NOT_RESOLVED_AFTER_CHECK");
}

const tAcl0 = performance.now();
    const acl = await stepAcl(req, requestId, {
     context: {
  state: contextResult.status,
  authUserId: activeSession.authUserId,
  roleCode: contextResult.roleCode,
  companyId: contextResult.companyId,
  moduleEnabled: true, // temporarily, until wired properly

  // 🔥 CRITICAL FIX
  isAdmin: contextResult.isAdmin === true,
},
      route: {
        isPublic: false,
        resourceCode: routeKey, // temporarily, proper resource mapping
      action: "VIEW", // temporary placeholder
      },
    });
    const aclMs = Math.round((performance.now() - tAcl0) * 100) / 100;

console.log("PIPELINE_ACL_END", {
  request_id: requestId,
  route: routeKey,
  duration_ms: aclMs,
  decision: acl.decision
});

    if (acl.decision === "DENY") {
      return errorResponse(
        acl.reason,
        "ACL denied request",
        requestId,
        acl.action ?? "NONE",
        403,
        {
          gateId: "6",
          routeKey,
          decisionTrace: acl.reason
        },
        req
      );
    }

    // --------------------------------------------------
    // Protected handler dispatch
    // --------------------------------------------------

    log({
      level: "OBSERVABILITY",
      request_id: requestId,
      gate_id: "10.5",
      route_key: routeKey,
      event: "PIPELINE_STAGE",
      meta: { stage: "HANDLER_PROTECTED" },
    });

    // reuse existing activeSession (already defined above)
return await dispatchProtectedRoute(
  routeKey,
  req,
  requestId,
  activeSession,
  contextResult
);
  }

  // --------------------------------------------------
  // PUBLIC ROUTES
  // --------------------------------------------------

  log({
    level: "OBSERVABILITY",
    request_id: requestId,
    gate_id: "10.5",
    route_key: routeKey,
    event: "PIPELINE_STAGE",
    meta: { stage: "HANDLER_PUBLIC" },
  });

  return await dispatchPublicRoute(
    routeKey,
    req,
    requestId,
    sessionResult
  );

}
