/*
 * File-ID: ID-6.9A
 * File-Path: supabase/migrations/20260220103000_gate6_6_9A_create_menu_actions.sql
 * Gate: 6
 * Phase: 6
 * Domain: ACL
 * Purpose: Declare allowed actions (VWED + custom) per menu resource.
 * Authority: Backend
 */

BEGIN;

CREATE TABLE IF NOT EXISTS acl.menu_actions (
  menu_id uuid NOT NULL
    REFERENCES acl.menu_master(id) ON DELETE CASCADE,
  action  text NOT NULL,
  PRIMARY KEY (menu_id, action)
);

COMMENT ON TABLE acl.menu_actions IS
'Defines action vocabulary per menu (VIEW, WRITE, EDIT, DELETE, APPROVE, EXPORT, etc).';

ALTER TABLE acl.menu_actions ENABLE ROW LEVEL SECURITY;

COMMIT;
