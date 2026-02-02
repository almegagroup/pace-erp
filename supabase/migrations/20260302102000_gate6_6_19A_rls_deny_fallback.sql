/*
 * File-ID: 6.19A
 * File-Path: supabase/migrations/20260302102000_gate6_6_19A_rls_deny_fallback.sql
 * Gate: 6
 * Phase: 6
 * Domain: DB
 * Purpose: Fail-safe RLS deny when ACL context is missing or invalid
 * Authority: Backend
 */

BEGIN;

-- ============================================================
-- HARD DENY POLICY (DEFENSIVE FALLBACK)
-- ============================================================
-- If context headers are missing:
--   req_company_id() IS NULL
-- then NO ROWS should be visible (even to service role
-- unless admin header explicitly present).
-- ============================================================

DROP POLICY IF EXISTS acl_snapshot_deny_when_context_missing
  ON acl.precomputed_acl_view;

CREATE POLICY acl_snapshot_deny_when_context_missing
ON acl.precomputed_acl_view
USING (
  -- Allow only if:
  -- admin OR company context exists
  erp_meta.req_is_admin() = true
  OR erp_meta.req_company_id() IS NOT NULL
);

COMMIT;
