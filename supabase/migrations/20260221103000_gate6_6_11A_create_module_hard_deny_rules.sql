/*
 * File-ID: ID-6.11A
 * File-Path: supabase/migrations/20260221102010_gate6_6_11A_create_company_module_deny_rules.sql
 * Gate: 6
 * Phase: 6
 * Domain: ACL
 * Purpose: Define hard-deny precedence when a module is not enabled for a company.
 * Authority: Backend
 */

BEGIN;

CREATE TABLE IF NOT EXISTS acl.company_module_deny_rules (
  rule_code   text PRIMARY KEY,
  priority    int NOT NULL,
  description text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE acl.company_module_deny_rules IS
'Fail-safe precedence rules: module-level deny overrides role and capability permissions. Evaluated by ACL engine in Gate-10.';

-- RLS posture (policies added later)
ALTER TABLE acl.company_module_deny_rules ENABLE ROW LEVEL SECURITY;

COMMIT;
