/*
 * File-ID: ID-6.18D
 * File-Path: supabase/migrations/20260410108000_gate6_6_18D_snapshot_lookup_index.sql
 * Gate: 6
 * Phase: 6
 * Domain: SESSION + MENU
 * Purpose: Add direct session_id index for ultra-fast snapshot lookup (hot path optimization)
 * Authority: Backend
 */

BEGIN;

-- =========================================================
-- HOT PATH OPTIMIZATION (SESSION LOOKUP)
-- =========================================================

CREATE INDEX IF NOT EXISTS idx_session_menu_snapshot_session_id
ON erp_cache.session_menu_snapshot (session_id);

COMMIT;