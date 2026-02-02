/*
 * File-ID: ID-6.9A
 * File-Path: supabase/migrations/20260220101000_gate6_6_9A_create_menu_master.sql
 * Gate: 6
 * Phase: 6
 * Domain: ACL
 * Purpose: Define canonical menu resources as first-class ACL entities.
 * Authority: Backend
 */

BEGIN;

CREATE SCHEMA IF NOT EXISTS acl;

CREATE TABLE IF NOT EXISTS acl.menu_master (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_code     text NOT NULL UNIQUE,
  display_name  text NOT NULL,
  description   text,
  is_system     boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid
);

COMMENT ON TABLE acl.menu_master IS
'Canonical menu resources. Names and hierarchy are data-driven; no hardcoded menus.';

-- RLS posture (policies added later)
ALTER TABLE acl.menu_master ENABLE ROW LEVEL SECURITY;

COMMIT;
