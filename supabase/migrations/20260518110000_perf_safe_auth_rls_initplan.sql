/*
 * File-ID: PERF-SAFE-AUTH-RLS-INITPLAN
 * File-Path: supabase/migrations/20260518110000_perf_safe_auth_rls_initplan.sql
 * Gate: Cross-cutting
 * Phase: Performance hardening
 * Domain: SECURITY / RLS
 * Purpose: Apply planner-friendly auth wrappers to active self-scope RLS policies without changing access semantics.
 * Authority: Backend
 * Safety: Zero-behavior-change, forward-only corrective patch
 */

BEGIN;

------------------------------------------------------------
-- 1. erp_core.sessions
-- Preserve the existing logic and only wrap auth.uid() so
-- PostgreSQL can initialize it once per statement.
------------------------------------------------------------

DROP POLICY IF EXISTS sessions_self_isolation ON erp_core.sessions;

CREATE POLICY sessions_self_isolation
ON erp_core.sessions
FOR ALL
TO authenticated
USING (
  erp_meta.req_is_admin() = true
  OR auth_user_id = (select auth.uid())
)
WITH CHECK (
  erp_meta.req_is_admin() = true
  OR auth_user_id = (select auth.uid())
);

------------------------------------------------------------
-- 2. erp_core.users
------------------------------------------------------------

DROP POLICY IF EXISTS users_select_self ON erp_core.users;

CREATE POLICY users_select_self
ON erp_core.users
FOR SELECT
TO authenticated
USING (
  auth_user_id = (select auth.uid())
);

------------------------------------------------------------
-- 3. erp_core.signup_requests
------------------------------------------------------------

DROP POLICY IF EXISTS signup_select_self ON erp_core.signup_requests;

CREATE POLICY signup_select_self
ON erp_core.signup_requests
FOR SELECT
TO authenticated
USING (
  auth_user_id = (select auth.uid())
);

COMMIT;
