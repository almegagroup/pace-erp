/*
 * File-ID: ID-6.12
 * File-Path: supabase/migrations/20260222101000_gate6_6_12_create_user_overrides.sql
 * Gate: 6
 * Phase: 6
 * Domain: ACL
 * Purpose: Define explicit per-user allow/deny overrides for menu actions.
 * Authority: Backend
 */

BEGIN;

CREATE TABLE IF NOT EXISTS acl.user_overrides (
  override_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  user_id uuid NOT NULL
    REFERENCES auth.users(id)
    ON DELETE CASCADE,

  company_id uuid NOT NULL
    REFERENCES erp_master.companies(id)
    ON DELETE CASCADE,

  resource_code text NOT NULL,
  action_code   text NOT NULL,

  effect text NOT NULL
    CHECK (effect IN ('ALLOW', 'DENY')),

  reason text NOT NULL,

  created_by uuid NOT NULL
    REFERENCES auth.users(id)
    ON DELETE RESTRICT,

  created_at timestamptz NOT NULL DEFAULT now(),

  revoked_at timestamptz NULL,
  revoked_by uuid NULL
    REFERENCES auth.users(id)
    ON DELETE RESTRICT,

  CONSTRAINT uq_active_user_override
    UNIQUE (user_id, company_id, resource_code, action_code)
);

COMMENT ON TABLE acl.user_overrides IS
'Explicit per-user permission overrides. Evaluated by ACL decision engine before role and capability layers.';

ALTER TABLE acl.user_overrides ENABLE ROW LEVEL SECURITY;

COMMIT;