/*
 * File-ID: 7.5.5
 * File-Path: supabase/migrations/20260405105000_gate7_5_5_approver_uniqueness_and_bounds.sql
 * Gate: 7.5
 * Phase: 7.5
 * Domain: ACL
 * Purpose: Prevent duplicate approvers and enforce 2–3 approver bounds per module/company
 * Authority: Backend
 */

BEGIN;

-- ============================================================
-- 1️⃣ Prevent duplicate role per company + module
-- ============================================================

DROP INDEX IF EXISTS uq_approver_role_per_module;

CREATE UNIQUE INDEX uq_approver_role_per_module
ON acl.approver_map (company_id, module_code, approver_role_code)
WHERE approver_role_code IS NOT NULL;


-- ============================================================
-- 2️⃣ Prevent duplicate specific user per company + module
-- ============================================================

DROP INDEX IF EXISTS uq_approver_user_per_module;

CREATE UNIQUE INDEX uq_approver_user_per_module
ON acl.approver_map (company_id, module_code, approver_user_id)
WHERE approver_user_id IS NOT NULL;


-- ============================================================
-- 3️⃣ Enforce 2–3 approver bound via trigger
-- ============================================================

CREATE OR REPLACE FUNCTION acl.enforce_approver_bounds()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_count INTEGER;
BEGIN

    SELECT COUNT(*)
    INTO v_count
    FROM acl.approver_map
    WHERE company_id = NEW.company_id
      AND module_code = NEW.module_code;

    IF TG_OP = 'INSERT' THEN
        v_count := v_count + 1;
    END IF;

    IF v_count > 3 THEN
        RAISE EXCEPTION 'Maximum 3 approvers allowed per module/company';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_approver_bounds
ON acl.approver_map;

CREATE TRIGGER trg_enforce_approver_bounds
BEFORE INSERT OR UPDATE
ON acl.approver_map
FOR EACH ROW
EXECUTE FUNCTION acl.enforce_approver_bounds();

COMMIT;