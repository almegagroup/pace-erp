/*
 * File-ID: ID-6.19I
 * File-Path: supabase/migrations/20260320104000_gate6_6_19I_phaseA_A4_privilege_hardening.sql
 * Gate: 6
 * Phase: A (DB Hard Security Closure)
 * Domain: Privilege Hardening
 * Purpose: Restrict meta tables to read-only for authenticated role.
 * Authority: Backend
 */

BEGIN;

-------------------------------------------------------
-- 1️⃣ ACL META TABLES → SELECT ONLY
-------------------------------------------------------

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT table_schema, table_name
    FROM information_schema.tables
    WHERE table_schema = 'acl'
      AND table_type = 'BASE TABLE'
  LOOP
    EXECUTE format(
      'REVOKE INSERT, UPDATE, DELETE ON TABLE %I.%I FROM authenticated;',
      r.table_schema,
      r.table_name
    );
  END LOOP;
END $$;

-------------------------------------------------------
-- 2️⃣ ERP_MENU META TABLES → SELECT ONLY
-------------------------------------------------------

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT table_schema, table_name
    FROM information_schema.tables
    WHERE table_schema = 'erp_menu'
      AND table_type = 'BASE TABLE'
  LOOP
    EXECUTE format(
      'REVOKE INSERT, UPDATE, DELETE ON TABLE %I.%I FROM authenticated;',
      r.table_schema,
      r.table_name
    );
  END LOOP;
END $$;

-------------------------------------------------------
-- 3️⃣ erp_acl.user_roles → SELECT ONLY
-------------------------------------------------------

REVOKE INSERT, UPDATE, DELETE
ON erp_acl.user_roles
FROM authenticated;

COMMIT;