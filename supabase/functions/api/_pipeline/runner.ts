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
    401
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

    sessionResult = await stepSession(req, requestId);

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

    const idleResult = enforceIdleLifecycle(sessionResult, new Date());

    const gate3Logout = enforceSessionLogout(
      "action" in idleResult ? idleResult : null,
      requestId
    );

    if (gate3Logout) return gate3Logout;

   if (sessionResult.status !== "ACTIVE") {
  return errorResponse(
    "SESSION_NOT_ACTIVE",
    "Session invalid",
    requestId,
    "LOGOUT",
    401
  );
}

    /**
     * Reset idle timer only when ACTIVE
     */

    if (
      "status" in idleResult &&
      idleResult.status === "ACTIVE"
    ) {
      await serviceRoleClient
        .schema("erp_core").from("sessions")
        .update({
          last_seen_at: new Date().toISOString(),
        })
        .eq("session_id", sessionResult.sessionId);
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

    contextResult = await stepContext(req, {
  authUserId: sessionResult.authUserId,
  roleCode: sessionResult.roleCode,
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
        }
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

    const acl = await stepAcl(req, requestId, {
      context: {
        state: contextResult.status,
        authUserId: sessionResult.authUserId,
        roleCode: contextResult.roleCode,
        companyId: contextResult.companyId,
        moduleEnabled: true, // temporarily, until wired properly
      },
      route: {
        isPublic: false,
        resourceCode: routeKey, // temporarily, proper resource mapping
      action: "VIEW", // temporary placeholder
      },
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
        }
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

    return await dispatchProtectedRoute(
      routeKey,
      req,
      requestId,
      sessionResult as Extract<SessionResolution, { status: "ACTIVE" }>,
      contextResult as Extract<ContextResolution, { status: "RESOLVED" }>
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