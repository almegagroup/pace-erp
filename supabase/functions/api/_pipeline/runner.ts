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

/**
 * STEP 10.2 — Deterministic SESSION_* logout enforcement (ID-3.7A)
 * Any SESSION_* outcome MUST force LOGOUT.
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


export async function runPipeline(req: Request, requestId: string): Promise<Response> {
  await stepHeaders(req, requestId);   // ID-2 (request-side)
  await stepCors(req, requestId);      // ID-3
  await stepCsrf(req, requestId);      // ID-4
  await stepRateLimit(req, requestId); // ID-5
  const sessionResult = await stepSession(req, requestId);

const gate2Logout = enforceSessionLogout(
  "action" in sessionResult ? sessionResult : null,
  requestId
);
if (gate2Logout) return gate2Logout;

// Gate-3 idle lifecycle enforcement (contract-level)
const idleResult = enforceIdleLifecycle(sessionResult, new Date());

const gate3Logout = enforceSessionLogout(
  "action" in idleResult ? idleResult : null,
  requestId
);
if (gate3Logout) return gate3Logout;
  await stepContext(req, requestId);   // ID-7
  await stepAcl(req, requestId);       // ID-8

  return new Response(
    JSON.stringify({ status: "blocked", reason: "pipeline_not_initialized", request_id: requestId }),
    { status: 403 }
  );
}
