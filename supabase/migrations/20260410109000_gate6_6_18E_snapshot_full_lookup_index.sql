/*
 * File-ID: ID-6.18E
 * File-Path: supabase/migrations/20260410109000_gate6_6_18E_snapshot_full_lookup_index.sql
 * Gate: 6
 * Phase: 6
 * Domain: SESSION + MENU
 * Purpose: Add composite index for exact snapshot lookup (session + universe + company)
 * Authority: Backend
 */

BEGIN;

-- =========================================================
-- FULL LOOKUP OPTIMIZATION (EXACT MATCH INDEX)
-- =========================================================
-- Covers query:
-- WHERE session_id = ?
--   AND universe = ?
--   AND company_id = ?

CREATE INDEX IF NOT EXISTS idx_session_menu_snapshot_full_lookup
ON erp_cache.session_menu_snapshot (session_id, universe, company_id);

COMMIT;