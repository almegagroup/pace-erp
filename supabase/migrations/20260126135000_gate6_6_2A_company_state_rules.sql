-- ============================================================
-- File-ID: ID-6.2A
-- File-Path: supabase/migrations/20260126135000_gate6_6_2A_company_state_rules.sql
-- Gate: 6
-- Phase: 6
-- Domain: DB
-- Short_Name: Company state rules
-- Purpose: Enforce ACTIVE / INACTIVE company invariants at database level
-- Authority: Backend
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1️⃣ Status allow-list enforcement
-- ------------------------------------------------------------
-- WHAT:
--   Only ACTIVE / INACTIVE allowed
--
-- WHY:
--   Prevent undefined business truth (e.g. 'paused', 'disabled')
--
-- IF NOT:
--   Context + ACL can never be deterministic
-- ------------------------------------------------------------

ALTER TABLE erp_master.companies
  ADD CONSTRAINT companies_status_check
  CHECK (status IN ('ACTIVE', 'INACTIVE'));

-- ------------------------------------------------------------
-- 2️⃣ Hard block DELETE on company
-- ------------------------------------------------------------
-- WHAT:
--   Companies can never be deleted
--
-- WHY:
--   Delete breaks audit, users, projects, RLS proof
--
-- ANALOGY:
--   Factory closed ≠ factory demolished
--
-- IF NOT:
--   One DELETE can corrupt entire ERP history
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION erp_master.block_company_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'COMPANY_DELETE_FORBIDDEN';
END;
$$;

CREATE TRIGGER trg_block_company_delete
BEFORE DELETE ON erp_master.companies
FOR EACH ROW
EXECUTE FUNCTION erp_master.block_company_delete();

-- ------------------------------------------------------------
-- 3️⃣ Company ACTIVE assertion helper (future-safe)
-- ------------------------------------------------------------
-- WHAT:
--   DB-level proof of "company must be ACTIVE"
--
-- WHY:
--   Used by future Gates (G4 mappings, G10 ACL, G13 RLS)
--
-- IF NOT:
--   Every layer will re-implement this check inconsistently
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION erp_master.assert_company_active(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM erp_master.companies
    WHERE id = p_company_id
      AND status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'COMPANY_INACTIVE';
  END IF;
END;
$$;

COMMIT;
