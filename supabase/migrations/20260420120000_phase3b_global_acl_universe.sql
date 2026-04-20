-- ============================================================
-- File-ID: PHASE3B-GLOBAL-ACL-UNIVERSE
-- File-Path: supabase/migrations/20260420120000_phase3b_global_acl_universe.sql
-- Gate: 6
-- Phase: 3
-- Domain: CACHE
-- Purpose: Extend session_menu_snapshot universe to support GLOBAL_ACL for Type 2 (multi-company) users
-- Authority: Database
-- Idempotent: YES
-- ============================================================

-- GLOBAL_ACL universe:
--   Stores a union of all ACL menus across all of a user's companies.
--   Used for navigation only. Never used for authorization.
--   Keyed by (session_id, universe = GLOBAL_ACL), company_id = NULL, work_context_id = NULL.

BEGIN;

------------------------------------------------------------
-- Drop old inline CHECK constraint on universe column
-- PostgreSQL auto-names inline CHECK constraints as {table}_{column}_check
------------------------------------------------------------

ALTER TABLE erp_cache.session_menu_snapshot
  DROP CONSTRAINT IF EXISTS session_menu_snapshot_universe_check;

------------------------------------------------------------
-- Recreate with GLOBAL_ACL added
------------------------------------------------------------

ALTER TABLE erp_cache.session_menu_snapshot
  ADD CONSTRAINT session_menu_snapshot_universe_check
    CHECK (universe IN ('SA', 'GA', 'ACL', 'GLOBAL_ACL'));

COMMIT;
