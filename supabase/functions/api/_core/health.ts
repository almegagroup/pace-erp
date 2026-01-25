/*
 * File-ID: 0.7A
 * File-Path: supabase/functions/api/_core/health.ts
 * Gate: 0
 * Phase: 0
 * Domain: SECURITY
 * Purpose: Health endpoint response
 * Authority: Backend
 */

export function handleHealth(requestId: string): Response {
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
