-- ============================================================
-- File-ID: ID-9.9.2C
-- File-Path: supabase/migrations/20260410115000_gate9_9_2C_company_address_fields.sql
-- Gate: 9
-- Phase: 9
-- Domain: MASTER
-- Short_Name: Company address fields
-- Purpose: Extend company master with GST-derived state, full address, and pin code fields
-- Authority: Backend
-- ============================================================

BEGIN;

ALTER TABLE erp_master.companies
  ADD COLUMN IF NOT EXISTS state_name text NULL;

ALTER TABLE erp_master.companies
  ADD COLUMN IF NOT EXISTS full_address text NULL;

ALTER TABLE erp_master.companies
  ADD COLUMN IF NOT EXISTS pin_code text NULL;

COMMENT ON COLUMN erp_master.companies.state_name IS
'State name resolved from GST profile or captured manually for the company record.';

COMMENT ON COLUMN erp_master.companies.full_address IS
'Single-field full registered address resolved from GST profile or captured manually.';

COMMENT ON COLUMN erp_master.companies.pin_code IS
'Postal PIN code resolved from GST profile or captured manually.';

COMMIT;
