-- SO06 FG Movement Report -- ACL / menu rollout (operational MCP SQL, outside migration history; run on DEV and PROD separately).
-- Owner approval 2026-11-19: SO06 in the Sales menu (GRP_ACL_SALES), visible to everyone; every company is re-checked against the
-- caller's own on the backend, so a user only ever sees the companies they belong to.
-- Run only AFTER the deploy that carries the page + migration 20261119150000 is live.
-- One transaction: menu rows (idempotent), grant on CAP_EVERYONE_REPORTS (the "company-scoped reports for every department"
-- capability), a new ACL version per active company, capture, snapshot, activate, menu rebuild, verification that aborts on
-- any unrelated ACL change.
BEGIN;

CREATE TEMP TABLE so06_before ON COMMIT DROP AS
SELECT p.auth_user_id, p.company_id, p.work_context_id, p.resource_code, p.action_code, p.decision, p.decision_reason, p.menu_visible
FROM acl.precomputed_acl_view p JOIN acl.acl_versions v USING (acl_version_id)
WHERE v.is_active;

INSERT INTO erp_menu.menu_master (menu_code, resource_code, title, description, route_path, menu_type, universe, is_system, display_order, is_active, created_by, tx_code)
SELECT 'PROC_FG_MOVEMENT_REPORT', 'PROC_FG_MOVEMENT_REPORT', 'FG Movement Report',
       'SO06 -- FG Opening / Production / PID / Dispatch / Closing / In QA / Blocked per SKU by PO21 Mother and Child group, and where dispatched',
       '/dashboard/procurement/sales/fg-movement-report', 'PAGE', 'ACL', false, 5, true, 'system', 'SO06'
WHERE NOT EXISTS (SELECT 1 FROM erp_menu.menu_master m WHERE m.menu_code = 'PROC_FG_MOVEMENT_REPORT');

INSERT INTO acl.menu_master (menu_code, display_name, description, is_system)
SELECT 'PROC_FG_MOVEMENT_REPORT', 'FG Movement Report', 'SO06 -- FG movement report by Mother / Child group', false
WHERE NOT EXISTS (SELECT 1 FROM acl.menu_master m WHERE m.menu_code = 'PROC_FG_MOVEMENT_REPORT');

INSERT INTO erp_menu.menu_tree (parent_menu_id, child_menu_id, display_order, created_by)
SELECT parent.id, child.id, 5, 'system'
FROM erp_menu.menu_master parent, erp_menu.menu_master child
WHERE parent.menu_code = 'GRP_ACL_SALES' AND child.menu_code = 'PROC_FG_MOVEMENT_REPORT'
  AND NOT EXISTS (SELECT 1 FROM erp_menu.menu_tree t WHERE t.child_menu_id = child.id);

INSERT INTO acl.capability_menu_actions (capability_code, menu_id, action, allowed, menu_visible)
SELECT 'CAP_EVERYONE_REPORTS', m.id, 'VIEW', true, true
FROM acl.menu_master m
WHERE m.menu_code = 'PROC_FG_MOVEMENT_REPORT'
  AND NOT EXISTS (SELECT 1 FROM acl.capability_menu_actions x WHERE x.capability_code = 'CAP_EVERYONE_REPORTS' AND x.menu_id = m.id AND x.action = 'VIEW');

CREATE TEMP TABLE so06_old_versions ON COMMIT DROP AS
SELECT v.* FROM acl.acl_versions v WHERE v.is_active;

