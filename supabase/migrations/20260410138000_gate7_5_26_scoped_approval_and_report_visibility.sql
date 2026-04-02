/*
 * File-ID: 7.5.26
 * File-Path: supabase/migrations/20260410138000_gate7_5_26_scoped_approval_and_report_visibility.sql
 * Gate: 7.5
 * Phase: 7.5
 * Domain: ACL
 * Purpose: Align approval routing and report visibility with requester work-context scope and explicit observer rules.
 * Authority: Backend
 */

BEGIN;

ALTER TABLE acl.approver_map
  ADD COLUMN IF NOT EXISTS subject_work_context_id UUID NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_approver_map_subject_work_context'
  ) THEN
    ALTER TABLE acl.approver_map
      ADD CONSTRAINT fk_approver_map_subject_work_context
      FOREIGN KEY (subject_work_context_id)
      REFERENCES erp_acl.work_contexts(work_context_id)
      ON DELETE CASCADE;
  END IF;
END
$$;

COMMENT ON COLUMN acl.approver_map.subject_work_context_id IS
'Optional requester work-context scope. NULL means company-wide approval visibility across all requester scopes in the governed company.';

DROP INDEX IF EXISTS uq_approver_stage_legacy_scope;
DROP INDEX IF EXISTS uq_approver_stage_exact_scope;
DROP INDEX IF EXISTS uq_approver_role_legacy_scope;
DROP INDEX IF EXISTS uq_approver_role_exact_scope;
DROP INDEX IF EXISTS uq_approver_user_legacy_scope;
DROP INDEX IF EXISTS uq_approver_user_exact_scope;
DROP INDEX IF EXISTS uq_approver_role_per_module;
DROP INDEX IF EXISTS uq_approver_user_per_module;

CREATE UNIQUE INDEX IF NOT EXISTS uq_approver_role_legacy_subject_scope
ON acl.approver_map (
  company_id,
  module_code,
  COALESCE(subject_work_context_id, '00000000-0000-0000-0000-000000000000'::UUID),
  approval_stage,
  approver_role_code
)
WHERE resource_code IS NULL
  AND action_code IS NULL
  AND approver_role_code IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_approver_role_exact_subject_scope
ON acl.approver_map (
  company_id,
  module_code,
  resource_code,
  action_code,
  COALESCE(subject_work_context_id, '00000000-0000-0000-0000-000000000000'::UUID),
  approval_stage,
  approver_role_code
)
WHERE resource_code IS NOT NULL
  AND action_code IS NOT NULL
  AND approver_role_code IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_approver_user_legacy_subject_scope
ON acl.approver_map (
  company_id,
  module_code,
  COALESCE(subject_work_context_id, '00000000-0000-0000-0000-000000000000'::UUID),
  approval_stage,
  approver_user_id
)
WHERE resource_code IS NULL
  AND action_code IS NULL
  AND approver_user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_approver_user_exact_subject_scope
ON acl.approver_map (
  company_id,
  module_code,
  resource_code,
  action_code,
  COALESCE(subject_work_context_id, '00000000-0000-0000-0000-000000000000'::UUID),
  approval_stage,
  approver_user_id
)
WHERE resource_code IS NOT NULL
  AND action_code IS NOT NULL
  AND approver_user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION acl.enforce_approver_scope_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_subject_company_id UUID;
BEGIN
  IF (NEW.resource_code IS NULL AND NEW.action_code IS NOT NULL)
     OR (NEW.resource_code IS NOT NULL AND NEW.action_code IS NULL) THEN
    RAISE EXCEPTION 'APPROVER_SCOPE_PAIR_INVALID';
  END IF;

  IF NEW.subject_work_context_id IS NOT NULL THEN
    SELECT company_id
    INTO v_subject_company_id
    FROM erp_acl.work_contexts
    WHERE work_context_id = NEW.subject_work_context_id
      AND is_active = TRUE;

    IF v_subject_company_id IS NULL THEN
      RAISE EXCEPTION 'APPROVER_SUBJECT_SCOPE_NOT_FOUND';
    END IF;

    IF v_subject_company_id <> NEW.company_id THEN
      RAISE EXCEPTION 'APPROVER_SUBJECT_SCOPE_COMPANY_MISMATCH';
    END IF;
  END IF;

  IF NEW.resource_code IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM acl.module_resource_map mrm
      WHERE mrm.module_code = NEW.module_code
        AND mrm.resource_code = NEW.resource_code
    ) THEN
      RAISE EXCEPTION 'APPROVER_SCOPE_RESOURCE_NOT_BOUND_TO_MODULE';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM acl.resource_approval_policy rap
      WHERE rap.resource_code = NEW.resource_code
        AND rap.action_code = NEW.action_code
        AND rap.approval_required = TRUE
    ) THEN
      RAISE EXCEPTION 'APPROVER_SCOPE_NOT_APPROVAL_REQUIRED';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

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
    AND module_code = NEW.module_code
    AND approver_id <> COALESCE(NEW.approver_id, gen_random_uuid())
    AND COALESCE(subject_work_context_id, '00000000-0000-0000-0000-000000000000'::UUID) =
        COALESCE(NEW.subject_work_context_id, '00000000-0000-0000-0000-000000000000'::UUID)
    AND (
      (
        resource_code IS NULL
        AND action_code IS NULL
        AND NEW.resource_code IS NULL
        AND NEW.action_code IS NULL
      )
      OR
      (
        resource_code = NEW.resource_code
        AND action_code = NEW.action_code
      )
    );

  v_count := v_count + 1;

  IF v_count > 3 THEN
    RAISE EXCEPTION 'Maximum 3 approvers allowed per exact approval scope';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION acl.enforce_director_invariant()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_max_stage INTEGER;
  v_director_stage INTEGER;
