/*
 * File-ID: 1A
 * File-Path: supabase/functions/api/index.ts
 * Gate: 1
 * Phase: 1
 * Domain: BACKEND
 * Purpose: Single backend entry orchestrator with locked pipeline order
 * Authority: Backend
 */

import { log } from "./_lib/logger.ts";
import { generateRequestId } from "./_lib/request_id.ts";
import { handleHealth } from "./_core/health.ts";
import { runPipeline } from "./_pipeline/runner.ts";
import { applySecurityHeaders } from "./_security/security_headers.ts";
import { applyCSP } from "./_security/csp.ts";
import { applyCORS,handlePreflight } from "./_pipeline/cors.ts";
import { errorResponse } from "./_core/response.ts";



export default async function handler(req: Request): Promise<Response> {
  const requestId = generateRequestId();
  const url = new URL(req.url);

  // ---- HEALTH (ID 0.7A) ----
  if (req.method === "GET" && url.pathname === "/health") {
    log({ level: "INFO", request_id: requestId, gate: "0.7A", event: "health" });
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
  applySecurityHeaders(preflight, requestId)
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
 log({ level: "INFO", request_id: requestId, gate: "1A", event: "pipeline_start" });

try {
  const res = await runPipeline(req, requestId);

  return applyCSP(
    applySecurityHeaders(
      applyCORS(req, res),
      requestId
    )
  );
} catch (err) {
    const code = err instanceof Error ? err.message : "UNKNOWN_ERROR";

    // ---- ID-10A: Structured error log (RCA ready) ----
    log({
      level: "ERROR",
      request_id: requestId,
      gate: "1A",
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
        errorResponse(
          code,
          "Request blocked by security policy",
          requestId,
          action
        ),
        requestId
      )
    );
  }
}
