-- ============================================================
-- File-ID: ID-6.5A
-- File-Path: supabase/migrations/20260211102000_gate6_6_5A_company_project_invariants.sql
-- Gate: 6
-- Phase: 6
-- Domain: MAP
-- Purpose: Prevent cross-company project leakage
-- Authority: Backend
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- Helper: assert_project_belongs_to_company
-- Ensures project.company_id == provided company_id
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION erp_map.assert_project_belongs_to_company(
  p_company_id uuid,
  p_project_id uuid
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM erp_master.projects p
    WHERE p.id = p_project_id
      AND p.company_id = p_company_id
  ) THEN
    RAISE EXCEPTION 'PROJECT_COMPANY_MISMATCH';
  END IF;
END;
$$;

COMMENT ON FUNCTION erp_map.assert_project_belongs_to_company IS
'Guards against cross-company project leakage.';

COMMIT;
