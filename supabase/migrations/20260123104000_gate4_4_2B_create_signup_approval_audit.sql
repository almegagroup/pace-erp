/*
 * File-ID: 4.2B
 * Gate: 4
 * Phase: 4
 * Domain: DB
 * Purpose: Append-only audit log for signup approval decisions
 * Authority: Backend
 */

BEGIN;

CREATE TABLE IF NOT EXISTS erp_audit.signup_approvals (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Who decided
  actor_auth_user_id UUID NOT NULL,

  -- Who was decided on
  target_auth_user_id UUID NOT NULL,

  -- Decision taken
  decision            TEXT NOT NULL
                       CHECK (decision IN ('APPROVED', 'REJECTED')),

  -- Optional metadata (no PII mandate)
  meta                JSONB,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for audit queries
CREATE INDEX IF NOT EXISTS idx_signup_approvals_actor
  ON erp_audit.signup_approvals (actor_auth_user_id);

CREATE INDEX IF NOT EXISTS idx_signup_approvals_target
  ON erp_audit.signup_approvals (target_auth_user_id);

CREATE INDEX IF NOT EXISTS idx_signup_approvals_created_at
  ON erp_audit.signup_approvals (created_at);

-- Security posture
ALTER TABLE erp_audit.signup_approvals ENABLE ROW LEVEL SECURITY;

COMMIT;
