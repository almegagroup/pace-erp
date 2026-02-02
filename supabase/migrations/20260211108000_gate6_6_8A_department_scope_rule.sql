-- ============================================================
-- File-ID: ID-6.8A
-- File-Path: supabase/migrations/20260211108000_gate6_6_8A_department_scope_rule.sql
-- Gate: 6
-- Phase: 6
-- Domain: MAP
-- Purpose: Ensure department belongs to user company
-- Authority: Backend
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION erp_map.assert_department_scope(
  p_auth_user_id uuid,
  p_department_id uuid
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_company_id uuid;
BEGIN
  SELECT company_id
    INTO v_company_id
  FROM erp_master.departments
  WHERE id = p_department_id;

  IF NOT EXISTS (
    SELECT 1
    FROM erp_map.user_companies uc
    WHERE uc.auth_user_id = p_auth_user_id
      AND uc.company_id = v_company_id
  ) THEN
    RAISE EXCEPTION 'DEPARTMENT_OUTSIDE_USER_COMPANY';
  END IF;
END;
$$;

COMMENT ON FUNCTION erp_map.assert_department_scope IS
'Blocks HR data leakage across companies.';

COMMIT;
