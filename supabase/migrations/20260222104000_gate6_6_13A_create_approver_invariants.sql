/*
 * File-ID: ID-6.13A
 * File-Path: supabase/migrations/20260222103000_gate6_6_13A_create_approver_invariants.sql
 * Gate: 6
 * Phase: 6
 * Domain: ACL
 * Purpose: Enforce structural safety invariants for approval routing.
 * Authority: Backend
 */

BEGIN;

-- Prevent empty approval chains per company + module
CREATE OR REPLACE FUNCTION acl.assert_non_empty_approver_chain()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM acl.approver_map
    WHERE company_id = NEW.company_id
      AND module_code = NEW.module_code
  ) THEN
    RAISE EXCEPTION
      'Approver chain cannot be empty for company % and module %',
      NEW.company_id, NEW.module_code;
  END IF;
  RETURN NEW;
END;
$$;

-- Prevent duplicate stages (extra safety beyond UNIQUE)
CREATE OR REPLACE FUNCTION acl.assert_unique_approval_stage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM acl.approver_map
    WHERE company_id = NEW.company_id
      AND module_code = NEW.module_code
      AND approval_stage = NEW.approval_stage
      AND approver_id <> NEW.approver_id
  ) THEN
    RAISE EXCEPTION
      'Duplicate approval_stage % for company % and module %',
      NEW.approval_stage, NEW.company_id, NEW.module_code;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_approver_chain_non_empty
AFTER INSERT OR DELETE
ON acl.approver_map
FOR EACH ROW
EXECUTE FUNCTION acl.assert_non_empty_approver_chain();

CREATE TRIGGER trg_approver_stage_unique
BEFORE INSERT OR UPDATE
ON acl.approver_map
FOR EACH ROW
EXECUTE FUNCTION acl.assert_unique_approval_stage();

COMMIT;
