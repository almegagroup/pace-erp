-- ============================================================
-- File-ID: ID-6.7A
-- File-Path: supabase/migrations/20260211106000_gate6_6_7A_user_project_subset_rule.sql
-- Gate: 6
-- Phase: 6
-- Domain: MAP
-- Purpose: Enforce User Project ⊆ Company Project (SAP Global Model)
-- Authority: Database
-- Idempotent: YES
-- ============================================================

BEGIN;

------------------------------------------------------------
-- 1️⃣ Drop Old Function (Safe Re-run)
------------------------------------------------------------

DROP FUNCTION IF EXISTS erp_map.assert_user_project_subset(uuid, uuid);

------------------------------------------------------------
-- 2️⃣ Create Correct SAP-Style Function
------------------------------------------------------------

CREATE FUNCTION erp_map.assert_user_project_subset(
  p_auth_user_id uuid,
  p_project_id uuid
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN

  -- Admin bypass (consistent with architecture)
  IF erp_meta.req_is_admin() = true THEN
    RETURN;
  END IF;

  -- Validate:
  -- User must belong to at least one company
  -- That company must have this project assigned

  IF NOT EXISTS (
    SELECT 1
    FROM erp_map.user_companies uc
    JOIN erp_map.company_projects cp
      ON cp.company_id = uc.company_id
    WHERE uc.auth_user_id = p_auth_user_id
      AND cp.project_id = p_project_id
  )
  THEN
    RAISE EXCEPTION 'USER_PROJECT_SCOPE_VIOLATION';
  END IF;

END;
$$;

COMMENT ON FUNCTION erp_map.assert_user_project_subset IS
'Ensures user-project assignment is within mapped company scope (SAP-style global project model).';

COMMIT;