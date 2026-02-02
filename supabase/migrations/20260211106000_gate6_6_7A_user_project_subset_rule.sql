-- ============================================================
-- File-ID: ID-6.7A
-- File-Path: supabase/migrations/20260211106000_gate6_6_7A_user_project_subset_rule.sql
-- Gate: 6
-- Phase: 6
-- Domain: MAP
-- Purpose: Ensure user projects ⊆ user companies
-- Authority: Backend
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION erp_map.assert_user_project_subset(
  p_auth_user_id uuid,
  p_project_id uuid
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_company_id uuid;
BEGIN
  SELECT company_id
    INTO v_company_id
  FROM erp_master.projects
  WHERE id = p_project_id;

  IF NOT EXISTS (
    SELECT 1
    FROM erp_map.user_companies uc
    WHERE uc.auth_user_id = p_auth_user_id
      AND uc.company_id = v_company_id
  ) THEN
    RAISE EXCEPTION 'USER_PROJECT_OUTSIDE_COMPANY_SCOPE';
  END IF;
END;
$$;

COMMENT ON FUNCTION erp_map.assert_user_project_subset IS
'Prevents lateral project access across companies.';

COMMIT;
