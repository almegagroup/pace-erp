/*
 * File-ID: 7.5.27
 * File-Path: supabase/migrations/20260410139000_gate7_5_27_fix_approver_scope_policy_gate.sql
 * Gate: 7.5
 * Phase: 7.5
 * Domain: ACL
 * Purpose: Allow scoped approver rules to target inbox APPROVE actions without forcing approval policy rows on the inbox itself.
 * Authority: Backend
 */

BEGIN;

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

    IF NEW.action_code <> 'APPROVE' THEN
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
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;
