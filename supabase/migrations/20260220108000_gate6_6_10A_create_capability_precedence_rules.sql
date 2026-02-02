/*
 * File-ID: ID-6.10A
 * File-Path: supabase/migrations/20260221101030_gate6_6_10A_create_capability_precedence_rules.sql
 * Gate: 6
 * Phase: 6
 * Domain: ACL
 * Purpose: Define precedence rules between role rules and capability permissions.
 * Authority: Backend
 */

BEGIN;

CREATE TABLE IF NOT EXISTS acl.capability_precedence_rules (
  rule_code   TEXT PRIMARY KEY,
  priority    INT NOT NULL,
  description TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE acl.capability_precedence_rules IS
'Defines conflict resolution order (e.g., ROLE_DENY > CAPABILITY_ALLOW). Execution happens in Gate-10 ACL engine.';


ALTER TABLE acl.capability_precedence_rules ENABLE ROW LEVEL SECURITY;
COMMIT;
