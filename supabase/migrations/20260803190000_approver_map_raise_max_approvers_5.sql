-- File-ID: 7.5.32
-- Purpose: Raise acl.approver_map's "max approvers per exact scope" guard from
--          3 to 5. Discovered 2026-08-03 while designing Stroke Master's
--          maker-checker chain (Task C follow-up) — a creator rank legitimately
--          needing 4 alternative approvers (L2_MANAGER, L1_AUDITOR, L2_AUDITOR,
--          L3_MANAGER) hit the old limit. Business owner's explicit choice:
--          raise the ceiling to 5 rather than drop a legitimate approver.
--          DIRECTOR is handled as a code-level bypass (like SA/GA), not a
--          approver_map row, so it never consumes one of these slots.
-- Authority: Backend

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

  IF v_count > 5 THEN
    RAISE EXCEPTION 'Maximum 5 approvers allowed per exact approval scope';
  END IF;

  RETURN NEW;
END;
$function$;
