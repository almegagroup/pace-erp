/*
 * File-ID: 7.5.3
 * File-Path: supabase/migrations/20260405103000_gate7_5_3_module_project_integrity.sql
 * Gate: 7.5
 * Phase: 7.5
 * Domain: ACL
 * Purpose: Enforce module-project integrity (project inactive => module inactive)
 * Authority: Backend
 */

BEGIN;

-- ============================================================
-- FUNCTION: Validate project status before module activation
-- ============================================================

CREATE OR REPLACE FUNCTION acl.enforce_module_project_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_project_status TEXT;
BEGIN

    SELECT status
    INTO v_project_status
    FROM erp_master.projects
    WHERE id = NEW.project_id;

    IF v_project_status IS NULL THEN
        RAISE EXCEPTION 'Invalid project reference';
    END IF;

    -- If project is not ACTIVE, module cannot be active
    IF v_project_status <> 'ACTIVE' AND NEW.is_active = TRUE THEN
        RAISE EXCEPTION
        'Module cannot be active when project status is %',
        v_project_status;
    END IF;

    RETURN NEW;
END;
$$;

-- ============================================================
-- TRIGGER
-- ============================================================

DROP TRIGGER IF EXISTS trg_module_project_integrity
ON acl.module_registry;

CREATE TRIGGER trg_module_project_integrity
BEFORE INSERT OR UPDATE
ON acl.module_registry
FOR EACH ROW
EXECUTE FUNCTION acl.enforce_module_project_integrity();

COMMIT;