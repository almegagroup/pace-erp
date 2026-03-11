/*
 * File-ID: 9A + 2.6 + 2.6A
 * File-Path: supabase/functions/api/_core/response.ts
 * Gate: 1 → 2
 * Phase: 1 → 2
 * Domain: SECURITY
 * Purpose: Deterministic, enumeration-safe API response envelope
 * Authority: Backend
 */

export type Action = "NONE" | "LOGOUT" | "REDIRECT" | "RELOAD";

/**
 * Generic messages (Gate-2)
 */
const GENERIC_AUTH_MESSAGE = "Invalid credentials";
const GENERIC_BLOCK_MESSAGE = "Request blocked by security policy";

/**
 * Public success response
 */
export function okResponse(data: unknown, requestId: string): Response {
  return new Response(
    JSON.stringify({
      ok: true,
      data,
      request_id: requestId,
    }),
    { status: 200 }
  );
}

/**
 * Deterministic action headers
 */
function headersForAction(action: Action): HeadersInit {
  switch (action) {
    case "LOGOUT":
      return { "X-Action": "LOGOUT" };
    case "REDIRECT":
      return { "X-Action": "REDIRECT" };
    case "RELOAD":
      return { "X-Action": "RELOAD" };
    default:
      return {};
  }
}

/**
 * Normalize internal error codes to Gate-2 compliant public codes
 */
function normalizeCode(code: string): string {
  // SESSION_* is the ONLY family allowed to force logout
  if (code.startsWith("SESSION_")) {
    return code;
  }

  // All auth-related failures collapse here
  if (
  code.startsWith("AUTH_") ||
  code.startsWith("RATE_LIMIT_") ||
  code.startsWith("AUTH_RATE_LIMIT_") ||
  code === "INVALID_CREDENTIALS"
) {
    return "AUTH_INVALID_CREDENTIALS";
  }

  // Everything else is treated as blocked
  return "REQUEST_BLOCKED";
}

/**
 * Normalize user-facing message (ID-2.6A)
 */
function normalizeMessage(publicCode: string): string {
  if (publicCode === "AUTH_INVALID_CREDENTIALS") {
    return GENERIC_AUTH_MESSAGE;
  }

  return GENERIC_BLOCK_MESSAGE;
}

/**
 * Central error response (Gate-2 compliant)
 */
export function errorResponse(
  code: string,
  _message: string,
  requestId: string,
  _action: Action = "NONE",
  status = 403,
  meta?: {
    gateId?: string;
    routeKey?: string;
    decisionTrace?: string;
  }
): Response {

  const publicCode = normalizeCode(code);

  const action: Action =
    publicCode.startsWith("SESSION_") ? "LOGOUT" : "NONE";

  const message = normalizeMessage(publicCode);

  return new Response(
    JSON.stringify({
      ok: false,
      code: publicCode,
      message,
      action,

      /* =====================================================
       * Observability metadata (Gate-10)
       * ===================================================== */

      request_id: requestId,
      gate_id: meta?.gateId ?? null,
      route_key: meta?.routeKey ?? null,
      decision_trace: meta?.decisionTrace ?? null,
    }),
    {
      status,
      headers: headersForAction(action),
    }
  );
}