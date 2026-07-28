-- File-Path: supabase/migrations/20260728143000_approver_map_subject_user_scope.sql
-- Purpose: acl.approver_map's uniqueness index and 3-approver cap both scope
-- by (company, module, subject_work_context_id) but never by subject_user_id
-- — so a USER_EXCEPTION creator-chain (different named creators routed to
-- different approvers) gets incorrectly merged into one bucket: two
-- different creators naming the same approver collide as "duplicates", and
-- a 4-branch chain (3 named creators + 1 role fallback) hits the 3-approver
-- cap even though each branch is a distinct creator scope. This never
-- surfaced before because acl.approver_map had zero rows in prod until the
-- Group 3 Procurement ACL pass (2026-07-28) tried to seed a real
-- creator-chain (Alim -> Prasenjit/Ankan, Prasenjit -> Ankan, Ankan ->
-- Director) for PO/STO approval.
--
-- Fix: both the unique index and the count-cap trigger now also partition
-- by COALESCE(subject_user_id, zero-uuid), matching the existing pattern
-- already used for subject_work_context_id. Table had zero rows at the time
-- of this migration (verified), so no data backfill needed.

DROP INDEX IF EXISTS acl.uq_approver_user_exact_subject_scope;

CREATE UNIQUE INDEX uq_approver_user_exact_subject_scope
ON acl.approver_map (
  company_id,
  module_code,
  resource_code,
  action_code,
  COALESCE(subject_work_context_id, '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE(subject_user_id, '00000000-0000-0000-0000-000000000000'::uuid),
  approval_stage,
  approver_user_id
)
WHERE (resource_code IS NOT NULL AND action_code IS NOT NULL AND approver_user_id IS NOT NULL);

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
