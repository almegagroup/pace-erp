/*
 * File-ID: 7.5.23
 * File-Path: supabase/migrations/20260410112000_gate7_5_23_narrow_approver_scope.sql
 * Gate: 7.5
 * Phase: 7.5
 * Domain: ACL
 * Purpose: Narrow approver routing and workflow scope from blanket module level toward exact resource and action scope.
 * Authority: Backend
 */

BEGIN;

-- ============================================================
-- 1️⃣ approver_map exact scope columns
-- ============================================================

ALTER TABLE acl.approver_map
  ADD COLUMN IF NOT EXISTS resource_code TEXT NULL,
  ADD COLUMN IF NOT EXISTS action_code TEXT NULL;

COMMENT ON COLUMN acl.approver_map.resource_code IS
'Optional exact governed resource scope for this approver rule. NULL means legacy module-wide scope.';

COMMENT ON COLUMN acl.approver_map.action_code IS
'Optional exact governed action scope for this approver rule. Must pair with resource_code.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_approver_map_resource_code'
  ) THEN
    ALTER TABLE acl.approver_map
      ADD CONSTRAINT fk_approver_map_resource_code
      FOREIGN KEY (resource_code)
      REFERENCES erp_menu.menu_master(resource_code)
      ON DELETE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ck_approver_scope_pair'
  ) THEN
    ALTER TABLE acl.approver_map
      ADD CONSTRAINT ck_approver_scope_pair
      CHECK (
        (resource_code IS NULL AND action_code IS NULL)
        OR
        (
          resource_code IS NOT NULL
          AND action_code IS NOT NULL
          AND action_code IN ('VIEW', 'WRITE', 'EDIT', 'DELETE', 'APPROVE', 'EXPORT')
        )
      );
  END IF;
END
$$;

-- ============================================================
-- 2️⃣ workflow exact scope columns
-- ============================================================

ALTER TABLE acl.workflow_requests
  ADD COLUMN IF NOT EXISTS resource_code TEXT NULL,
  ADD COLUMN IF NOT EXISTS action_code TEXT NULL;

COMMENT ON COLUMN acl.workflow_requests.resource_code IS
'Exact governed resource scope of this workflow request when approval is tied below blanket module level.';

COMMENT ON COLUMN acl.workflow_requests.action_code IS
'Exact governed action scope of this workflow request when approval is tied below blanket module level.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_workflow_requests_resource_code'
  ) THEN
    ALTER TABLE acl.workflow_requests
      ADD CONSTRAINT fk_workflow_requests_resource_code
      FOREIGN KEY (resource_code)
      REFERENCES erp_menu.menu_master(resource_code)
      ON DELETE RESTRICT;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ck_workflow_scope_pair'
  ) THEN
    ALTER TABLE acl.workflow_requests
      ADD CONSTRAINT ck_workflow_scope_pair
      CHECK (
        (resource_code IS NULL AND action_code IS NULL)
        OR
        (
          resource_code IS NOT NULL
          AND action_code IS NOT NULL
          AND action_code IN ('VIEW', 'WRITE', 'EDIT', 'DELETE', 'APPROVE', 'EXPORT')
        )
      );
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_workflow_requests_scope_lookup
ON acl.workflow_requests(company_id, module_code, resource_code, action_code);

-- ============================================================
-- 3️⃣ Replace stage uniqueness with scope-aware uniqueness
-- ============================================================

ALTER TABLE acl.approver_map
  DROP CONSTRAINT IF EXISTS uq_company_module_stage;

DROP INDEX IF EXISTS uq_approver_role_per_module;
DROP INDEX IF EXISTS uq_approver_user_per_module;

CREATE UNIQUE INDEX IF NOT EXISTS uq_approver_stage_legacy_scope
ON acl.approver_map (company_id, module_code, approval_stage)
WHERE resource_code IS NULL AND action_code IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_approver_stage_exact_scope
ON acl.approver_map (company_id, module_code, resource_code, action_code, approval_stage)
WHERE resource_code IS NOT NULL AND action_code IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_approver_role_legacy_scope
ON acl.approver_map (company_id, module_code, approver_role_code)
WHERE resource_code IS NULL
  AND action_code IS NULL
  AND approver_role_code IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_approver_role_exact_scope
ON acl.approver_map (company_id, module_code, resource_code, action_code, approver_role_code)
WHERE resource_code IS NOT NULL
  AND action_code IS NOT NULL
  AND approver_role_code IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_approver_user_legacy_scope
ON acl.approver_map (company_id, module_code, approver_user_id)
WHERE resource_code IS NULL
  AND action_code IS NULL
  AND approver_user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_approver_user_exact_scope
ON acl.approver_map (company_id, module_code, resource_code, action_code, approver_user_id)
WHERE resource_code IS NOT NULL
  AND action_code IS NOT NULL
  AND approver_user_id IS NOT NULL;

-- ============================================================
-- 4️⃣ Scope integrity
-- ============================================================

CREATE OR REPLACE FUNCTION acl.enforce_approver_scope_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF (NEW.resource_code IS NULL AND NEW.action_code IS NOT NULL)
     OR (NEW.resource_code IS NOT NULL AND NEW.action_code IS NULL) THEN
    RAISE EXCEPTION 'APPROVER_SCOPE_PAIR_INVALID';
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

DROP TRIGGER IF EXISTS trg_enforce_approver_scope_integrity
ON acl.approver_map;

CREATE TRIGGER trg_enforce_approver_scope_integrity
BEFORE INSERT OR UPDATE
ON acl.approver_map
FOR EACH ROW
EXECUTE FUNCTION acl.enforce_approver_scope_integrity();

-- ============================================================
-- 5️⃣ Scope-aware bounds
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
    AND module_code = NEW.module_code
    AND approver_id <> COALESCE(NEW.approver_id, gen_random_uuid())
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

DROP TRIGGER IF EXISTS trg_enforce_approver_bounds
ON acl.approver_map;

CREATE TRIGGER trg_enforce_approver_bounds
BEFORE INSERT OR UPDATE
ON acl.approver_map
FOR EACH ROW
EXECUTE FUNCTION acl.enforce_approver_bounds();

-- ============================================================
-- 6️⃣ Scope-aware Director invariant
-- ============================================================

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

DROP TRIGGER IF EXISTS trg_enforce_director_invariant
ON acl.approver_map;

CREATE TRIGGER trg_enforce_director_invariant
BEFORE INSERT OR UPDATE
ON acl.approver_map
FOR EACH ROW
EXECUTE FUNCTION acl.enforce_director_invariant();

COMMIT;
