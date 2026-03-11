/*
 * File-ID: 9.2
 * File-Path: supabase/migrations/20260315100500_gate9_9_2_company_master_assertions.sql
 * Gate: 9
 * Phase: 9
 * Domain: MASTER
 * Purpose: Reinforce company master invariants for Admin Universe
 * Authority: Backend
 */

BEGIN;

-- ============================================================
-- COMPANY MASTER ASSERTIONS (ADMIN UNIVERSE)
-- This migration does NOT create the company table.
-- It locks semantic guarantees relied upon by Gate-9+.
-- ============================================================

-- Ensure company state enum values are constrained
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_company_status_valid'
  ) THEN
    ALTER TABLE erp_master.companies
      ADD CONSTRAINT chk_company_status_valid
      CHECK (status IN ('ACTIVE', 'INACTIVE'));
  END IF;
END;
$$;

-- Ensure company_code is immutable once set
CREATE OR REPLACE FUNCTION erp_master.prevent_company_code_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.company_code IS DISTINCT FROM OLD.company_code THEN
    RAISE EXCEPTION
      'COMPANY_CODE_IMMUTABLE: company_code cannot be changed';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_company_code_update
ON erp_master.companies;

CREATE TRIGGER trg_prevent_company_code_update
BEFORE UPDATE
ON erp_master.companies
FOR EACH ROW
EXECUTE FUNCTION erp_master.prevent_company_code_update();

-- Ensure GST number remains unique (defensive re-assertion)
CREATE UNIQUE INDEX IF NOT EXISTS ux_companies_gst_number
ON erp_master.companies (gst_number)
WHERE gst_number IS NOT NULL;

COMMIT;
