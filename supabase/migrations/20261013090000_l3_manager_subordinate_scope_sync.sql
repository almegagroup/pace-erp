-- L3 Manager = full subordinate scope in their company, no self-approval
-- (business owner 2026-10-13).
--
-- The one-time data alignment (MANAGEMENT work context capabilities, approver
-- rows, ACL versions) is environment data and lives in
-- docs/Operation Management/implementation-specs/L3-MANAGER-SUBORDINATE-SCOPE-MCP-ROLLOUT.sql.
-- This migration only keeps that alignment true for everything added later:
--
-- 1. A capability granted to any department work context (Production,
--    Quality, Stores, Accounts, Logistics, ...) is mirrored onto the same
--    company's MANAGEMENT work context and onto the L3_MANAGER role.
--    Excluded sources: ACL-MASTER / DIRECTOR / DIRECTOR-REPORTS (above L3),
--    AUDIT (independent checker), MANAGEMENT itself, and SUPPLY CHAIN
--    (Procurement is Supply Chain + ACL-MASTER only).
--
-- 2. A rank-based approval rule (scope_type SUBJECT_ROLE) for a subordinate
--    rank, decided by a non-auditor approver, is mirrored as an L3_MANAGER /
--    MANAGEMENT approver rule for the same company + resource + subject rank.
--    Procurement-group resources and auditor-owned approvals are skipped.
--    Self-approval stays blocked by each handler's creator check.
--
-- New capabilities still reach users only after the usual ACL version
-- capture + snapshot rebuild, exactly like every other ACL data change.

CREATE OR REPLACE FUNCTION acl.sync_l3_manager_work_context_capability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'acl', 'erp_acl'
AS $function$
DECLARE
  v_company_id uuid;
  v_work_context_name text;
BEGIN
  SELECT wc.company_id, upper(trim(wc.work_context_name))
  INTO v_company_id, v_work_context_name
  FROM erp_acl.work_contexts wc
  WHERE wc.work_context_id = NEW.work_context_id;

  IF v_company_id IS NULL
     OR v_work_context_name IN ('ACL-MASTER', 'DIRECTOR', 'DIRECTOR-REPORTS', 'AUDIT', 'MANAGEMENT', 'SUPPLY CHAIN') THEN
    RETURN NEW;
  END IF;

  INSERT INTO acl.work_context_capabilities (work_context_id, capability_code, created_at)
  SELECT m.work_context_id, NEW.capability_code, now()
  FROM erp_acl.work_contexts m
  WHERE m.company_id = v_company_id
    AND upper(trim(m.work_context_name)) = 'MANAGEMENT'
    AND m.is_active
  ON CONFLICT DO NOTHING;

  INSERT INTO acl.role_capabilities (role_code, capability_code, created_at)
  VALUES ('L3_MANAGER', NEW.capability_code, now())
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_l3_manager_work_context_capability ON acl.work_context_capabilities;
CREATE TRIGGER trg_sync_l3_manager_work_context_capability
AFTER INSERT ON acl.work_context_capabilities
FOR EACH ROW EXECUTE FUNCTION acl.sync_l3_manager_work_context_capability();

CREATE OR REPLACE FUNCTION acl.sync_l3_manager_approver_rule()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'acl', 'erp_acl', 'erp_menu'
AS $function$
DECLARE
  v_management_wc uuid;
BEGIN
  IF upper(coalesce(NEW.scope_type, '')) <> 'SUBJECT_ROLE'
     OR NEW.resource_code IS NULL
     OR NEW.action_code IS NULL
     OR NEW.approver_role_code IS NULL
     OR NEW.approver_role_code IN ('L3_MANAGER', 'L1_AUDITOR', 'L2_AUDITOR')
     OR coalesce(NEW.subject_role_code, '') NOT IN ('L1_USER', 'L2_USER', 'L3_USER', 'L4_USER', 'L1_MANAGER', 'L2_MANAGER') THEN
    RETURN NEW;
  END IF;

  -- Procurement belongs to Supply Chain + ACL-MASTER only.
  IF EXISTS (
    WITH RECURSIVE grp AS (
      SELECT mm.id, mm.menu_code
      FROM erp_menu.menu_master mm
      WHERE mm.menu_code = 'GRP_ACL_PROCUREMENT'
      UNION ALL
      SELECT child.id, child.menu_code
      FROM erp_menu.menu_tree t
      JOIN erp_menu.menu_master child ON child.id = t.child_menu_id
      JOIN grp ON grp.id = t.parent_menu_id
    )
    SELECT 1 FROM grp WHERE grp.menu_code = NEW.resource_code
  ) THEN
    RETURN NEW;
  END IF;

  SELECT m.work_context_id
  INTO v_management_wc
  FROM erp_acl.work_contexts m
  WHERE m.company_id = NEW.company_id
    AND upper(trim(m.work_context_name)) = 'MANAGEMENT'
    AND m.is_active
  LIMIT 1;

  IF v_management_wc IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    INSERT INTO acl.approver_map (
      approver_id, company_id, module_code, approval_stage, approver_role_code,
      approver_user_id, created_at, created_by, resource_code, action_code,
      subject_work_context_id, scope_type, subject_user_id, subject_role_code,
      approver_work_context_id
    )
    SELECT gen_random_uuid(), NEW.company_id, NEW.module_code, NEW.approval_stage, 'L3_MANAGER',
           NULL, now(), NEW.created_by, NEW.resource_code, NEW.action_code,
           NULL, 'SUBJECT_ROLE', NULL, NEW.subject_role_code,
           v_management_wc
    WHERE NOT EXISTS (
      SELECT 1 FROM acl.approver_map x
      WHERE x.company_id = NEW.company_id
        AND x.resource_code = NEW.resource_code
        AND x.action_code = NEW.action_code
        AND x.scope_type = 'SUBJECT_ROLE'
        AND x.subject_role_code = NEW.subject_role_code
        AND x.approval_stage = NEW.approval_stage
        AND x.approver_role_code = 'L3_MANAGER'
    );
  EXCEPTION WHEN others THEN
    -- Never block the original approver rule (e.g. the 5-approver bound).
    RAISE WARNING 'L3 Manager approver mirror skipped for % / %: %', NEW.resource_code, NEW.subject_role_code, SQLERRM;
  END;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_l3_manager_approver_rule ON acl.approver_map;
CREATE TRIGGER trg_sync_l3_manager_approver_rule
AFTER INSERT ON acl.approver_map
FOR EACH ROW EXECUTE FUNCTION acl.sync_l3_manager_approver_rule();