DO $rollout$
DECLARE v record; new_id uuid; next_number integer; u record;
BEGIN
  IF (SELECT count(*) FROM so06_old_versions) <> (SELECT count(DISTINCT company_id) FROM so06_old_versions) THEN
    RAISE EXCEPTION 'SO06 rollout: more than one active ACL version for a company';
  END IF;
  FOR v IN SELECT * FROM so06_old_versions ORDER BY company_id LOOP
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO next_number FROM acl.acl_versions WHERE company_id = v.company_id;
    INSERT INTO acl.acl_versions (company_id, version_number, description, is_active, created_by)
    VALUES (v.company_id, next_number, 'SO06 FG Movement Report (everyone, company-scoped)', false, v.created_by)
    RETURNING acl_version_id INTO new_id;
    PERFORM acl.capture_acl_version_source(new_id, v.company_id, v.created_by);
    PERFORM acl.generate_acl_snapshot(new_id, v.company_id);
    UPDATE acl.acl_versions SET is_active = false WHERE acl_version_id = v.acl_version_id;
    UPDATE acl.acl_versions SET is_active = true WHERE acl_version_id = new_id;
    FOR u IN SELECT DISTINCT auth_user_id, company_id, work_context_id FROM erp_acl.user_work_contexts WHERE company_id = v.company_id LOOP
      PERFORM public.rebuild_acl_menu_snapshot(u.auth_user_id, u.company_id, u.work_context_id);
    END LOOP;
  END LOOP;
END $rollout$;

DO $verify$
BEGIN
  -- 1. nothing else changed for anyone
  IF EXISTS (
    (SELECT * FROM so06_before WHERE resource_code <> 'PROC_FG_MOVEMENT_REPORT' EXCEPT
      SELECT p.auth_user_id, p.company_id, p.work_context_id, p.resource_code, p.action_code, p.decision, p.decision_reason, p.menu_visible
      FROM acl.precomputed_acl_view p JOIN acl.acl_versions v USING (acl_version_id)
      WHERE v.is_active AND p.resource_code <> 'PROC_FG_MOVEMENT_REPORT')
    UNION ALL
    (SELECT p.auth_user_id, p.company_id, p.work_context_id, p.resource_code, p.action_code, p.decision, p.decision_reason, p.menu_visible
      FROM acl.precomputed_acl_view p JOIN acl.acl_versions v USING (acl_version_id)
      WHERE v.is_active AND p.resource_code <> 'PROC_FG_MOVEMENT_REPORT'
      EXCEPT SELECT * FROM so06_before WHERE resource_code <> 'PROC_FG_MOVEMENT_REPORT')
  ) THEN RAISE EXCEPTION 'SO06 rollout would change unrelated ACL decisions'; END IF;

  -- 2. exactly the people who already see another "everyone" report (SO04 Dispatch Report) now see SO06
  IF EXISTS (
    (SELECT auth_user_id, company_id, work_context_id FROM so06_before WHERE resource_code = 'PROC_DISPATCH_REPORT' AND action_code = 'VIEW' AND decision = 'ALLOW'
     EXCEPT
     SELECT p.auth_user_id, p.company_id, p.work_context_id FROM acl.precomputed_acl_view p JOIN acl.acl_versions v USING (acl_version_id)
     WHERE v.is_active AND p.resource_code = 'PROC_FG_MOVEMENT_REPORT' AND p.action_code = 'VIEW' AND p.decision = 'ALLOW')
  ) THEN RAISE EXCEPTION 'SO06 is missing for someone who can see the Dispatch Report'; END IF;
  IF EXISTS (
    SELECT p.auth_user_id, p.company_id, p.work_context_id FROM acl.precomputed_acl_view p JOIN acl.acl_versions v USING (acl_version_id)
    WHERE v.is_active AND p.resource_code = 'PROC_FG_MOVEMENT_REPORT' AND p.action_code = 'VIEW' AND p.decision = 'ALLOW'
    EXCEPT
    SELECT auth_user_id, company_id, work_context_id FROM so06_before WHERE resource_code = 'PROC_DISPATCH_REPORT' AND action_code = 'VIEW' AND decision = 'ALLOW'
  ) THEN RAISE EXCEPTION 'SO06 leaked to someone who cannot see the Dispatch Report'; END IF;
END $verify$;

COMMIT;
