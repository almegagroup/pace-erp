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

import { loginHandler } from "../_core/auth/login.handler.ts";
import { logoutHandler } from "../_core/auth/logout.handler.ts";
import { meHandler } from "../_core/auth/me.handler.ts";
import { signupHandler } from "../_core/auth/signup/signup.handler.ts";

import { listPendingSignupHandler } from "../_core/admin/signup/list_pending.handler.ts";
import { approveSignupHandler } from "../_core/admin/signup/approve.handler.ts";
import { rejectSignupHandler } from "../_core/admin/signup/reject.handler.ts";
import { createCompanyHandler } from "../_core/admin/company/create_company.handler.ts";
import { errorResponse } from "../_core/response.ts";

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
    return new Response(
      JSON.stringify({
        status: "logout",
        request_id: requestId,
      }),
      { status: 401 }
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
  await stepHeaders(req, requestId);
  await stepCors(req, requestId);
  await stepCsrf(req, requestId);
  await stepRateLimit(req, requestId);

  // --------------------------------------------------
  // Route detection
  // --------------------------------------------------
  const url = new URL(req.url);
  const routeKey = `${req.method}:${url.pathname}`;

  const PUBLIC_ROUTES = new Set([
    "POST:/api/login",
    "POST:/api/signup",
    "GET:/api/me",
    "POST:/api/logout",
  ]);

  let sessionResult: SessionResolution | null = null;
  let contextResult: ContextResolution | null = null;

  // --------------------------------------------------
  // PROTECTED ROUTES (Session + Context + ACL)
  // --------------------------------------------------
  if (!PUBLIC_ROUTES.has(routeKey)) {
    // Gate-2: Session
    sessionResult = await stepSession(req, requestId);

    // If session indicates logout → logout response
    const gate2Logout = enforceSessionLogout(
      "action" in sessionResult ? sessionResult : null,
      requestId
    );
    if (gate2Logout) return gate2Logout;

    // Gate-3: Lifecycle
    const idleResult = enforceIdleLifecycle(sessionResult, new Date());
    const gate3Logout = enforceSessionLogout(
      "action" in idleResult ? idleResult : null,
      requestId
    );
    if (gate3Logout) return gate3Logout;

    // Only ACTIVE sessions continue
    if (sessionResult.status !== "ACTIVE") {
      return new Response(
        JSON.stringify({
          status: "logout",
          request_id: requestId,
        }),
        { status: 401 }
      );
    }

    // Gate-5: Context
    contextResult = await stepContext(req, {
      authUserId: sessionResult.authUserId,
      roleCode: (sessionResult as { roleCode?: string }).roleCode,
    });

    if (contextResult.status === "UNRESOLVED") {
      return new Response(
        JSON.stringify({
          status: "blocked",
          code: "CONTEXT_UNRESOLVED",
          request_id: requestId,
        }),
        { status: 403 }
      );
    }

    // Gate-6: ACL
    const acl = stepAcl(req, requestId, {
      context: { state: contextResult.status },
      route: { isPublic: false },
    });

    if (acl.decision === "DENY") {
  return errorResponse(
    acl.reason,
    "ACL denied request",
    requestId,
    acl.action ?? "NONE",
    403
  );
}

    // --------------------------------------------------
    // PROTECTED HANDLER RESOLUTION
    // --------------------------------------------------
    switch (routeKey) {
      case "GET:/api/admin/signup-requests":
  return await listPendingSignupHandler(req, {
    context: contextResult,
    request_id: requestId,
  });

      case "POST:/api/admin/signup-requests/approve":
  return await approveSignupHandler(req, {
    context: contextResult,
    request_id: requestId,
    auth_user_id: sessionResult.authUserId,
  });

      case "POST:/api/admin/signup-requests/reject":
  return await rejectSignupHandler(req, {
    context: contextResult,
    request_id: requestId,
    auth_user_id: sessionResult.authUserId,
  });

      case "POST:/api/admin/company":
        return await createCompanyHandler(req, {
  context: contextResult,
  request_id: requestId,
});

      default:
        return new Response(
          JSON.stringify({
            status: "blocked",
            reason: "no_handler_matched",
            request_id: requestId,
          }),
          { status: 403 }
        );
    }
  }

  // --------------------------------------------------
  // PUBLIC ROUTES
  // --------------------------------------------------
  switch (routeKey) {
    case "POST:/api/login":
      return await loginHandler({
        body: await req.json(),
        requestId,
        requestUrl: req.url,
      });

    case "POST:/api/logout":
    return await logoutHandler({
      session: sessionResult ?? { status: "ABSENT", action: "LOGOUT" },
      requestId,
      requestUrl: req.url,
    });

    case "GET:/api/me":
  return meHandler({
    session: sessionResult ?? { status: "ABSENT", action: "LOGOUT" },
    requestId,
  });

    case "POST:/api/signup":
      return await signupHandler(req);

    default:
      return new Response(
        JSON.stringify({
          status: "blocked",
          reason: "no_handler_matched",
          request_id: requestId,
        }),
        { status: 403 }
      );
  }
}

