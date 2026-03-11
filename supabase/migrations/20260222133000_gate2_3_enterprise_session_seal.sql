/*
 * File-ID: 2.9
 * File-Path: supabase/migrations/20260222133000_gate2_3_enterprise_session_seal.sql
 * Gate: 2 + 3
 * Phase: 2 + 3
 * Domain: DB
 * Purpose: Enterprise hard seal for ERP session authority & lifecycle integrity
 * Authority: Backend
 */

BEGIN;

-- =========================================================
-- ENTERPRISE SESSION HARD SEAL
-- =========================================================
-- This migration finalizes Gate-2 and Gate-3 DB authority.
-- It introduces:
-- 1) Admin revoke traceability
-- 2) DB-level single ACTIVE session enforcement
-- 3) TTL integrity constraint
--
-- No behavioral logic change.
-- Schema-only deterministic reinforcement.
-- =========================================================


-- =========================================================
-- 1️⃣ ADMIN REVOKE TRACEABILITY
-- =========================================================
-- Add revoked_by column for governance-grade auditability.

ALTER TABLE erp_core.sessions
ADD COLUMN IF NOT EXISTS revoked_by UUID NULL;

-- Ensure FK integrity (auth_user_id in erp_core.users)
ALTER TABLE erp_core.sessions
DROP CONSTRAINT IF EXISTS sessions_revoked_by_fk;

ALTER TABLE erp_core.sessions
ADD CONSTRAINT sessions_revoked_by_fk
FOREIGN KEY (revoked_by)
REFERENCES erp_core.users(auth_user_id);


-- =========================================================
-- 2️⃣ SINGLE ACTIVE SESSION ENFORCEMENT (DB LEVEL)
-- =========================================================
-- Prevent race conditions.
-- Only ONE ACTIVE session per auth_user_id allowed.

CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_session_per_user
ON erp_core.sessions (auth_user_id)
WHERE status = 'ACTIVE';


-- =========================================================
-- 3️⃣ TTL INTEGRITY ENFORCEMENT
-- =========================================================
-- Ensure expires_at always greater than created_at.
-- Prevent corrupted TTL rows.

ALTER TABLE erp_core.sessions
DROP CONSTRAINT IF EXISTS session_ttl_consistency_check;

ALTER TABLE erp_core.sessions
ADD CONSTRAINT session_ttl_consistency_check
CHECK (expires_at > created_at);

-- =========================================================
-- 1️⃣A DEVICE SIGNAL SUPPORT (SOFT)
-- =========================================================
-- Purpose:
-- Store device fingerprint metadata for anomaly observation.
-- This is a NON-authoritative signal.
-- No access-control decision depends on this.

ALTER TABLE erp_core.sessions
ADD COLUMN IF NOT EXISTS device_id TEXT NULL;

ALTER TABLE erp_core.sessions
ADD COLUMN IF NOT EXISTS device_summary TEXT NULL;

-- Optional index for future anomaly analytics
CREATE INDEX IF NOT EXISTS idx_sessions_device_user
ON erp_core.sessions (auth_user_id, device_id);

-- =========================================================
-- SECURITY POSTURE
-- =========================================================
-- RLS remains ENABLED and FORCE.
-- No policy change introduced here.
-- Service role remains authoritative execution surface.

COMMIT;