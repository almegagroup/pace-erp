-- ============================================================
-- File-ID: ID-6.2A
-- File-Path: supabase/migrations/20260126131000_gate6_6_2A_company_code_generator.sql
-- Gate: 6
-- Phase: 6
-- Domain: MASTER
-- Short_Name: Company code + GST invariants
-- Purpose: Deterministic company_code generation and GST uniqueness enforcement
-- Authority: Backend
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1) Company code sequence
-- ------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS erp_master.company_code_seq
  START WITH 1
  INCREMENT BY 1
  MINVALUE 1
  NO MAXVALUE
  CACHE 1;

COMMENT ON SEQUENCE erp_master.company_code_seq IS
'Sequence for deterministic company_code generation: CMP001, CMP002, ...';

-- ------------------------------------------------------------
-- 2) Company code generator function (RPC-safe)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION erp_master.generate_company_code()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  seq_val bigint;
BEGIN
  SELECT nextval('erp_master.company_code_seq') INTO seq_val;
  RETURN 'CMP' || lpad(seq_val::text, 3, '0');
END;
$$;

COMMENT ON FUNCTION erp_master.generate_company_code IS
'Generates deterministic company_code like CMP001. Backend-only usage.';

-- ------------------------------------------------------------
-- 3) Set default company_code
-- ------------------------------------------------------------
ALTER TABLE erp_master.companies
  ALTER COLUMN company_code
  SET DEFAULT erp_master.generate_company_code();

-- ------------------------------------------------------------
-- 4) GST number column
-- ------------------------------------------------------------
ALTER TABLE erp_master.companies
  ADD COLUMN IF NOT EXISTS gst_number text;

COMMENT ON COLUMN erp_master.companies.gst_number IS
'GSTIN of the company. Must be unique if provided.';

-- ------------------------------------------------------------
-- 5) GST normalization rule (Postgres-safe)
-- ------------------------------------------------------------
ALTER TABLE erp_master.companies
  ADD CONSTRAINT companies_gst_format_check
  CHECK (
    gst_number IS NULL
    OR gst_number = upper(trim(gst_number))
  );

-- ------------------------------------------------------------
-- 6) GST uniqueness (NULL allowed)
-- ------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_companies_gst_number
  ON erp_master.companies (gst_number)
  WHERE gst_number IS NOT NULL;

COMMIT;
