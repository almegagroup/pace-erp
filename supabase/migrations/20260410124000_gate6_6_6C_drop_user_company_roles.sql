/*
 * File-ID: 6.6C
 * File-Path: supabase/migrations/20260410124000_gate6_6_6C_drop_user_company_roles.sql
 * Gate: 6
 * Phase: 6
 * Domain: MAP
 * Purpose: Retire legacy user_company_roles bridge table after canonical role/company migration
 * Authority: Backend
 */

BEGIN;

-- ------------------------------------------------------------
-- 1. Best-effort backfill any legacy session role cache gaps
-- ------------------------------------------------------------
UPDATE erp_core.sessions s
SET role_code = ur.role_code
FROM erp_acl.user_roles ur
WHERE s.auth_user_id = ur.auth_user_id
  AND s.role_code IS NULL;

-- ------------------------------------------------------------
-- 2. Drop legacy policies if they still exist
-- ------------------------------------------------------------
DROP POLICY IF EXISTS user_company_roles_rls ON erp_map.user_company_roles;
DROP POLICY IF EXISTS user_company_roles_isolation ON erp_map.user_company_roles;

-- ------------------------------------------------------------
-- 3. Drop the legacy bridge table
-- ------------------------------------------------------------
DROP TABLE IF EXISTS erp_map.user_company_roles;

COMMIT;
