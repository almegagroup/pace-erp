-- ============================================================
-- File-ID: 6.3B
-- File-Path: supabase/migrations/20260402101000_gate6_6_3B_sap_project_decoupling.sql
-- Gate: 6
-- Phase: 6
-- Domain: MASTER
-- Short_Name: Project SAP decoupling
-- Purpose: Remove direct company binding from projects table.
--          Enforce SAP-style reusable project model.
-- Authority: Backend
-- Idempotent: YES
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1) Drop foreign key constraint (projects_company_id_fkey)
-- ------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'projects_company_id_fkey'
  ) THEN
    ALTER TABLE erp_master.projects
      DROP CONSTRAINT projects_company_id_fkey;
  END IF;
END
$$;

-- ------------------------------------------------------------
-- 2) Drop company_id column from projects
-- ------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'erp_master'
      AND table_name = 'projects'
      AND column_name = 'company_id'
  ) THEN
    ALTER TABLE erp_master.projects
      DROP COLUMN company_id;
  END IF;
END
$$;

COMMIT;