BEGIN
  SELECT MAX(approval_stage)
  INTO v_max_stage
  FROM acl.approver_map
  WHERE company_id = NEW.company_id
    AND module_code = NEW.module_code
    AND COALESCE(subject_work_context_id, '00000000-0000-0000-0000-000000000000'::UUID) =
        COALESCE(NEW.subject_work_context_id, '00000000-0000-0000-0000-000000000000'::UUID)
    AND (
      (
        resource_code IS NULL
        AND action_code IS NULL
        AND NEW.resource_code IS NULL
        AND NEW.action_code IS NULL
      )
      OR
      (
        resource_code = NEW.resource_code
        AND action_code = NEW.action_code
      )
    );

  SELECT approval_stage
  INTO v_director_stage
  FROM acl.approver_map
  WHERE company_id = NEW.company_id
    AND module_code = NEW.module_code
    AND approver_role_code = 'DIRECTOR'
    AND COALESCE(subject_work_context_id, '00000000-0000-0000-0000-000000000000'::UUID) =
        COALESCE(NEW.subject_work_context_id, '00000000-0000-0000-0000-000000000000'::UUID)
    AND (
      (
        resource_code IS NULL
        AND action_code IS NULL
        AND NEW.resource_code IS NULL
        AND NEW.action_code IS NULL
      )
      OR
      (
        resource_code = NEW.resource_code
        AND action_code = NEW.action_code
      )
    )
  ORDER BY approval_stage DESC
  LIMIT 1;

  IF NEW.approver_role_code = 'DIRECTOR' THEN
    IF v_max_stage IS NOT NULL AND NEW.approval_stage < v_max_stage THEN
      RAISE EXCEPTION 'Director must be highest approval stage in exact scope';
    END IF;
  END IF;

  IF v_director_stage IS NOT NULL AND NEW.approval_stage > v_director_stage THEN
    RAISE EXCEPTION 'No approver allowed above Director in exact scope';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS acl.report_viewer_map (
  viewer_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL
    REFERENCES erp_master.companies(id)
    ON DELETE CASCADE,
  module_code TEXT NOT NULL
    REFERENCES acl.module_registry(module_code)
    ON DELETE RESTRICT,
  resource_code TEXT NOT NULL
    REFERENCES erp_menu.menu_master(resource_code)
    ON DELETE CASCADE,
  action_code TEXT NOT NULL
    CHECK (action_code IN ('VIEW', 'EXPORT')),
  subject_work_context_id UUID NULL
    REFERENCES erp_acl.work_contexts(work_context_id)
    ON DELETE CASCADE,
  viewer_role_code TEXT NULL,
  viewer_user_id UUID NULL
    REFERENCES auth.users(id)
    ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL
    REFERENCES auth.users(id)
    ON DELETE RESTRICT,
  CONSTRAINT ck_report_viewer_target_xor
    CHECK (
      (viewer_role_code IS NOT NULL AND viewer_user_id IS NULL)
      OR
      (viewer_role_code IS NULL AND viewer_user_id IS NOT NULL)
    )
);

COMMENT ON TABLE acl.report_viewer_map IS
'Explicit observer/report visibility map. Separate from approver routing so viewers can read request data without decision authority.';

COMMENT ON COLUMN acl.report_viewer_map.subject_work_context_id IS
'Optional requester work-context filter. NULL means viewer can see all requester scopes inside the governed company/resource.';

