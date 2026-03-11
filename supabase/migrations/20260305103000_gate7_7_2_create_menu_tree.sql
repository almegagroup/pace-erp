/*
 * File-ID: 7.2
 * File-Path: supabase/migrations/20260305103000_gate7_7_2_create_menu_tree.sql
 * Gate: 7
 * Phase: 7
 * Domain: ACL
 * Purpose: Deterministic menu hierarchy (parent-child tree)
 * Authority: Backend
 */

BEGIN;

-- ============================================================
-- MENU TREE
-- Defines structural hierarchy only (no visibility / permission)
-- ============================================================

CREATE TABLE IF NOT EXISTS erp_menu.menu_tree (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  parent_menu_id    UUID REFERENCES erp_menu.menu_master(id) ON DELETE CASCADE,
  child_menu_id     UUID NOT NULL REFERENCES erp_menu.menu_master(id) ON DELETE CASCADE,

  display_order     INTEGER NOT NULL DEFAULT 0,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by        TEXT NOT NULL DEFAULT 'system'
);

COMMENT ON TABLE erp_menu.menu_tree IS
'Defines parent-child hierarchy between menu_master items. Pure structure only.';

-- A menu cannot be its own parent
ALTER TABLE erp_menu.menu_tree
ADD CONSTRAINT chk_no_self_parent
CHECK (parent_menu_id IS NULL OR parent_menu_id <> child_menu_id);

-- Each child can have only ONE parent
CREATE UNIQUE INDEX IF NOT EXISTS ux_menu_tree_single_parent
ON erp_menu.menu_tree (child_menu_id);

-- Ordering guarantee per parent
CREATE UNIQUE INDEX IF NOT EXISTS ux_menu_tree_order
ON erp_menu.menu_tree (parent_menu_id, display_order);

COMMIT;
