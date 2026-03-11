/*
 * File-ID: ID-6.19H
 * File-Path: supabase/migrations/20260320103000_gate6_6_19H_phaseA_A3_default_deny_completion.sql
 * Gate: 6
 * Phase: A (DB Hard Security Closure)
 * Domain: RLS Enforcement
 * Purpose: Enforce explicit minimal policies for all remaining business tables.
 * Authority: Backend
 */

BEGIN;

-------------------------------------------------------
-- 1️⃣ ACL GLOBAL META TABLES (READ ONLY)
-------------------------------------------------------

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT schemaname, tablename
    FROM pg_tables
    WHERE schemaname = 'acl'
      AND tablename <> 'precomputed_acl_view'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_meta_read ON %I.%I;',
      r.tablename, r.schemaname, r.tablename);

    EXECUTE format('
      CREATE POLICY %I_meta_read
      ON %I.%I
      FOR SELECT
      TO authenticated
      USING (true);
    ', r.tablename, r.schemaname, r.tablename);
  END LOOP;
END $$;

-------------------------------------------------------
-- 2️⃣ erp_acl.user_roles
-------------------------------------------------------

DROP POLICY IF EXISTS user_roles_meta_read ON erp_acl.user_roles;

CREATE POLICY user_roles_meta_read
ON erp_acl.user_roles
FOR SELECT
TO authenticated
USING (true);

-------------------------------------------------------
-- 3️⃣ erp_menu tables (READ ONLY META)
-------------------------------------------------------

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT schemaname, tablename
    FROM pg_tables
    WHERE schemaname = 'erp_menu'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_menu_read ON %I.%I;',
      r.tablename, r.schemaname, r.tablename);

    EXECUTE format('
      CREATE POLICY %I_menu_read
      ON %I.%I
      FOR SELECT
      TO authenticated
      USING (true);
    ', r.tablename, r.schemaname, r.tablename);
  END LOOP;
END $$;

COMMIT;