/*
 * File-ID: 7.3
 * File-Path: supabase/migrations/20260306101000_gate7_7_3_create_menu_snapshot.sql
 * Gate: 7
 * Phase: 7
 * Domain: ACL
 * Purpose: Deterministic menu snapshot per user-context
 * Authority: Backend
 */

BEGIN;

-- ============================================================
-- MENU SNAPSHOT
-- Frozen, per-user, per-context resolved menu visibility
-- ============================================================

CREATE SCHEMA IF NOT EXISTS erp_menu;

CREATE TABLE IF NOT EXISTS erp_menu.menu_snapshot (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  user_id         UUID NOT NULL,
  company_id      UUID NOT NULL,

  universe        TEXT NOT NULL CHECK (universe IN ('SA', 'ACL')),

  snapshot_version INTEGER NOT NULL DEFAULT 1,

  menu_code       TEXT NOT NULL,
  resource_code   TEXT NOT NULL,
  route_path      TEXT,
  menu_type       TEXT NOT NULL CHECK (menu_type IN ('GROUP', 'PAGE')),

  parent_menu_code TEXT,
  display_order    INTEGER NOT NULL,

  is_visible       BOOLEAN NOT NULL DEFAULT true,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE erp_menu.menu_snapshot IS
'Frozen menu snapshot per user + company + universe. This is the ONLY source of truth for frontend menu rendering.';

COMMENT ON COLUMN erp_menu.menu_snapshot.snapshot_version IS
'Monotonically increasing version identifier for snapshot regeneration.';

-- Prevent duplicates inside a snapshot
CREATE UNIQUE INDEX IF NOT EXISTS ux_menu_snapshot_identity
ON erp_menu.menu_snapshot (
  user_id,
  company_id,
  universe,
  snapshot_version,
  menu_code
);

COMMIT;
