/*
 * File-ID: 9A + 2.6 + 2.6A
 * File-Path: supabase/functions/api/_core/response.ts
 * Gate: 1 → 2
 * Phase: 1 → 2
 * Domain: SECURITY
 * Purpose: Deterministic, enumeration-safe API response envelope
 * Authority: Backend
 */

import { log } from "../_lib/logger.ts";

export type Action = "NONE" | "LOGOUT" | "REDIRECT" | "RELOAD";

/**
 * Generic messages (Gate-2)
 */
const GENERIC_AUTH_MESSAGE = "Invalid credentials";
const GENERIC_BLOCK_MESSAGE = "Request blocked by security policy";

/**
 * Public success response
 */
export function okResponse(
  data: unknown,
  requestId: string,
  req?: Request
): Response {

  const rawWarning =
  (req as any)?.__session_warning ??
  (req as any)?.session?.__session_warning;

const warning =
  rawWarning &&
  typeof rawWarning === "object" &&
  typeof rawWarning.status === "string"
    ? rawWarning
    : null;

  return new Response(
    JSON.stringify({
      ok: true,
      data,
      request_id: requestId,

      // 🔥 inject warning if exists
      warning: warning
        ? {
            type: warning.status,
          }
        : null,
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

// SESSION_CLUSTER_* codes that mean "this particular window/admission attempt
// didn't go through" (a transient, per-window hiccup the caller already
// handles gracefully -- see AuthBootstrap.jsx's ensureWindowAdmission, which
// explicitly does NOT treat these as the user being logged out). They are
// NOT evidence the underlying session/cluster is actually dead, so they must
// not force a hard logout the way a real SESSION_EXPIRED/SESSION_REVOKED
// does. This is the complete set of public codes admitSessionClusterWindowHandler
// and issueSessionClusterJoinTicketHandler (session.cluster.handler.ts) can
// ever return -- every internal error in session.cluster.ts collapses into
// one of these at the handler boundary.
const SESSION_CLUSTER_NON_FATAL_CODES = new Set([
  "SESSION_CLUSTER_MAX_WINDOWS_EXCEEDED",
  "SESSION_CLUSTER_MISSING",
  "SESSION_CLUSTER_WINDOW_INSTANCE_REQUIRED",
  "SESSION_CLUSTER_ADMISSION_BLOCKED",
  "SESSION_CLUSTER_WINDOW_NOT_ADMITTED",
  "SESSION_CLUSTER_OPEN_WINDOW_BLOCKED",
]);

/**
 * Normalize internal error codes to Gate-2 compliant public codes
 */
function normalizeCode(code: string): string {
  if (code === "SESSION_CLUSTER_MAX_WINDOWS_EXCEEDED") {
    return code;
  }

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

  // Everything else is an ordinary business/validation error (not an auth or
  // session security boundary) — pass the real code through so the frontend's
  // friendly-error maps (and the user) see what actually went wrong, instead
  // of a generic wall. Enumeration-safety only matters for AUTH_/SESSION_.
  return code;
}

/**
 * Normalize user-facing message (ID-2.6A)
 */
function normalizeMessage(publicCode: string, originalMessage: string): string {
  if (publicCode === "SESSION_CLUSTER_MAX_WINDOWS_EXCEEDED") {
    return "Maximum window limit reached";
  }

  if (publicCode === "AUTH_INVALID_CREDENTIALS") {
    return GENERIC_AUTH_MESSAGE;
  }

  return originalMessage || GENERIC_BLOCK_MESSAGE;
}

/**
 * Central error response (Gate-2 compliant)
 */
export function errorResponse(
  code: string,
  message: string,
  requestId: string,
  _action: Action = "NONE",
  status = 403,
  meta?: {
    gateId?: string;
    routeKey?: string;
    decisionTrace?: string;
  },
  req?: Request
): Response {

  const publicCode = normalizeCode(code);

  // Every error response in the app funnels through here, so this is the one
  // place that can log the REAL internal code (before it gets collapsed to
  // the generic public code/message sent to the client) alongside the actual
  // HTTP status, route, and gate — searchable in Render logs as "ERROR_RESPONSE".
  log({
    level: "ERROR",
    request_id: requestId,
    gate_id: meta?.gateId,
    route_key: meta?.routeKey,
    event: "ERROR_RESPONSE",
    decision: code,
    meta: {
      status,
      public_code: publicCode,
      decision_trace: meta?.decisionTrace ?? null,
    },
  });

  const action: Action =
    publicCode.startsWith("SESSION_") &&
    !SESSION_CLUSTER_NON_FATAL_CODES.has(publicCode)
      ? "LOGOUT"
      : "NONE";

  const responseMessage = normalizeMessage(publicCode, message);

  const rawWarning =
  (req as any)?.__session_warning ??
  (req as any)?.session?.__session_warning;

const warning =
  rawWarning &&
  typeof rawWarning === "object" &&
  typeof rawWarning.status === "string"
    ? rawWarning
    : null;

return new Response(
  JSON.stringify({
    ok: false,
    code: publicCode,
    message: responseMessage,
    action,

    // 🔥 inject warning
   warning:
  warning
    ? { type: warning.status }
    : null,
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
