/*
 * File-ID: ID-6.18C
 * File-Path: supabase/migrations/20260410106000_gate6_6_18C_session_menu_snapshot.sql
 * Gate: 6
 * Phase: 6
 * Domain: SESSION + MENU
 * Purpose: Attach precomputed menu snapshot to session for ultra-fast retrieval (SA + ACL unified)
 * Authority: Backend
 */

BEGIN;

-- =========================================================
-- SCHEMA: ERP CACHE (IF NOT EXISTS)
-- =========================================================
-- Dedicated cache schema for session-bound snapshots

CREATE SCHEMA IF NOT EXISTS erp_cache;

-- =========================================================
-- SESSION MENU SNAPSHOT (UNIFIED SA + ACL)
-- =========================================================
-- This table stores precomputed menu per session.
-- Eliminates runtime menu query latency.
-- Supports both SA (global) and ACL (company-scoped) universes.

CREATE TABLE IF NOT EXISTS erp_cache.session_menu_snapshot (

  snapshot_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Session binding
  session_id        UUID NOT NULL
    REFERENCES erp_core.sessions(session_id)
    ON DELETE CASCADE,

  auth_user_id      UUID NOT NULL,

  -- Universe separation (SA / GA / ACL)
  universe          TEXT NOT NULL
    CHECK (universe IN ('SA', 'GA', 'ACL')),

  -- Company context (NULL for SA/GA)
  company_id        UUID NULL,

  -- Snapshot version reference
  snapshot_version  INTEGER NOT NULL,

  -- Prebuilt menu payload (UI-ready)
  menu_json         JSONB NOT NULL,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Prevent duplicate snapshot per session context
  CONSTRAINT uq_session_menu_context
    UNIQUE (session_id, universe, company_id)

);

COMMENT ON TABLE erp_cache.session_menu_snapshot IS
'Session-bound menu snapshot. Eliminates runtime menu query. Supports SA (global) and ACL (company-scoped) access.';

-- =========================================================
-- INDEXES (PERFORMANCE CRITICAL)
-- =========================================================

-- SA / GA fast lookup
CREATE INDEX IF NOT EXISTS idx_session_menu_snapshot_session_universe
ON erp_cache.session_menu_snapshot (session_id, universe);

-- ACL fast lookup (company scoped)
CREATE INDEX IF NOT EXISTS idx_session_menu_snapshot_session_company_universe
ON erp_cache.session_menu_snapshot (session_id, company_id, universe);

-- Debug / admin support
CREATE INDEX IF NOT EXISTS idx_session_menu_snapshot_user
ON erp_cache.session_menu_snapshot (auth_user_id);

-- =========================================================
-- SECURITY POSTURE
-- =========================================================

ALTER TABLE erp_cache.session_menu_snapshot ENABLE ROW LEVEL SECURITY;

-- No policies defined (service-role only access)

COMMIT;