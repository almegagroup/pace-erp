-- ============================================================
-- File-ID: ID-0.6F
-- File-Path: supabase/migrations/20260410101000_gate0_0_6F_global_service_role_access.sql
-- Gate: 0
-- Phase: 0
-- Domain: SECURITY
-- Short_Name: Global service_role access fix
-- Purpose: Eliminate ALL permission denied for backend service_role
-- Authority: Backend-only
-- ============================================================

BEGIN;

-- ============================================================
-- 1️⃣ SCHEMA USAGE ACCESS (ALL ERP SCHEMAS)
-- ============================================================

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT schema_name
    FROM information_schema.schemata
    WHERE schema_name LIKE 'erp_%'
       OR schema_name = 'acl'
  LOOP
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO service_role;', r.schema_name);
  END LOOP;
END $$;

-- ============================================================
-- 2️⃣ TABLE ACCESS (ALL EXISTING TABLES)
-- ============================================================

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT schemaname, tablename
    FROM pg_tables
    WHERE schemaname LIKE 'erp_%'
       OR schemaname = 'acl'
  LOOP
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I.%I TO service_role;',
      r.schemaname,
      r.tablename
    );
  END LOOP;
END $$;

-- ============================================================
-- 3️⃣ SEQUENCE ACCESS (FOR CODE GENERATORS ETC.)
-- ============================================================

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT sequence_schema, sequence_name
    FROM information_schema.sequences
    WHERE sequence_schema LIKE 'erp_%'
       OR sequence_schema = 'acl'
  LOOP
    EXECUTE format(
      'GRANT USAGE, SELECT ON SEQUENCE %I.%I TO service_role;',
      r.sequence_schema,
      r.sequence_name
    );
  END LOOP;
END $$;

-- ============================================================
-- 4️⃣ FUNCTION EXECUTE ACCESS
-- ============================================================

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT routine_schema, routine_name
    FROM information_schema.routines
    WHERE routine_schema LIKE 'erp_%'
       OR routine_schema = 'acl'
  LOOP
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION %I.%I TO service_role;',
      r.routine_schema,
      r.routine_name
    );
  END LOOP;
END $$;

-- ============================================================
-- 5️⃣ DEFAULT PRIVILEGES (FUTURE-PROOF)
-- ============================================================

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT schema_name
    FROM information_schema.schemata
    WHERE schema_name LIKE 'erp_%'
       OR schema_name = 'acl'
  LOOP

    -- Tables (future)
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES IN SCHEMA %I
       GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role;',
      r.schema_name
    );

    -- Sequences (future)
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES IN SCHEMA %I
       GRANT USAGE, SELECT ON SEQUENCES TO service_role;',
      r.schema_name
    );

    -- Functions (future)
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES IN SCHEMA %I
       GRANT EXECUTE ON FUNCTIONS TO service_role;',
      r.schema_name
    );

  END LOOP;
END $$;

COMMIT;