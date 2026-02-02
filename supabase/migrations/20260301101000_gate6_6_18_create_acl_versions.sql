/*
 * File-ID: ID-6.18
 * File-Path: supabase/migrations/20260223101000_gate6_6_18_create_acl_versions.sql
 * Gate: 6
 * Phase: 6
 * Domain: ACL
 * Purpose: Version every ACL change-set for audit, rollback, and snapshot binding.
 * Authority: Backend
 */

BEGIN;

CREATE TABLE IF NOT EXISTS acl.acl_versions (
  acl_version_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  company_id         uuid NOT NULL
    REFERENCES erp_master.companies(id)
    ON DELETE CASCADE,

  version_number     integer NOT NULL,
  description        text NOT NULL,

  created_by         uuid NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_acl_version_per_company
    UNIQUE (company_id, version_number)
);

COMMENT ON TABLE acl.acl_versions IS
'Immutable ACL version ledger. Every permission change must create a new ACL version. Used for snapshot binding, audit, and rollback.';

ALTER TABLE acl.acl_versions ENABLE ROW LEVEL SECURITY;

COMMIT;
