/*
 * File-ID: 6.6E
 * File-Path: supabase/migrations/20260410129000_gate6_6_6E_work_context_model.sql
 * Gate: 6
 * Phase: 6
 * Domain: ACL
 * Purpose: Introduce Work Context as the runtime functional selector inside a selected Work Company
 * Authority: Backend
 */

BEGIN;

CREATE TABLE IF NOT EXISTS erp_acl.work_contexts (
  work_context_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID NOT NULL
    REFERENCES erp_master.companies(id)
    ON DELETE CASCADE,
  work_context_code TEXT NOT NULL,
  work_context_name TEXT NOT NULL,
  description       TEXT NULL,
  department_id     UUID NULL
    REFERENCES erp_master.departments(id)
    ON DELETE SET NULL,
  is_system         BOOLEAN NOT NULL DEFAULT FALSE,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_work_context_company_code
    UNIQUE (company_id, work_context_code)
);

COMMENT ON TABLE erp_acl.work_contexts IS
'Runtime functional responsibility selector inside one selected Work Company. Final access must be evaluated inside one selected Work Context.';

CREATE TABLE IF NOT EXISTS erp_acl.user_work_contexts (
  auth_user_id      UUID NOT NULL
    REFERENCES erp_core.users(auth_user_id)
    ON DELETE CASCADE,
  company_id        UUID NOT NULL
    REFERENCES erp_master.companies(id)
    ON DELETE CASCADE,
  work_context_id   UUID NOT NULL
    REFERENCES erp_acl.work_contexts(work_context_id)
    ON DELETE CASCADE,
  is_primary        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT pk_user_work_contexts
    PRIMARY KEY (auth_user_id, company_id, work_context_id)
);

COMMENT ON TABLE erp_acl.user_work_contexts IS
'Binds a user to one or more runtime Work Contexts inside a specific Work Company.';

CREATE TABLE IF NOT EXISTS acl.work_context_capabilities (
  work_context_id   UUID NOT NULL
    REFERENCES erp_acl.work_contexts(work_context_id)
    ON DELETE CASCADE,
  capability_code   TEXT NOT NULL
    REFERENCES acl.capabilities(capability_code)
    ON DELETE CASCADE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT pk_work_context_capabilities
    PRIMARY KEY (work_context_id, capability_code)
);

COMMENT ON TABLE acl.work_context_capabilities IS
'Capability packs allowed inside a specific Work Context. Work Context filters runtime functional responsibility inside the selected Work Company.';

ALTER TABLE erp_core.sessions
  ADD COLUMN IF NOT EXISTS selected_work_context_id UUID NULL
    REFERENCES erp_acl.work_contexts(work_context_id)
    ON DELETE SET NULL;

COMMENT ON COLUMN erp_core.sessions.selected_work_context_id IS
'Selected runtime Work Context for this active session inside the selected Work Company.';

ALTER TABLE acl.precomputed_acl_view
  ADD COLUMN IF NOT EXISTS work_context_id UUID NULL
    REFERENCES erp_acl.work_contexts(work_context_id)
    ON DELETE CASCADE;

ALTER TABLE erp_menu.menu_snapshot
  ADD COLUMN IF NOT EXISTS work_context_id UUID NULL
    REFERENCES erp_acl.work_contexts(work_context_id)
    ON DELETE CASCADE;

ALTER TABLE erp_cache.session_menu_snapshot
  ADD COLUMN IF NOT EXISTS work_context_id UUID NULL
    REFERENCES erp_acl.work_contexts(work_context_id)
    ON DELETE CASCADE;

ALTER TABLE acl.precomputed_acl_view
  DROP CONSTRAINT IF EXISTS uq_acl_snapshot_identity;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'erp_menu'
      AND indexname = 'ux_menu_snapshot_identity'
  ) THEN
    EXECUTE 'DROP INDEX erp_menu.ux_menu_snapshot_identity';
  END IF;
END $$;

ALTER TABLE erp_cache.session_menu_snapshot
  DROP CONSTRAINT IF EXISTS uq_session_menu_context;

