/*
 * File-ID: ID-6.10
 * File-Path: supabase/migrations/20260221101000_gate6_6_10_create_capabilities.sql
 * Gate: 6
 * Phase: 6
 * Domain: ACL
 * Purpose: Define canonical capability packs as reusable permission units.
 * Authority: Backend
 */

BEGIN;

CREATE SCHEMA IF NOT EXISTS acl;

CREATE TABLE IF NOT EXISTS acl.capabilities (
  capability_code TEXT PRIMARY KEY,
  capability_name TEXT NOT NULL,
  description     TEXT,
  is_system       BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE acl.capabilities IS
'Capability packs are reusable permission bundles. Roles never directly map to menu actions once capabilities are used.';
ALTER TABLE acl.capabilities ENABLE ROW LEVEL SECURITY;

COMMIT;
