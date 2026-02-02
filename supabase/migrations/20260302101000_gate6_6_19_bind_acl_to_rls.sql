/*
 * File-ID: 6.19
 * File-Path: supabase/migrations/20260302101000_gate6_6_19_bind_acl_to_rls.sql
 * Gate: 6
 * Phase: 6
 * Domain: DB
 * Purpose: Bind ACL context to RLS (last-line enforcement)
 * Authority: Backend
 */

BEGIN;

-- ============================================================
-- APPLY RLS TO ACL SNAPSHOT TABLE
-- ============================================================

ALTER TABLE acl.precomputed_acl_view
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE acl.precomputed_acl_view
  FORCE ROW LEVEL SECURITY;

-- ============================================================
-- RLS POLICY: ACL SNAPSHOT VISIBILITY
-- ============================================================
-- Rule:
-- 1. Admin universe can see everything
-- 2. Non-admin can see ONLY rows matching resolved context
-- 3. Context mismatch => zero rows (silent deny)
-- ============================================================

DROP POLICY IF EXISTS acl_snapshot_context_policy
  ON acl.precomputed_acl_view;

CREATE POLICY acl_snapshot_context_policy
ON acl.precomputed_acl_view
USING (
  -- Admin universe bypass
  erp_meta.req_is_admin() = true

  OR (
    -- Mandatory company isolation
    company_id = erp_meta.req_company_id()

    -- Optional project isolation (NULL-safe)
    AND (
      project_id IS NULL
      OR project_id = erp_meta.req_project_id()
    )

    -- Optional department isolation (NULL-safe)
    AND (
      department_id IS NULL
      OR department_id = erp_meta.req_department_id()
    )
  )
);

COMMIT;
