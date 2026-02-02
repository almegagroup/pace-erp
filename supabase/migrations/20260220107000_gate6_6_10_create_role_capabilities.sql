/*
 * File-ID: ID-6.10
 * File-Path: supabase/migrations/20260221101020_gate6_6_10_create_role_capabilities.sql
 * Gate: 6
 * Phase: 6
 * Domain: ACL
 * Purpose: Assign capability packs to roles.
 * Authority: Backend
 */

BEGIN;

CREATE TABLE IF NOT EXISTS acl.role_capabilities (
  role_code       TEXT NOT NULL,
  capability_code TEXT NOT NULL
    REFERENCES acl.capabilities(capability_code)
    ON DELETE CASCADE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (role_code, capability_code)
);

COMMENT ON TABLE acl.role_capabilities IS
'Roles inherit permissions exclusively via capability packs, reducing role × menu explosion.';

ALTER TABLE acl.role_capabilities ENABLE ROW LEVEL SECURITY;

COMMIT;
