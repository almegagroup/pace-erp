/*
 * File-ID: ID-2.2D
 * File-Path: supabase/migrations/20260410107000_gate2_2_2D_session_role_cache.sql
 * Gate: 2
 * Phase: 2
 * Domain: SESSION
 * Purpose: Add role_code to session for zero-latency context resolution
 * Authority: Backend
 */

BEGIN;

-- =========================================================
-- 1️⃣ ADD ROLE CACHE COLUMN
-- =========================================================

ALTER TABLE erp_core.sessions
ADD COLUMN IF NOT EXISTS role_code TEXT;

COMMENT ON COLUMN erp_core.sessions.role_code IS
'Cached role_code at login time. Eliminates runtime role lookup.';

-- =========================================================
-- 2️⃣ INDEX FOR FAST CONTEXT RESOLUTION
-- =========================================================

CREATE INDEX IF NOT EXISTS idx_sessions_role_code
ON erp_core.sessions(role_code);

-- =========================================================
-- 3️⃣ OPTIONAL BACKFILL (SAFE)
-- =========================================================
-- NOTE:
-- This is best-effort only. Future sessions will always have role_code.

UPDATE erp_core.sessions s
SET role_code = r.role_code
FROM erp_map.user_company_roles r
WHERE s.auth_user_id = r.auth_user_id
AND s.role_code IS NULL;

COMMIT;