-- ============================================================
-- File-ID: ID-9.9.2B
-- File-Path: supabase/migrations/20260410114000_gate9_9_2B_company_kind_business_filter.sql
-- Gate: 9
-- Phase: 9
-- Domain: MASTER
-- Short_Name: Company kind truth
-- Purpose: Separate BUSINESS companies from SYSTEM-only rows for downstream governance filtering
-- Authority: Backend
-- ============================================================

BEGIN;

ALTER TABLE erp_master.companies
  ADD COLUMN IF NOT EXISTS company_kind text NOT NULL DEFAULT 'BUSINESS';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_company_kind_valid'
  ) THEN
    ALTER TABLE erp_master.companies
      ADD CONSTRAINT chk_company_kind_valid
      CHECK (company_kind IN ('BUSINESS', 'SYSTEM'));
  END IF;
END $$;

COMMENT ON COLUMN erp_master.companies.company_kind IS
'Distinguishes business-operational companies from internal system-only rows.';

UPDATE erp_master.companies
SET company_kind = 'SYSTEM'
WHERE lower(trim(company_name)) LIKE '%system admin%';

COMMIT;
