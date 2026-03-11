/*
 * File-ID: 7.1
 * File-Path: supabase/migrations/20260305101000_gate7_7_1_create_menu_master.sql
 * Gate: 7
 * Phase: 7
 * Domain: ACL
 * Purpose: Canonical menu registry defining all menu resources and routes
 * Authority: Backend
 */

BEGIN;

-- ============================================================
-- MENU MASTER
-- Canonical registry of ALL menu items visible in the system.
-- This defines existence, not permission or visibility.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS erp_menu;

CREATE TABLE IF NOT EXISTS erp_menu.menu_master (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  menu_code         TEXT NOT NULL,
  resource_code     TEXT NOT NULL,

  title             TEXT NOT NULL,
  description       TEXT,

  route_path        TEXT,               -- NULL allowed for GROUP nodes
  menu_type         TEXT NOT NULL CHECK (menu_type IN ('GROUP', 'PAGE')),

  universe          TEXT NOT NULL CHECK (universe IN ('SA', 'ACL')),
  is_system          BOOLEAN NOT NULL DEFAULT false,

  display_order     INTEGER NOT NULL DEFAULT 0,
  is_active         BOOLEAN NOT NULL DEFAULT true,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by        TEXT NOT NULL DEFAULT 'system',

  updated_at        TIMESTAMPTZ,
  updated_by        TEXT
);

COMMENT ON TABLE erp_menu.menu_master IS
'Canonical menu registry. Defines what menu items exist. No permissions, no visibility rules.';

COMMENT ON COLUMN erp_menu.menu_master.menu_code IS
'Stable unique identifier for menu item (human-readable, immutable).';

COMMENT ON COLUMN erp_menu.menu_master.resource_code IS
'ACL resource_code linked to menu item (used later by ACL decision engine).';

COMMENT ON COLUMN erp_menu.menu_master.route_path IS
'Frontend route path. NULL for GROUP nodes.';

COMMENT ON COLUMN erp_menu.menu_master.menu_type IS
'GROUP = non-clickable parent; PAGE = navigable menu item.';

COMMIT;
