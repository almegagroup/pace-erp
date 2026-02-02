-- ============================================================
-- File-ID: ID-6.4A
-- File-Path: supabase/migrations/202602102639000_gate6_6_4A_department_state_and_code.sql
-- Gate: 6
-- Phase: 6
-- Domain: MASTER
-- Short_Name: Department state rules
-- Purpose: Deterministic department_code + lifecycle invariants
-- Authority: Backend
-- ============================================================

BEGIN;

CREATE SEQUENCE IF NOT EXISTS erp_master.department_code_seq
  START WITH 1
  INCREMENT BY 1;

CREATE OR REPLACE FUNCTION erp_master.generate_department_code()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  seq_val bigint;
BEGIN
  SELECT nextval('erp_master.department_code_seq') INTO seq_val;
  RETURN 'DPT' || lpad(seq_val::text, 3, '0');
END;
$$;

ALTER TABLE erp_master.departments
  ALTER COLUMN department_code
  SET DEFAULT erp_master.generate_department_code();

ALTER TABLE erp_master.departments
  ADD CONSTRAINT department_status_check
  CHECK (status IN ('ACTIVE', 'INACTIVE'));

COMMIT;
