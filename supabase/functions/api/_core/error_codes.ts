/*
 * File-ID: 10.2
 * File-Path: supabase/functions/api/_core/error_codes.ts
 * Gate: 10
 * Phase: 10
 * Domain: OBSERVABILITY
 * Purpose: Canonical error taxonomy for deterministic RCA
 * Authority: Backend
 */

export const ERROR_CODES = {

  /* =====================================================
   * AUTH DOMAIN
   * ===================================================== */

  AUTH_INVALID_CREDENTIALS: "AUTH_INVALID_CREDENTIALS",
  AUTH_RATE_LIMITED: "AUTH_RATE_LIMITED",

  /* =====================================================
   * SESSION DOMAIN
   * ===================================================== */

  SESSION_ABSENT: "SESSION_ABSENT",
  SESSION_REVOKED: "SESSION_REVOKED",
  SESSION_EXPIRED: "SESSION_EXPIRED",
  SESSION_IDLE_EXPIRED: "SESSION_IDLE_EXPIRED",

  /* =====================================================
   * CONTEXT DOMAIN
   * ===================================================== */

  CONTEXT_UNRESOLVED: "CONTEXT_UNRESOLVED",

  /* =====================================================
   * ACL DOMAIN
   * ===================================================== */

  ACL_DENY_INCOMPLETE_INPUT: "ACL_DENY_INCOMPLETE_INPUT",
  ACL_BLOCKED_BY_UNRESOLVED_CONTEXT: "ACL_BLOCKED_BY_UNRESOLVED_CONTEXT",
  ACL_SNAPSHOT_QUERY_FAILED: "ACL_SNAPSHOT_QUERY_FAILED",
  ACL_ACTIVE_VERSION_NOT_FOUND: "ACL_ACTIVE_VERSION_NOT_FOUND",

  /* =====================================================
   * GENERIC SECURITY BLOCK
   * ===================================================== */

  REQUEST_BLOCKED: "REQUEST_BLOCKED",

} as const;

export type ErrorCode = keyof typeof ERROR_CODES;