/*
 * File-ID: 1A
 * File-Path: supabase/functions/api/index.ts
 * gate_id: 1
 * Phase: 1
 * Domain: BACKEND
 * Purpose: Single backend entry orchestrator with locked pipeline order
 * Authority: Backend
 */

import { log } from "./_lib/logger.ts";
import { generateRequestId } from "./_lib/request_id.ts";
import { handleHealth } from "./_core/health.ts";
import { runPipeline, type PipelineTimings } from "./_pipeline/runner.ts";
import { applySecurityHeaders } from "./_security/security_headers.ts";
import { applyCSP } from "./_security/csp.ts";
import { applyCORS,handlePreflight } from "./_pipeline/cors.ts";
import { errorResponse } from "./_core/response.ts";



export default async function handler(req: Request): Promise<Response> {
  const requestId = generateRequestId();
  const url = new URL(req.url);
  const routeKey = `${req.method}:${url.pathname.replace(/^\/functions\/v1\/api/, "")}`;

  // ---- HEALTH (ID 0.7A) ----
  const path = url.pathname.replace(/^\/functions\/v1\/api/, "");

if (req.method === "GET" && path === "/health") {
 
  return applyCSP(
  applySecurityHeaders(
    applyCORS(req, handleHealth(requestId)),
    requestId
  )
);
  }
// ---- CORS PREFLIGHT (ID 3A) ----
const preflight = handlePreflight(req);
if (preflight) {
  return applyCSP(
    applySecurityHeaders(
      applyCORS(req, preflight),
      requestId
    )
  );
}

// ---- ID-11: Public endpoint isolation ----
// Only /health may bypass pipeline.
// All other endpoints (including public ones like /api/signup)
// MUST go through the full pipeline and be handled downstream.
if (url.pathname !== "/health") {
  // governance lock: no bypass, no special-casing
}

  // ---- PIPELINE (ID 1A) ----
 log({ level: "INFO", request_id: requestId, gate_id: "1A", event: "pipeline_start" });

try {
  // PERF: collect per-step pipeline timings and surface them as a standard `Server-Timing`
  // response header, so any request's cost breakdown is visible directly in the browser
  // DevTools Network → Timing panel. No extra DB call, no extra round trip — the numbers are
  // already being measured for the observability log; this just also returns them.
  const timings: PipelineTimings = {};
  const tTotal0 = performance.now();
  const res = await runPipeline(req, requestId, timings);
  timings.total = Math.round(performance.now() - tTotal0);

  const serverTiming = Object.entries(timings)
    .map(([name, ms]) => `${name};dur=${ms}`)
    .join(", ");
  const timedRes = serverTiming
    ? new Response(res.body, {
        status: res.status,
        headers: (() => {
          const h = new Headers(res.headers);
          h.set("Server-Timing", serverTiming);
          return h;
        })(),
      })
    : res;

  return applyCSP(
    applySecurityHeaders(
      applyCORS(req, timedRes),   // ✅ ONLY res
      requestId
    )
  );
} catch (err) {
    const code = err instanceof Error ? err.message : "UNKNOWN_ERROR";

    // ---- ID-10A: Structured error log (RCA ready) ----
    log({
      level: "ERROR",
      request_id: requestId,
      gate_id: "1A",
      event: "pipeline_error",
      meta: {
        code,
        stage: "PIPELINE",
      },
    });

    const action =
      code.startsWith("SESSION_") ? "LOGOUT" : "NONE";

  return applyCSP(
  applySecurityHeaders(
    applyCORS(
      req,
      errorResponse(
        // Last-resort catch for a genuinely unhandled exception anywhere in the
        // pipeline — unlike a normal handler's deliberate errorResponse() call,
        // `code` here is an arbitrary thrown Error's .message and could contain
        // anything, so it must stay masked (SESSION_* still passes through to
        // allow LOGOUT). The real code is preserved in decisionTrace for logs.
        code.startsWith("SESSION_") ? code : "REQUEST_BLOCKED",
        "Request blocked by security policy",
        requestId,
        action,
        403,
        {
          gateId: "1A",
          routeKey,
          decisionTrace: code,
        }
      )
    ),
    requestId
  )
);
  }
}
