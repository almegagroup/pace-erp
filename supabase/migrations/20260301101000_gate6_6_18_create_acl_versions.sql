/*
 * File-ID: ID-6.18
 * File-Path: supabase/migrations/20260301101000_gate6_6_18_create_acl_versions.sql
 * Gate: 6
 * Phase: 6
 * Domain: ACL
 * Purpose: Version every ACL change-set for audit, rollback, deterministic snapshot binding.
 * Authority: Backend
 * Idempotent: YES (reset-safe)
 */

BEGIN;

-- ============================================================
-- ACL VERSION LEDGER (DETERMINISTIC + SAP STYLE)
-- ============================================================

CREATE TABLE IF NOT EXISTS acl.acl_versions (
  acl_version_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  company_id         uuid NOT NULL
    REFERENCES erp_master.companies(id)
    ON DELETE CASCADE,

  version_number     integer NOT NULL,
  description        text NOT NULL,

  -- 🔥 deterministic activation control
  is_active          boolean NOT NULL DEFAULT false,

  created_by         uuid NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_acl_version_per_company
    UNIQUE (company_id, version_number),

  CONSTRAINT chk_acl_version_description_not_empty
    CHECK (length(trim(description)) > 0)
);

-- ============================================================
-- ONE ACTIVE VERSION PER COMPANY (STRICT GUARANTEE)
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_acl_one_active_per_company
ON acl.acl_versions(company_id)
WHERE is_active = true;

-- ============================================================
-- RLS ENABLE (Policies defined elsewhere)
-- ============================================================

ALTER TABLE acl.acl_versions ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE acl.acl_versions IS
'Immutable ACL version ledger. One company = one active version. Used for deterministic snapshot binding, audit, rollback, and governance safety.';

COMMIT;