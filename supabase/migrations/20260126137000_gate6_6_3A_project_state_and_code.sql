-- ============================================================
-- File-ID: ID-6.3A
-- File-Path: supabase/migrations/20260126137000_gate6_6_3A_project_state_and_code.sql
-- Gate: 6
-- Phase: 6
-- Domain: MASTER
-- Short_Name: Project state rules
-- Purpose: Deterministic project_code + lifecycle invariants
-- Authority: Backend
-- ============================================================

BEGIN;

CREATE SEQUENCE IF NOT EXISTS erp_master.project_code_seq
  START WITH 1
  INCREMENT BY 1;

CREATE OR REPLACE FUNCTION erp_master.generate_project_code()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  seq_val bigint;
BEGIN
  SELECT nextval('erp_master.project_code_seq') INTO seq_val;
  RETURN 'PRJ' || lpad(seq_val::text, 3, '0');
END;
$$;

ALTER TABLE erp_master.projects
  ALTER COLUMN project_code
  SET DEFAULT erp_master.generate_project_code();

ALTER TABLE erp_master.projects
  ADD CONSTRAINT project_status_check
  CHECK (status IN ('ACTIVE', 'INACTIVE'));

COMMIT;
