/*
 * File-ID: ID-9.14
 * File-Path: supabase/migrations/20260307120000_gate9_9_14_create_admin_action_audit.sql
 * Gate: 9
 * Phase: 9
 * Domain: AUDIT
 * Purpose: Append-only audit trail for all administrative actions.
 * Authority: Backend
 */

BEGIN;

/* =========================================================
 * Ensure schema exists
 * ========================================================= */

CREATE SCHEMA IF NOT EXISTS erp_audit;

/* =========================================================
 * Admin Action Audit Table
 * ========================================================= */

CREATE TABLE IF NOT EXISTS erp_audit.admin_action_audit (

  audit_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  request_id uuid NOT NULL,

  admin_user_id uuid NOT NULL
    REFERENCES auth.users(id)
    ON DELETE RESTRICT,

  action_code text NOT NULL,

  resource_type text,

  resource_id text,

  company_id uuid,

  performed_at timestamptz NOT NULL DEFAULT now(),

  status text NOT NULL
    CHECK (status IN ('SUCCESS','FAILED')),

  snapshot jsonb NOT NULL

);

/* =========================================================
 * Documentation
 * ========================================================= */

COMMENT ON TABLE erp_audit.admin_action_audit IS
'Append-only audit log for all administrative control-plane actions.';

/* =========================================================
 * Security
 * ========================================================= */

ALTER TABLE erp_audit.admin_action_audit
ENABLE ROW LEVEL SECURITY;

/* =========================================================
 * Performance Indexes
 * ========================================================= */

CREATE INDEX IF NOT EXISTS idx_admin_action_audit_request
ON erp_audit.admin_action_audit (request_id);

CREATE INDEX IF NOT EXISTS idx_admin_action_audit_admin_user
ON erp_audit.admin_action_audit (admin_user_id);

CREATE INDEX IF NOT EXISTS idx_admin_action_audit_company
ON erp_audit.admin_action_audit (company_id);

CREATE INDEX IF NOT EXISTS idx_admin_action_audit_performed_at
ON erp_audit.admin_action_audit (performed_at DESC);

/* =========================================================
 * End Migration
 * ========================================================= */

COMMIT;