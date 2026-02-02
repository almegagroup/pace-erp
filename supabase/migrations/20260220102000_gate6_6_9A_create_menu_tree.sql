/*
 * File-ID: ID-6.9A
 * File-Path: supabase/migrations/20260220102000_gate6_6_9A_create_menu_tree.sql
 * Gate: 6
 * Phase: 6
 * Domain: ACL
 * Purpose: Define hierarchical relationships between menu resources.
 * Authority: Backend
 */

BEGIN;

CREATE TABLE IF NOT EXISTS acl.menu_tree (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_menu_id  uuid REFERENCES acl.menu_master(id) ON DELETE CASCADE,
  child_menu_id   uuid NOT NULL REFERENCES acl.menu_master(id) ON DELETE CASCADE,
  sort_order      int NOT NULL DEFAULT 0,
  CONSTRAINT menu_tree_no_self_reference
    CHECK (parent_menu_id IS NULL OR parent_menu_id <> child_menu_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_menu_tree_unique
  ON acl.menu_tree (parent_menu_id, child_menu_id);

COMMENT ON TABLE acl.menu_tree IS
'Menu hierarchy (menu → submenu → sub-submenu). Fully data-driven.';

ALTER TABLE acl.menu_tree ENABLE ROW LEVEL SECURITY;

COMMIT;
