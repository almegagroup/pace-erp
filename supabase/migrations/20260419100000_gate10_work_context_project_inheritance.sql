/*
 * File-ID: 10.3
 * File-Path: supabase/migrations/20260419100000_gate10_work_context_project_inheritance.sql
 * Gate: 10
 * Phase: 10
 * Domain: ACL
 * Purpose: Move project reach from direct per-user baseline toward work-context inheritance with optional direct overrides.
 * Authority: Backend
 */

BEGIN;

CREATE TABLE IF NOT EXISTS erp_map.work_context_projects (
  work_context_id UUID NOT NULL
    REFERENCES erp_acl.work_contexts(work_context_id)
    ON DELETE CASCADE,
  project_id UUID NOT NULL
    REFERENCES erp_master.projects(id)
    ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NULL
    REFERENCES erp_core.users(auth_user_id)
    ON DELETE SET NULL,

  CONSTRAINT pk_work_context_projects
    PRIMARY KEY (work_context_id, project_id)
);

COMMENT ON TABLE erp_map.work_context_projects IS
'Project reach inherited by every user assigned into the mapped work context. Direct user project rows remain optional override-only.';

CREATE INDEX IF NOT EXISTS idx_work_context_projects_project_id
ON erp_map.work_context_projects(project_id);

CREATE OR REPLACE FUNCTION erp_map.assert_work_context_project_subset(
  p_work_context_id UUID,
  p_project_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = pg_catalog, public, acl, erp_acl, erp_audit, erp_cache, erp_core, erp_hr, erp_map, erp_master, erp_menu, erp_meta
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM erp_acl.work_contexts AS wc
    JOIN erp_map.company_projects AS cp
      ON cp.company_id = wc.company_id
     AND cp.project_id = p_project_id
    WHERE wc.work_context_id = p_work_context_id
  ) THEN
    RAISE EXCEPTION 'WORK_CONTEXT_PROJECT_COMPANY_MISMATCH';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION erp_map.enforce_work_context_project_subset()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, acl, erp_acl, erp_audit, erp_cache, erp_core, erp_hr, erp_map, erp_master, erp_menu, erp_meta
AS $$
BEGIN
  PERFORM erp_map.assert_work_context_project_subset(
    NEW.work_context_id,
    NEW.project_id
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_work_context_project_subset
ON erp_map.work_context_projects;

CREATE TRIGGER trg_work_context_project_subset
BEFORE INSERT OR UPDATE
ON erp_map.work_context_projects
FOR EACH ROW
EXECUTE FUNCTION erp_map.enforce_work_context_project_subset();

ALTER TABLE IF EXISTS erp_map.work_context_projects
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE IF EXISTS erp_map.work_context_projects
  FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS work_context_projects_service_role_all
ON erp_map.work_context_projects;

CREATE POLICY work_context_projects_service_role_all
ON erp_map.work_context_projects
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

INSERT INTO erp_map.work_context_projects (
  work_context_id,
  project_id
)
SELECT
  wc.work_context_id,
  cp.project_id
FROM erp_acl.work_contexts AS wc
JOIN erp_map.company_projects AS cp
  ON cp.company_id = wc.company_id
JOIN erp_master.projects AS p
  ON p.id = cp.project_id
WHERE p.project_code = 'PRJ001'
  AND p.status = 'ACTIVE'
  AND wc.work_context_code IN (
    'GENERAL_OPS',
    'HR_APPROVER',
    'HR_AUDIT',
    'HR_DIRECTOR'
  )
ON CONFLICT (work_context_id, project_id) DO NOTHING;

CREATE OR REPLACE FUNCTION acl.log_user_project_version_change_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, acl, erp_acl, erp_audit, erp_cache, erp_core, erp_hr, erp_map, erp_master, erp_menu, erp_meta
AS $$
DECLARE
  v_project_id UUID;
BEGIN
  v_project_id := COALESCE(
    NULLIF(to_jsonb(NEW)->>'project_id', '')::UUID,
    NULLIF(to_jsonb(OLD)->>'project_id', '')::UUID
  );

  INSERT INTO acl.version_change_events (
    company_id,
    source_table,
    reason_code,
    change_kind,
    summary
  )
  SELECT DISTINCT
    cp.company_id,
    TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME,
    TG_ARGV[0],
    TG_OP,
    COALESCE(TG_ARGV[1], TG_ARGV[0])
  FROM erp_map.company_projects AS cp
  WHERE cp.project_id = v_project_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_work_context_projects_version_events
ON erp_map.work_context_projects;

CREATE TRIGGER trg_work_context_projects_version_events
AFTER INSERT OR UPDATE OR DELETE
ON erp_map.work_context_projects
FOR EACH ROW
EXECUTE FUNCTION acl.log_work_context_version_change_event(
  'WORK_CONTEXT_PROJECT_BINDING_CHANGED',
  'Work-context project reach changed'
);

DROP TRIGGER IF EXISTS trg_user_projects_version_events
ON erp_map.user_projects;

CREATE TRIGGER trg_user_projects_version_events
AFTER INSERT OR UPDATE OR DELETE
ON erp_map.user_projects
FOR EACH ROW
EXECUTE FUNCTION acl.log_user_project_version_change_event(
  'USER_PROJECT_OVERRIDE_CHANGED',
  'Direct user project override changed'
);

COMMIT;
