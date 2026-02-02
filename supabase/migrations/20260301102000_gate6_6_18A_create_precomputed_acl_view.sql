/*
 * File-ID: ID-6.18A
 * File-Path: supabase/migrations/20260223102000_gate6_6_18A_create_precomputed_acl_view.sql
 * Gate: 6
 * Phase: 6
 * Domain: ACL
 * Purpose: Precompute final ACL decision snapshot per user/context for fast enforcement.
 * Authority: Backend
 */

BEGIN;

CREATE TABLE IF NOT EXISTS acl.precomputed_acl_view (
  snapshot_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  acl_version_id     uuid NOT NULL
    REFERENCES acl.acl_versions(acl_version_id)
    ON DELETE CASCADE,

  auth_user_id       uuid NOT NULL,
  company_id         uuid NOT NULL,

  project_id         uuid NULL,
  department_id      uuid NULL,

  resource_code      text NOT NULL,
  action_code        text NOT NULL,

  decision           text NOT NULL CHECK (decision IN ('ALLOW', 'DENY')),
  decision_reason    text NOT NULL,

  computed_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_acl_snapshot_identity
    UNIQUE (
      acl_version_id,
      auth_user_id,
      company_id,
      project_id,
      department_id,
      resource_code,
      action_code
    )
);

COMMENT ON TABLE acl.precomputed_acl_view IS
'Precomputed final ACL decisions. Used by enforcement layer to avoid runtime ACL computation. Snapshot is immutable per ACL version.';

ALTER TABLE acl.precomputed_acl_view ENABLE ROW LEVEL SECURITY;

COMMIT;
