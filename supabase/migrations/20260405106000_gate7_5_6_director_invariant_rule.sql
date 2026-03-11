/*
 * File-ID: 7.5.6
 * File-Path: supabase/migrations/20260405106000_gate7_5_6_director_invariant_rule.sql
 * Gate: 7.5
 * Phase: 7.5
 * Domain: ACL
 * Purpose: Enforce Director hierarchy invariant (no approver above Director)
 * Authority: Backend
 */

BEGIN;

-- ============================================================
-- FUNCTION: Enforce Director as highest authority
-- ============================================================

CREATE OR REPLACE FUNCTION acl.enforce_director_invariant()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_max_stage INTEGER;
    v_director_stage INTEGER;
BEGIN

    -- Find current max stage for this module/company
    SELECT MAX(approval_stage)
    INTO v_max_stage
    FROM acl.approver_map
    WHERE company_id = NEW.company_id
      AND module_code = NEW.module_code;

    -- Find Director stage if exists
    SELECT approval_stage
    INTO v_director_stage
    FROM acl.approver_map
    WHERE company_id = NEW.company_id
      AND module_code = NEW.module_code
      AND approver_role_code = 'DIRECTOR';

    -- If inserting/updating Director
    IF NEW.approver_role_code = 'DIRECTOR' THEN

        IF v_max_stage IS NOT NULL AND NEW.approval_stage < v_max_stage THEN
            RAISE EXCEPTION
            'Director must be highest approval stage';
        END IF;

    END IF;

    -- If Director already exists and someone tries to go above
    IF v_director_stage IS NOT NULL THEN
        IF NEW.approval_stage > v_director_stage THEN
            RAISE EXCEPTION
            'No approver allowed above Director';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_director_invariant
ON acl.approver_map;

CREATE TRIGGER trg_enforce_director_invariant
BEFORE INSERT OR UPDATE
ON acl.approver_map
FOR EACH ROW
EXECUTE FUNCTION acl.enforce_director_invariant();

COMMIT;