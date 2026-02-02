/*
 * File-ID: ID-6.10
 * File-Path: supabase/migrations/20260221101010_gate6_6_10_create_capability_menu_actions.sql
 * Gate: 6
 * Phase: 6
 * Domain: ACL
 * Purpose: Bind capability packs to menu actions (VWED truth).
 * Authority: Backend
 */

BEGIN;

CREATE TABLE IF NOT EXISTS acl.capability_menu_actions (
  capability_code TEXT NOT NULL
    REFERENCES acl.capabilities(capability_code)
    ON DELETE CASCADE,

  menu_id UUID NOT NULL
    REFERENCES acl.menu_master(id)
    ON DELETE CASCADE,

  action TEXT NOT NULL,
  allowed BOOLEAN NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (capability_code, menu_id, action)
);

COMMENT ON TABLE acl.capability_menu_actions IS
'Defines which menu actions are allowed or denied by a capability pack. Execution is deferred to ACL engine (Gate-10).';
ALTER TABLE acl.capability_menu_actions ENABLE ROW LEVEL SECURITY;
COMMIT;
