-- File-Path: supabase/migrations/20260728150000_approver_map_subject_role_scope.sql
-- Purpose: add a role-based creator scope to acl.approver_map, alongside the
-- existing named-person (subject_user_id) and department (subject_work_context_id)
-- scopes. Business need: escalation chains that key off the CREATOR's rank
-- rather than a specific named individual (e.g. "if an L2_USER submits, an
-- L3_USER or L1_MANAGER approves; if an L1_MANAGER submits, DIRECTOR
-- approves") — generalizes beyond any 3 specific named people and applies to
-- anyone holding that rank.
--
-- Extends the same fix pattern as 20260728143000: both the uniqueness index
-- and the 3-approver-per-scope cap must partition by this new dimension too,
-- or rows for different subject_role_code values collide/compete for the
-- same cap exactly like subject_user_id did before that migration.

ALTER TABLE acl.approver_map ADD COLUMN subject_role_code TEXT;

ALTER TABLE acl.approver_map DROP CONSTRAINT IF EXISTS ck_approver_map_scope_type;
ALTER TABLE acl.approver_map ADD CONSTRAINT ck_approver_map_scope_type
  CHECK (
    (scope_type IS NULL) OR
    (scope_type = ANY (ARRAY['COMPANY_WIDE'::text, 'DEPARTMENT'::text, 'WORK_CONTEXT'::text, 'USER_EXCEPTION'::text, 'DIRECTOR'::text, 'SUBJECT_ROLE'::text]))
  );

DROP INDEX IF EXISTS acl.uq_approver_user_exact_subject_scope;

CREATE UNIQUE INDEX uq_approver_user_exact_subject_scope
ON acl.approver_map (
  company_id,
  module_code,
  resource_code,
  action_code,
  COALESCE(subject_work_context_id, '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE(subject_user_id, '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE(subject_role_code, ''),
  approval_stage,
  approver_user_id
)
WHERE (resource_code IS NOT NULL AND action_code IS NOT NULL AND approver_user_id IS NOT NULL);

-- Same gap, same fix, for the role-based-approver mirror of the above index
-- (approver_role_code instead of approver_user_id) — hit immediately after
-- fixing the user-based one, while seeding the SUBJECT_ROLE escalation
-- chain rows for PO/STO themselves.
DROP INDEX IF EXISTS acl.uq_approver_role_exact_subject_scope;

CREATE UNIQUE INDEX uq_approver_role_exact_subject_scope
ON acl.approver_map (
  company_id,
  module_code,
  resource_code,
  action_code,
  COALESCE(subject_work_context_id, '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE(subject_user_id, '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE(subject_role_code, ''),
  approval_stage,
  approver_role_code
)
WHERE (resource_code IS NOT NULL AND action_code IS NOT NULL AND approver_role_code IS NOT NULL);

CREATE OR REPLACE FUNCTION acl.enforce_approver_bounds()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public', 'acl', 'erp_acl', 'erp_audit', 'erp_cache', 'erp_core', 'erp_hr', 'erp_map', 'erp_master', 'erp_menu', 'erp_meta'
AS $function$
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
    AND COALESCE(subject_user_id, '00000000-0000-0000-0000-000000000000'::UUID) =
        COALESCE(NEW.subject_user_id, '00000000-0000-0000-0000-000000000000'::UUID)
    AND COALESCE(subject_role_code, '') = COALESCE(NEW.subject_role_code, '')
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
$function$;
