/*
 * File-ID: 9.3B
 * File-Path: supabase/migrations/20260315101500_gate9_9_3B_group_delete_constraints.sql
 * Gate: 9
 * Phase: 9
 * Domain: DB
 * Purpose: Prevent deletion of groups with mapped companies
 * Authority: Backend
 */

BEGIN;

-- ============================================================
-- GROUP DELETE CONSTRAINTS
-- Enforces: Group may be INACTIVATED but not DELETED
-- if mapped companies exist.
-- ============================================================

CREATE OR REPLACE FUNCTION erp_master.assert_group_delete_safe()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Block delete if any company is mapped to this group
  IF EXISTS (
    SELECT 1
    FROM erp_map.company_group
    WHERE group_id = OLD.id
  ) THEN
    RAISE EXCEPTION
      'GROUP_DELETE_BLOCKED: companies mapped to group_id=%',
      OLD.id;
  END IF;

  RETURN OLD;
END;
$$;

-- ============================================================
-- TRIGGER: Prevent unsafe group deletion
-- ============================================================

DROP TRIGGER IF EXISTS trg_assert_group_delete_safe
ON erp_master.groups;

CREATE TRIGGER trg_assert_group_delete_safe
BEFORE DELETE
ON erp_master.groups
FOR EACH ROW
EXECUTE FUNCTION erp_master.assert_group_delete_safe();

COMMIT;
