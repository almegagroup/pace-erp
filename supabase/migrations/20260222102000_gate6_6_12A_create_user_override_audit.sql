/*
 * File-ID: ID-6.12A
 * File-Path: supabase/migrations/20260222102000_gate6_6_12A_create_user_override_audit.sql
 * Gate: 6
 * Phase: 6
 * Domain: ACL
 * Purpose: Audit trail for all user override changes.
 * Authority: Backend
 */

BEGIN;

CREATE TABLE IF NOT EXISTS acl.user_override_audit (
  audit_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  override_id     uuid NOT NULL,

  action          text NOT NULL CHECK (action IN ('CREATE', 'REVOKE')),

  performed_by    uuid NOT NULL,
  performed_at    timestamptz NOT NULL DEFAULT now(),

  snapshot        jsonb NOT NULL
);

COMMENT ON TABLE acl.user_override_audit IS
'Append-only audit log for user override lifecycle events.';

ALTER TABLE acl.user_override_audit ENABLE ROW LEVEL SECURITY;

COMMIT;
