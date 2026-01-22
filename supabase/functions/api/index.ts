/*
 * File-ID: 0.7B
 * File-Path: supabase/functions/api/index.ts
 * Gate: 0
 * Phase: 0
 * Domain: SECURITY
 * Purpose: Single backend entry — logging shell + health endpoint
 * Authority: Backend
 */

import { log } from "./_lib/logger.ts";
import { generateRequestId } from "./_lib/request_id.ts";

export default async function handler(req: Request): Promise<Response> {
  const requestId = generateRequestId();
  const url = new URL(req.url);

  // ---- HEALTH ENDPOINT (ID 0.7A) ----
  if (req.method === "GET" && url.pathname === "/health") {
    log({
      level: "INFO",
      request_id: requestId,
      gate: "0.7A",
      event: "health_check",
    });

    return new Response(
      JSON.stringify({
        status: "ok",
        service: "PACE-ERP",
        request_id: requestId,
        ts: new Date().toISOString(),
      }),
      { status: 200 }
    );
  }

  // ---- DEFAULT LOGGING SHELL (ID 0.7) ----
  log({
    level: "INFO",
    request_id: requestId,
    gate: "0.7",
    event: "request_received",
    meta: {
      method: req.method,
      path: url.pathname,
    },
  });

  return new Response(
    JSON.stringify({
      status: "ok",
      request_id: requestId,
    }),
    { status: 200 }
  );
}
