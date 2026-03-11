/*
 * File-ID: 9.2A
 * File-Path: supabase/migrations/20260315101000_gate9_9_2A_company_delete_constraints.sql
 * Gate: 9
 * Phase: 9
 * Domain: DB
 * Purpose: Prevent deletion of companies with dependent records
 * Authority: Backend
 */

BEGIN;

-- ============================================================
-- COMPANY DELETE CONSTRAINTS
-- Enforces: Company may be INACTIVATED but not DELETED
-- if dependent records exist.
-- ============================================================

CREATE OR REPLACE FUNCTION erp_master.assert_company_delete_safe()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN

  -- ------------------------------------------------------------
  -- Block delete if project mappings exist
  -- (Projects are global; companies enable them via mapping)
  -- ------------------------------------------------------------
  IF EXISTS (
    SELECT 1
    FROM erp_map.company_project_map
    WHERE company_id = OLD.id
  ) THEN
    RAISE EXCEPTION
      'COMPANY_DELETE_BLOCKED: projects enabled for company_id=%',
      OLD.id;
  END IF;

  -- ------------------------------------------------------------
  -- Block delete if departments exist
  -- ------------------------------------------------------------
  IF EXISTS (
    SELECT 1
    FROM erp_master.departments
    WHERE company_id = OLD.id
  ) THEN
    RAISE EXCEPTION
      'COMPANY_DELETE_BLOCKED: departments exist for company_id=%',
      OLD.id;
  END IF;

  -- ------------------------------------------------------------
  -- Block delete if users are mapped
  -- ------------------------------------------------------------
  IF EXISTS (
    SELECT 1
    FROM erp_map.user_company
    WHERE company_id = OLD.id
  ) THEN
    RAISE EXCEPTION
      'COMPANY_DELETE_BLOCKED: users mapped to company_id=%',
      OLD.id;
  END IF;

  -- ------------------------------------------------------------
  -- Block delete if modules are enabled
  -- ------------------------------------------------------------
  IF EXISTS (
    SELECT 1
    FROM erp_acl.company_modules
    WHERE company_id = OLD.id
  ) THEN
    RAISE EXCEPTION
      'COMPANY_DELETE_BLOCKED: modules enabled for company_id=%',
      OLD.id;
  END IF;

  RETURN OLD;

END;
$$;

-- ============================================================
-- TRIGGER: Prevent unsafe company deletion
-- ============================================================

DROP TRIGGER IF EXISTS trg_assert_company_delete_safe
ON erp_master.companies;

CREATE TRIGGER trg_assert_company_delete_safe
BEFORE DELETE
ON erp_master.companies
FOR EACH ROW
EXECUTE FUNCTION erp_master.assert_company_delete_safe();

COMMIT;