CREATE INDEX IF NOT EXISTS idx_report_viewer_scope_lookup
ON acl.report_viewer_map (
  company_id,
  module_code,
  resource_code,
  action_code,
  COALESCE(subject_work_context_id, '00000000-0000-0000-0000-000000000000'::UUID)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_report_viewer_role_scope
ON acl.report_viewer_map (
  company_id,
  module_code,
  resource_code,
  action_code,
  COALESCE(subject_work_context_id, '00000000-0000-0000-0000-000000000000'::UUID),
  viewer_role_code
)
WHERE viewer_role_code IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_report_viewer_user_scope
ON acl.report_viewer_map (
  company_id,
  module_code,
  resource_code,
  action_code,
  COALESCE(subject_work_context_id, '00000000-0000-0000-0000-000000000000'::UUID),
  viewer_user_id
)
WHERE viewer_user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION acl.enforce_report_viewer_scope_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_subject_company_id UUID;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM acl.module_resource_map mrm
    WHERE mrm.module_code = NEW.module_code
      AND mrm.resource_code = NEW.resource_code
  ) THEN
    RAISE EXCEPTION 'REPORT_VIEWER_RESOURCE_NOT_BOUND_TO_MODULE';
  END IF;

  IF NEW.subject_work_context_id IS NOT NULL THEN
    SELECT company_id
    INTO v_subject_company_id
    FROM erp_acl.work_contexts
    WHERE work_context_id = NEW.subject_work_context_id
      AND is_active = TRUE;

    IF v_subject_company_id IS NULL THEN
      RAISE EXCEPTION 'REPORT_VIEWER_SUBJECT_SCOPE_NOT_FOUND';
    END IF;

    IF v_subject_company_id <> NEW.company_id THEN
      RAISE EXCEPTION 'REPORT_VIEWER_SUBJECT_SCOPE_COMPANY_MISMATCH';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_report_viewer_scope_integrity
ON acl.report_viewer_map;

CREATE TRIGGER trg_enforce_report_viewer_scope_integrity
BEFORE INSERT OR UPDATE
ON acl.report_viewer_map
FOR EACH ROW
EXECUTE FUNCTION acl.enforce_report_viewer_scope_integrity();

ALTER TABLE acl.report_viewer_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE acl.report_viewer_map FORCE ROW LEVEL SECURITY;

CREATE POLICY report_viewer_map_read_authenticated
ON acl.report_viewer_map
FOR SELECT
TO authenticated
USING (TRUE);

ALTER TABLE acl.workflow_requests
  ADD COLUMN IF NOT EXISTS requester_work_context_id UUID NULL,
  ADD COLUMN IF NOT EXISTS requester_subject_company_id UUID NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_workflow_requests_requester_work_context'
  ) THEN
    ALTER TABLE acl.workflow_requests
      ADD CONSTRAINT fk_workflow_requests_requester_work_context
      FOREIGN KEY (requester_work_context_id)
      REFERENCES erp_acl.work_contexts(work_context_id)
      ON DELETE RESTRICT;
  END IF;
END
$$;

COMMENT ON COLUMN acl.workflow_requests.requester_work_context_id IS
'Requester functional scope inside the governed company at submit time. Drives scoped approver and viewer resolution.';

COMMENT ON COLUMN acl.workflow_requests.requester_subject_company_id IS
'Requester parent-company HR truth at submit time. Kept explicit for stable audit and future data-scope filtering.';

CREATE INDEX IF NOT EXISTS idx_workflow_requests_requester_scope
ON acl.workflow_requests(company_id, module_code, requester_work_context_id);

ALTER TABLE erp_hr.leave_requests
  ADD COLUMN IF NOT EXISTS requester_work_context_id UUID NULL;

ALTER TABLE erp_hr.out_work_requests
  ADD COLUMN IF NOT EXISTS requester_work_context_id UUID NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_leave_requests_requester_work_context'
  ) THEN
    ALTER TABLE erp_hr.leave_requests
      ADD CONSTRAINT fk_leave_requests_requester_work_context
      FOREIGN KEY (requester_work_context_id)
      REFERENCES erp_acl.work_contexts(work_context_id)
      ON DELETE RESTRICT;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_out_work_requests_requester_work_context'
  ) THEN
    ALTER TABLE erp_hr.out_work_requests
      ADD CONSTRAINT fk_out_work_requests_requester_work_context
      FOREIGN KEY (requester_work_context_id)
      REFERENCES erp_acl.work_contexts(work_context_id)
      ON DELETE RESTRICT;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_leave_requests_requester_scope
ON erp_hr.leave_requests(parent_company_id, requester_work_context_id);

CREATE INDEX IF NOT EXISTS idx_out_work_requests_requester_scope
ON erp_hr.out_work_requests(parent_company_id, requester_work_context_id);

COMMIT;