CREATE UNIQUE INDEX IF NOT EXISTS ux_acl_snapshot_identity
ON acl.precomputed_acl_view (
  acl_version_id,
  auth_user_id,
  company_id,
  work_context_id,
  project_id,
  department_id,
  resource_code,
  action_code
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_menu_snapshot_identity
ON erp_menu.menu_snapshot (
  user_id,
  company_id,
  work_context_id,
  universe,
  snapshot_version,
  menu_code
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_session_menu_context
ON erp_cache.session_menu_snapshot (
  session_id,
  universe,
  company_id,
  work_context_id
);

CREATE INDEX IF NOT EXISTS idx_user_work_contexts_user_company
ON erp_acl.user_work_contexts (auth_user_id, company_id);

CREATE INDEX IF NOT EXISTS idx_sessions_selected_work_context_id
ON erp_core.sessions (selected_work_context_id);

INSERT INTO erp_acl.work_contexts (
  company_id,
  work_context_code,
  work_context_name,
  description,
  is_system,
  is_active
)
SELECT
  c.id,
  'GENERAL_OPS',
  'General Operations',
  'Default operational runtime context for users working inside this company.',
  TRUE,
  TRUE
FROM erp_master.companies AS c
WHERE c.status = 'ACTIVE'
  AND c.company_kind = 'BUSINESS'
  AND NOT EXISTS (
    SELECT 1
    FROM erp_acl.work_contexts AS wc
    WHERE wc.company_id = c.id
      AND wc.work_context_code = 'GENERAL_OPS'
  );

INSERT INTO erp_acl.work_contexts (
  company_id,
  work_context_code,
  work_context_name,
  description,
  department_id,
  is_system,
  is_active
)
SELECT
  d.company_id,
  'DEPT_' || UPPER(TRIM(d.department_code)),
  d.department_name,
  'Department-derived runtime context for ' || d.department_name,
  d.id,
  TRUE,
  TRUE
FROM erp_master.departments AS d
JOIN erp_master.companies AS c
  ON c.id = d.company_id
WHERE d.status = 'ACTIVE'
  AND c.status = 'ACTIVE'
  AND c.company_kind = 'BUSINESS'
  AND NOT EXISTS (
    SELECT 1
    FROM erp_acl.work_contexts AS wc
    WHERE wc.company_id = d.company_id
      AND wc.work_context_code = 'DEPT_' || UPPER(TRIM(d.department_code))
  );

INSERT INTO erp_acl.user_work_contexts (
  auth_user_id,
  company_id,
  work_context_id,
  is_primary
)
SELECT
  uc.auth_user_id,
  uc.company_id,
  wc.work_context_id,
  TRUE
FROM erp_map.user_companies AS uc
JOIN erp_acl.work_contexts AS wc
  ON wc.company_id = uc.company_id
 AND wc.work_context_code = 'GENERAL_OPS'
WHERE NOT EXISTS (
  SELECT 1
  FROM erp_acl.user_work_contexts AS uwc
  WHERE uwc.auth_user_id = uc.auth_user_id
    AND uwc.company_id = uc.company_id
    AND uwc.work_context_id = wc.work_context_id
);

INSERT INTO erp_acl.user_work_contexts (
  auth_user_id,
  company_id,
  work_context_id,
  is_primary
)
SELECT
  ud.auth_user_id,
  d.company_id,
  wc.work_context_id,
  FALSE
FROM erp_map.user_departments AS ud
JOIN erp_master.departments AS d
  ON d.id = ud.department_id
JOIN erp_acl.work_contexts AS wc
  ON wc.company_id = d.company_id
 AND wc.department_id = d.id
WHERE NOT EXISTS (
  SELECT 1
  FROM erp_acl.user_work_contexts AS uwc
  WHERE uwc.auth_user_id = ud.auth_user_id
    AND uwc.company_id = d.company_id
    AND uwc.work_context_id = wc.work_context_id
);

UPDATE erp_core.sessions AS s
SET selected_work_context_id = candidate.work_context_id
FROM (
  SELECT DISTINCT ON (uwc.auth_user_id, uwc.company_id)
    uwc.auth_user_id,
    uwc.company_id,
    uwc.work_context_id
  FROM erp_acl.user_work_contexts AS uwc
  ORDER BY uwc.auth_user_id, uwc.company_id, uwc.is_primary DESC, uwc.created_at ASC
) AS candidate
WHERE s.auth_user_id = candidate.auth_user_id
  AND s.selected_company_id = candidate.company_id
  AND s.selected_work_context_id IS NULL;

DELETE FROM acl.precomputed_acl_view;
DELETE FROM erp_menu.menu_snapshot;
DELETE FROM erp_cache.session_menu_snapshot;

COMMIT;
