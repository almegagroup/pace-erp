/*
 * File-ID: 9.11F
 * File-Path: supabase/migrations/20260418113000_gate9_acl_version_center_event_log.sql
 * Gate: 9
 * Phase: 9
 * Domain: ACL
 * Purpose: Track version-worthy ACL and runtime access changes so the publish center can recommend when a new ACL version is required.
 * Authority: Backend
 */

BEGIN;

CREATE TABLE IF NOT EXISTS acl.version_change_events (
  event_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NULL
    REFERENCES erp_master.companies(id)
    ON DELETE CASCADE,
  source_table  TEXT NOT NULL,
  reason_code   TEXT NOT NULL,
  change_kind   TEXT NOT NULL
    CHECK (change_kind IN ('INSERT', 'UPDATE', 'DELETE', 'BOOTSTRAP')),
  summary       TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE acl.version_change_events IS
'Append-only publish recommendation feed. Runtime ACL versions should be re-captured and activated when version-worthy access changes land after the active version source freeze.';

CREATE INDEX IF NOT EXISTS idx_version_change_events_company_created_at
ON acl.version_change_events(company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_version_change_events_reason_created_at
ON acl.version_change_events(reason_code, created_at DESC);

CREATE OR REPLACE FUNCTION acl.append_version_change_event(
  p_company_id UUID,
  p_source_table TEXT,
  p_reason_code TEXT,
  p_change_kind TEXT,
  p_summary TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO acl.version_change_events (
    company_id,
    source_table,
    reason_code,
    change_kind,
    summary
  )
  VALUES (
    p_company_id,
    p_source_table,
    p_reason_code,
    p_change_kind,
    p_summary
  );
END;
$$;

CREATE OR REPLACE FUNCTION acl.log_global_version_change_event()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM acl.append_version_change_event(
    NULL,
    TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME,
    TG_ARGV[0],
    TG_OP,
    COALESCE(TG_ARGV[1], TG_ARGV[0])
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION acl.log_company_version_change_event()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_company_id UUID;
BEGIN
  v_company_id := COALESCE(
    NULLIF(to_jsonb(NEW)->>TG_ARGV[1], '')::UUID,
    NULLIF(to_jsonb(OLD)->>TG_ARGV[1], '')::UUID
  );

  PERFORM acl.append_version_change_event(
    v_company_id,
    TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME,
    TG_ARGV[0],
    TG_OP,
    COALESCE(TG_ARGV[2], TG_ARGV[0])
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION acl.log_work_context_version_change_event()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_work_context_id UUID;
  v_company_id UUID;
BEGIN
  v_work_context_id := COALESCE(
    NULLIF(to_jsonb(NEW)->>'work_context_id', '')::UUID,
    NULLIF(to_jsonb(OLD)->>'work_context_id', '')::UUID
  );

  IF v_work_context_id IS NOT NULL THEN
    SELECT company_id
    INTO v_company_id
    FROM erp_acl.work_contexts
    WHERE work_context_id = v_work_context_id;
  END IF;

  PERFORM acl.append_version_change_event(
    v_company_id,
    TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME,
    TG_ARGV[0],
    TG_OP,
    COALESCE(TG_ARGV[1], TG_ARGV[0])
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION acl.log_user_role_version_change_event()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_auth_user_id UUID;
BEGIN
  v_auth_user_id := COALESCE(
    NULLIF(to_jsonb(NEW)->>'auth_user_id', '')::UUID,
    NULLIF(to_jsonb(OLD)->>'auth_user_id', '')::UUID
  );

  INSERT INTO acl.version_change_events (
    company_id,
    source_table,
    reason_code,
    change_kind,
    summary
  )
  SELECT DISTINCT
    uc.company_id,
    TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME,
    TG_ARGV[0],
    TG_OP,
    COALESCE(TG_ARGV[1], TG_ARGV[0])
  FROM erp_map.user_companies AS uc
  WHERE uc.auth_user_id = v_auth_user_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_role_menu_permissions_version_events
ON acl.role_menu_permissions;

CREATE TRIGGER trg_role_menu_permissions_version_events
AFTER INSERT OR UPDATE OR DELETE
ON acl.role_menu_permissions
FOR EACH ROW
EXECUTE FUNCTION acl.log_global_version_change_event(
  'ROLE_PERMISSION_CHANGED',
  'Role permission baseline changed'
);

DROP TRIGGER IF EXISTS trg_role_capabilities_version_events
ON acl.role_capabilities;

CREATE TRIGGER trg_role_capabilities_version_events
AFTER INSERT OR UPDATE OR DELETE
ON acl.role_capabilities
FOR EACH ROW
EXECUTE FUNCTION acl.log_global_version_change_event(
  'ROLE_CAPABILITY_CHANGED',
  'Role-to-access-pack binding changed'
);

DROP TRIGGER IF EXISTS trg_capability_menu_actions_version_events
ON acl.capability_menu_actions;

CREATE TRIGGER trg_capability_menu_actions_version_events
AFTER INSERT OR UPDATE OR DELETE
ON acl.capability_menu_actions
FOR EACH ROW
EXECUTE FUNCTION acl.log_global_version_change_event(
  'CAPABILITY_MATRIX_CHANGED',
  'Capability pack matrix changed'
);

DROP TRIGGER IF EXISTS trg_user_overrides_version_events
ON acl.user_overrides;

CREATE TRIGGER trg_user_overrides_version_events
AFTER INSERT OR UPDATE OR DELETE
ON acl.user_overrides
FOR EACH ROW
EXECUTE FUNCTION acl.log_company_version_change_event(
  'USER_OVERRIDE_CHANGED',
  'company_id',
  'User ACL override changed'
);

DROP TRIGGER IF EXISTS trg_company_module_map_version_events
ON acl.company_module_map;

CREATE TRIGGER trg_company_module_map_version_events
AFTER INSERT OR UPDATE OR DELETE
ON acl.company_module_map
FOR EACH ROW
EXECUTE FUNCTION acl.log_company_version_change_event(
  'COMPANY_MODULE_ACCESS_CHANGED',
  'company_id',
  'Company module access changed'
);

DROP TRIGGER IF EXISTS trg_work_context_capabilities_version_events
ON acl.work_context_capabilities;

CREATE TRIGGER trg_work_context_capabilities_version_events
AFTER INSERT OR UPDATE OR DELETE
ON acl.work_context_capabilities
FOR EACH ROW
EXECUTE FUNCTION acl.log_work_context_version_change_event(
  'WORK_CONTEXT_PACK_BINDING_CHANGED',
  'Business-area access-pack binding changed'
);

DROP TRIGGER IF EXISTS trg_user_roles_version_events
ON erp_acl.user_roles;

CREATE TRIGGER trg_user_roles_version_events
AFTER INSERT OR UPDATE OR DELETE
ON erp_acl.user_roles
FOR EACH ROW
EXECUTE FUNCTION acl.log_user_role_version_change_event(
  'USER_ROLE_CHANGED',
  'User role changed'
);

DROP TRIGGER IF EXISTS trg_user_companies_version_events
ON erp_map.user_companies;

CREATE TRIGGER trg_user_companies_version_events
AFTER INSERT OR UPDATE OR DELETE
ON erp_map.user_companies
FOR EACH ROW
EXECUTE FUNCTION acl.log_company_version_change_event(
  'USER_COMPANY_SCOPE_CHANGED',
  'company_id',
  'User work-company scope changed'
);

DROP TRIGGER IF EXISTS trg_user_work_contexts_version_events
ON erp_acl.user_work_contexts;

CREATE TRIGGER trg_user_work_contexts_version_events
AFTER INSERT OR UPDATE OR DELETE
ON erp_acl.user_work_contexts
FOR EACH ROW
EXECUTE FUNCTION acl.log_company_version_change_event(
  'USER_WORK_CONTEXT_CHANGED',
  'company_id',
  'User work-context scope changed'
);

DROP TRIGGER IF EXISTS trg_work_contexts_version_events
ON erp_acl.work_contexts;

CREATE TRIGGER trg_work_contexts_version_events
AFTER INSERT OR UPDATE OR DELETE
ON erp_acl.work_contexts
FOR EACH ROW
EXECUTE FUNCTION acl.log_company_version_change_event(
  'WORK_CONTEXT_CHANGED',
  'company_id',
  'Work-context definition changed'
);

DROP TRIGGER IF EXISTS trg_module_registry_version_events
ON acl.module_registry;

CREATE TRIGGER trg_module_registry_version_events
AFTER INSERT OR UPDATE OR DELETE
ON acl.module_registry
FOR EACH ROW
EXECUTE FUNCTION acl.log_global_version_change_event(
  'MODULE_REGISTRY_CHANGED',
  'Module registry changed'
);

DROP TRIGGER IF EXISTS trg_module_resource_map_version_events
ON acl.module_resource_map;

CREATE TRIGGER trg_module_resource_map_version_events
AFTER INSERT OR UPDATE OR DELETE
ON acl.module_resource_map
FOR EACH ROW
EXECUTE FUNCTION acl.log_global_version_change_event(
  'MODULE_RESOURCE_MAP_CHANGED',
  'Module-to-page mapping changed'
);

DROP TRIGGER IF EXISTS trg_menu_master_version_events
ON erp_menu.menu_master;

CREATE TRIGGER trg_menu_master_version_events
AFTER INSERT OR UPDATE OR DELETE
ON erp_menu.menu_master
FOR EACH ROW
EXECUTE FUNCTION acl.log_global_version_change_event(
  'MENU_REGISTRY_CHANGED',
  'Menu registry changed'
);

INSERT INTO acl.version_change_events (
  company_id,
  source_table,
  reason_code,
  change_kind,
  summary
)
VALUES (
  NULL,
  'acl.version_change_events',
  'VERSION_CENTER_BOOTSTRAP_REQUIRED',
  'BOOTSTRAP',
  'ACL Version Center tracking enabled. Capture and activate a fresh ACL version to baseline publish status.'
);

COMMIT;
