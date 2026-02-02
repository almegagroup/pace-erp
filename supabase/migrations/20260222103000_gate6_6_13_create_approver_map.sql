/*
 * File-ID: ID-6.13
 * File-Path: supabase/migrations/20260222102000_gate6_6_13_create_approver_map.sql
 * Gate: 6
 * Phase: 6
 * Domain: ACL
 * Purpose: Define deterministic approver routing rules per company and module category.
 * Authority: Backend
 */

BEGIN;

CREATE TABLE IF NOT EXISTS acl.approver_map (
  approver_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  company_id         uuid NOT NULL,
  module_code        text NOT NULL,
  approval_stage     int  NOT NULL CHECK (approval_stage > 0),

  approver_role_code text NOT NULL,
  approver_user_id   uuid NULL,

  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid NOT NULL,

  CONSTRAINT uq_company_module_stage
    UNIQUE (company_id, module_code, approval_stage),

  CONSTRAINT ck_role_or_user_required
    CHECK (
      approver_role_code IS NOT NULL
      OR approver_user_id IS NOT NULL
    )
);

COMMENT ON TABLE acl.approver_map IS
'Deterministic approval routing rules per company and module category.
Defines ordered approval stages resolved by role or explicit user.
Consumed by approval workflow engine in later Gates.';

ALTER TABLE acl.approver_map ENABLE ROW LEVEL SECURITY;

COMMIT;
