/*
 * File-ID: 6.19F
 * File-Path: supabase/migrations/20260317130000_gate6_6_19F_authenticated_privilege_formalization.sql
 * Gate: 6
 * Phase: 6
 * Domain: DB
 * Purpose: Formalize authenticated role privileges for RLS-controlled ERP access
 * Authority: Backend
 * Idempotent: YES
 */

BEGIN;

-- ============================================================
-- 1️⃣ SCHEMA USAGE (Required for RLS to execute)
-- ============================================================

GRANT USAGE ON SCHEMA erp_master TO authenticated;
GRANT USAGE ON SCHEMA erp_map TO authenticated;
GRANT USAGE ON SCHEMA erp_core TO authenticated;
GRANT USAGE ON SCHEMA erp_menu TO authenticated;
GRANT USAGE ON SCHEMA acl TO authenticated;
GRANT USAGE ON SCHEMA erp_meta TO authenticated;

-- ============================================================
-- 2️⃣ TABLE PRIVILEGES (RLS will filter rows)
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE
ON ALL TABLES IN SCHEMA erp_master
TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
ON ALL TABLES IN SCHEMA erp_map
TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
ON ALL TABLES IN SCHEMA erp_core
TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
ON ALL TABLES IN SCHEMA erp_menu
TO authenticated;

GRANT SELECT
ON ALL TABLES IN SCHEMA acl
TO authenticated;

-- ============================================================
-- 3️⃣ FUTURE TABLE DEFAULT PRIVILEGES
-- ============================================================

ALTER DEFAULT PRIVILEGES IN SCHEMA erp_master
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA erp_map
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA erp_core
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA erp_menu
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA acl
GRANT SELECT ON TABLES TO authenticated;

-- ============================================================
-- 4️⃣ SAFETY ASSERTION COMMENT
-- ============================================================
-- IMPORTANT:
-- This migration DOES NOT weaken security.
-- All access remains strictly filtered by:
--   - ENABLE RLS
--   - FORCE RLS
--   - Context-bound policies
--   - Admin isolation
--
-- Privileges allow RLS to execute.
-- RLS remains the enforcement layer.

COMMIT;