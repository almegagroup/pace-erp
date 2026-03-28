/*
 * File-ID: 6.19J
 * File-Path: supabase/migrations/20260410118000_gate6_6_19J_post_split_security_seal.sql
 * Gate: 6
 * Phase: 6
 * Domain: DB
 * Purpose: Seal post-19F structural additions that missed final privilege, RLS, or policy attachment
 * Authority: Backend
 * Idempotent: YES
 */

BEGIN;

-- ============================================================
-- 1️⃣ ERP_MAP.USER_PARENT_COMPANIES
-- ------------------------------------------------------------
-- Gap found:
-- - table introduced after relational RLS bundle
-- - authenticated DML should remain RLS-filtered
-- - table was showing unrestricted in Supabase because RLS/policy
--   were never attached after creation
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE
ON TABLE erp_map.user_parent_companies
TO authenticated;

ALTER TABLE erp_map.user_parent_companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_map.user_parent_companies FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_parent_companies_rls ON erp_map.user_parent_companies;

CREATE POLICY user_parent_companies_rls
ON erp_map.user_parent_companies
FOR ALL
USING (
  erp_meta.req_is_admin() = true
  OR (
      company_id = erp_meta.req_company_id()
      AND EXISTS (
          SELECT 1
          FROM erp_master.companies c
          WHERE c.id = erp_meta.req_company_id()
            AND c.status = 'ACTIVE'
      )
  )
)
WITH CHECK (
  erp_meta.req_is_admin() = true
  OR (
      company_id = erp_meta.req_company_id()
      AND EXISTS (
          SELECT 1
          FROM erp_master.companies c
          WHERE c.id = erp_meta.req_company_id()
            AND c.status = 'ACTIVE'
      )
  )
);

-- ============================================================
-- 2️⃣ ERP_AUDIT.WORKFLOW_EVENTS
-- ------------------------------------------------------------
-- Gap found:
-- - table already had RLS + read policy
-- - erp_audit schema remained locked from Gate-0
-- - authenticated privilege wiring was never formalized afterward
-- ============================================================

GRANT USAGE ON SCHEMA erp_audit TO authenticated;

GRANT SELECT
ON TABLE erp_audit.workflow_events
TO authenticated;

-- ============================================================
-- 3️⃣ ACL.MODULE_RESOURCE_MAP
-- ------------------------------------------------------------
-- Gap found:
-- - table already had RLS + authenticated SELECT privilege
--   via ACL default privileges
-- - companion read policy was missing unlike module_registry and
--   resource_approval_policy
-- ============================================================

DROP POLICY IF EXISTS module_resource_map_read_authenticated
ON acl.module_resource_map;

CREATE POLICY module_resource_map_read_authenticated
ON acl.module_resource_map
FOR SELECT
TO authenticated
USING (TRUE);

COMMIT;
