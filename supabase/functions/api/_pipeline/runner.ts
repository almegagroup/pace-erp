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

import { log } from "../_lib/logger.ts";

import type { SessionResolution } from "./session.ts";
import type { ContextResolution } from "./context.ts";

/**
 * SESSION logout enforcement
 */
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
    "POST:/api/logout",
  ]);

  let sessionResult: SessionResolution | null = null;
  let contextResult: ContextResolution;

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

// 🔥 Store warning if exists
// 🔥 Store warning if exists
if (
  lifecycleResult &&
  "status" in lifecycleResult &&
  (lifecycleResult.status === "ABSOLUTE_WARNING" ||
   lifecycleResult.status === "IDLE_WARNING")
) {
  (activeSession as any).__session_warning = lifecycleResult;
}

// 🔥 Always update last_seen (ACTIVE session)
await serviceRoleClient
  .schema("erp_core")
  .from("sessions")
  .update({
    last_seen_at: new Date().toISOString(),
  })
  .eq("session_id", activeSession.sessionId);


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