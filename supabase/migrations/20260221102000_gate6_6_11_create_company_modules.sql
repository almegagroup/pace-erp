/*
 * File-ID: ID-6.11
 * File-Path: supabase/migrations/20260221102000_gate6_6_11_create_company_module_map.sql
 * Gate: 6
 * Phase: 6
 * Domain: ACL
 * Purpose: Enable or disable business modules per company.
 * Authority: Backend
 */

BEGIN;

CREATE TABLE IF NOT EXISTS acl.company_module_map (
  company_id   uuid NOT NULL
    REFERENCES erp_master.companies(id)
    ON DELETE CASCADE,

  module_code  text NOT NULL,
  enabled      boolean NOT NULL DEFAULT true,

  created_at   timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (company_id, module_code)
);

COMMENT ON TABLE acl.company_module_map IS
'Canonical company → module enablement truth. If a module is not enabled here, the company must never access it regardless of role or capability.';

-- RLS posture (policies added in Gate-13)
ALTER TABLE acl.company_module_map ENABLE ROW LEVEL SECURITY;

COMMIT;
