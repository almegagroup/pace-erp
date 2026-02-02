/*
 * File-ID: ID-6.9
 * File-Path: supabase/migrations/20260220104000_gate6_6_9_create_role_menu_permissions.sql
 * Gate: 6
 * Phase: 6
 * Domain: ACL
 * Purpose: Define role-wise permission truth on menu actions (VWED).
 * Authority: Backend
 */

BEGIN;

CREATE TABLE IF NOT EXISTS acl.role_menu_permissions (
  role_code          text NOT NULL,
  menu_id            uuid NOT NULL
    REFERENCES acl.menu_master(id) ON DELETE CASCADE,
  action             text NOT NULL,
  effect             text NOT NULL CHECK (effect IN ('ALLOW', 'DENY')),
  approval_required  boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (role_code, menu_id, action)
);

COMMENT ON TABLE acl.role_menu_permissions IS
'Base permission truth: role → menu → action. Absence of row = default DENY.';

ALTER TABLE acl.role_menu_permissions ENABLE ROW LEVEL SECURITY;

COMMIT;
