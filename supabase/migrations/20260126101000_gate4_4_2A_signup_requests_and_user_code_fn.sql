/*
 * File-ID: 4.2A
 * File-Path: supabase/migrations/20260126101000_gate4_4_2A_signup_requests_and_user_code_fn.sql
 * Gate: 4
 * Phase: 4
 * Domain: DB
 * Purpose: Create signup_requests table + deterministic P0001 user_code generator (RPC-safe)
 * Authority: Backend
 */

BEGIN;

-- =========================================================
-- 1) SIGNUP REQUESTS (SA review surface)
-- =========================================================
CREATE TABLE IF NOT EXISTS erp_core.signup_requests (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  auth_user_id          UUID NOT NULL UNIQUE,

  -- captured metadata (non-authoritative)
  name                 TEXT NOT NULL DEFAULT 'UNKNOWN',
  parent_company_name  TEXT NOT NULL DEFAULT 'UNKNOWN',
  designation_hint     TEXT,
  phone_number         TEXT,

  -- decision workflow
  decision             TEXT NOT NULL DEFAULT 'PENDING'
                       CHECK (decision IN ('PENDING', 'APPROVED', 'REJECTED')),
  submitted_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at          TIMESTAMPTZ,
  reviewed_by          UUID,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_signup_requests_decision_submitted
  ON erp_core.signup_requests (decision, submitted_at);

ALTER TABLE erp_core.signup_requests ENABLE ROW LEVEL SECURITY;
-- No policies here by design (later gate)

-- =========================================================
-- 2) USER CODE SEQUENCE (P0001 ...)
-- =========================================================
CREATE SEQUENCE IF NOT EXISTS erp_core.user_code_p_seq
  START WITH 1
  INCREMENT BY 1
  NO CYCLE;

-- Ensure service_role can use the sequence deterministically
GRANT USAGE, SELECT ON SEQUENCE erp_core.user_code_p_seq TO service_role;

-- =========================================================
-- 3) RPC-SAFE FUNCTION (Supabase .rpc can call ONLY SQL functions)
-- =========================================================
CREATE SCHEMA IF NOT EXISTS erp_meta;

CREATE OR REPLACE FUNCTION erp_meta.next_user_code_p_seq()
RETURNS BIGINT
LANGUAGE SQL
SECURITY DEFINER
AS $$
  SELECT nextval('erp_core.user_code_p_seq');
$$;

-- Lock execution to backend authority only
REVOKE ALL ON FUNCTION erp_meta.next_user_code_p_seq() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_meta.next_user_code_p_seq() TO service_role;

COMMIT;
