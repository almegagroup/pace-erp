/*
 * File-ID: 2.3B-AUTH-ME-FINAL
 * File-Path: supabase/functions/api/_core/auth/me.handler.ts
 * Gate: 2
 * Phase: 2
 * Domain: AUTH
 * Purpose: WhoAmI API with no-guess contract and minimal payload
 * Authority: Backend
 */

import { okResponse, errorResponse } from "../response.ts";
import type { SessionResolution } from "../../_pipeline/session.ts";

interface MeContext {
  session: SessionResolution;
  requestId: string;
  req: Request;
}
/**
 * /api/me
 *
 * ID-2.3  : Backend truth of login state (WhoAmI)
 * ID-2.3A : No-guess contract (frontend reacts ONLY to action)
 * ID-2.3B : Minimal payload (no decision signal in body)
 *
 * HARD RULES:
 * - No roles
 * - No permissions
 * - No hints
 * - No branching payload
 */
export function meHandler(ctx: MeContext): Response {
  const { session, requestId, req } = ctx;
  const reqStart = performance.now();

  /**
   * AUTHENTICATED
   * - Identity exists
   * - Payload intentionally empty
   * - Frontend MUST rely on absence of LOGOUT action
   */
  if (session.status === "ACTIVE") {
    const totalMs = Math.round((performance.now() - reqStart) * 100) / 100;

  console.log("ME_REQ_END", {
    request_id: requestId,
    path: "/api/me",
    total_ms: totalMs,
    status: "ACTIVE"
  });
    return okResponse({}, requestId, req);
  }

  /**
   * NOT AUTHENTICATED
   * - ABSENT / REVOKED / EXPIRED / any invalid state
   * - Deterministic collapse
   * - Frontend MUST logout
   */

  const totalMs = Math.round((performance.now() - reqStart) * 100) / 100;

console.log("ME_REQ_END", {
  request_id: requestId,
  path: "/api/me",
  total_ms: totalMs,
  status: "NOT_AUTHENTICATED"
});

  return errorResponse(
    "AUTH_NOT_AUTHENTICATED",
    "Not authenticated",
    requestId,
    "LOGOUT",
    401,
  undefined,
  req
  );
}
