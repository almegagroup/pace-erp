-- PO24 PO Status (Procurement menu) + PO23 GRN Receiving Report (Receiving menu) -- ACL / menu rollout (operational MCP SQL, outside
-- migration history; run on DEV and PROD separately, only AFTER the deploy carrying the pages + migration 20261120120000 is live).
-- Owner rule 2026-11-20: PO24 = everyone who holds Procurement-menu access; PO23 = everyone, company scoped. Every company is
-- re-checked against the caller's own on the backend.
-- One transaction: menu rows, grants, a new ACL version per active company, capture, snapshot, activate, menu rebuild, verify.
BEGIN;

CREATE TEMP TABLE po2x_before ON COMMIT DROP AS
SELECT p.auth_user_id, p.company_id, p.work_context_id, p.resource_code, p.action_code, p.decision, p.decision_reason, p.menu_visible
FROM acl.precomputed_acl_view p JOIN acl.acl_versions v USING (acl_version_id)
WHERE v.is_active;

INSERT INTO erp_menu.menu_master (menu_code, resource_code, title, description, route_path, menu_type, universe, is_system, display_order, is_active, created_by, tx_code)
SELECT x.code, x.code, x.title, x.descr, x.route, 'PAGE', 'ACL', false, x.ord, true, 'system', x.tx
FROM (VALUES
  ('PROC_PO_STATUS_REPORT', 'PO Status', 'PO24 -- per vendor / PO / material: PO qty, delivered, in-transit, open, knocked off, QA blocked; knock-off and cancel PO', '/dashboard/procurement/po-status', 23, 'PO24'),
  ('PROC_GRN_RECEIVING_REPORT', 'GRN Receiving Report', 'PO23 -- per gate entry PO line and GRN: PO qty, PO rate, GRN qty, QA blocked, balance after the GRN', '/dashboard/procurement/grn-receiving-report', 5, 'PO23')
) AS x(code, title, descr, route, ord, tx)
WHERE NOT EXISTS (SELECT 1 FROM erp_menu.menu_master m WHERE m.menu_code = x.code);

INSERT INTO acl.menu_master (menu_code, display_name, description, is_system)
SELECT x.code, x.title, x.descr, false
FROM (VALUES
  ('PROC_PO_STATUS_REPORT', 'PO Status', 'PO24 -- PO status report'),
  ('PROC_GRN_RECEIVING_REPORT', 'GRN Receiving Report', 'PO23 -- GRN receiving report')
) AS x(code, title, descr)
WHERE NOT EXISTS (SELECT 1 FROM acl.menu_master m WHERE m.menu_code = x.code);

INSERT INTO erp_menu.menu_tree (parent_menu_id, child_menu_id, display_order, created_by)
SELECT parent.id, child.id, x.ord, 'system'
FROM (VALUES ('GRP_ACL_PROCUREMENT', 'PROC_PO_STATUS_REPORT', 23), ('GRP_ACL_RECEIVING', 'PROC_GRN_RECEIVING_REPORT', 5)) AS x(grp, code, ord)
JOIN erp_menu.menu_master parent ON parent.menu_code = x.grp
JOIN erp_menu.menu_master child ON child.menu_code = x.code
WHERE NOT EXISTS (SELECT 1 FROM erp_menu.menu_tree t WHERE t.child_menu_id = child.id);

-- Company Modules: map each page to the module of a sibling page so a module-off company cannot see it.
INSERT INTO acl.module_resource_map (module_code, resource_code, created_by)
SELECT r.module_code, x.code, NULL
FROM (VALUES ('PROC_PO_STATUS_REPORT', 'PROC_PO_LIST'), ('PROC_GRN_RECEIVING_REPORT', 'PROC_GATE_REPORT')) AS x(code, sibling)
JOIN acl.module_resource_map r ON r.resource_code = x.sibling
WHERE NOT EXISTS (SELECT 1 FROM acl.module_resource_map y WHERE y.resource_code = x.code)
ON CONFLICT DO NOTHING;

-- PO24: every capability that already gives VIEW on any page of the Procurement menu group.
INSERT INTO acl.capability_menu_actions (capability_code, menu_id, action, allowed, menu_visible)
SELECT DISTINCT cma.capability_code, po24.id, 'VIEW', true, true
FROM erp_menu.menu_master grp
JOIN erp_menu.menu_tree t ON t.parent_menu_id = grp.id
JOIN erp_menu.menu_master child ON child.id = t.child_menu_id AND child.menu_type = 'PAGE'
JOIN acl.menu_master am ON am.menu_code = child.menu_code
JOIN acl.capability_menu_actions cma ON cma.menu_id = am.id AND cma.action = 'VIEW' AND cma.allowed
JOIN acl.menu_master po24 ON po24.menu_code = 'PROC_PO_STATUS_REPORT'
WHERE grp.menu_code = 'GRP_ACL_PROCUREMENT' AND child.menu_code <> 'PROC_PO_STATUS_REPORT' AND cma.capability_code <> 'CAP_EVERYONE_REPORTS'
  AND NOT EXISTS (SELECT 1 FROM acl.capability_menu_actions x WHERE x.capability_code = cma.capability_code AND x.menu_id = po24.id AND x.action = 'VIEW');

-- PO23: everyone (company-scoped reports capability).
INSERT INTO acl.capability_menu_actions (capability_code, menu_id, action, allowed, menu_visible)
SELECT 'CAP_EVERYONE_REPORTS', m.id, 'VIEW', true, true
FROM acl.menu_master m
WHERE m.menu_code = 'PROC_GRN_RECEIVING_REPORT'
  AND NOT EXISTS (SELECT 1 FROM acl.capability_menu_actions x WHERE x.capability_code = 'CAP_EVERYONE_REPORTS' AND x.menu_id = m.id AND x.action = 'VIEW');

CREATE TEMP TABLE po2x_old_versions ON COMMIT DROP AS
SELECT v.* FROM acl.acl_versions v WHERE v.is_active;

DO $rollout$
DECLARE v record; new_id uuid; next_number integer; u record;
BEGIN
  IF (SELECT count(*) FROM po2x_old_versions) <> (SELECT count(DISTINCT company_id) FROM po2x_old_versions) THEN
    RAISE EXCEPTION 'PO23/PO24 rollout: more than one active ACL version for a company';
  END IF;
  FOR v IN SELECT * FROM po2x_old_versions ORDER BY company_id LOOP
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO next_number FROM acl.acl_versions WHERE company_id = v.company_id;
    INSERT INTO acl.acl_versions (company_id, version_number, description, is_active, created_by)
    VALUES (v.company_id, next_number, 'PO24 PO Status + PO23 GRN Receiving Report', false, v.created_by)
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
    (SELECT * FROM po2x_before WHERE resource_code NOT IN ('PROC_PO_STATUS_REPORT', 'PROC_GRN_RECEIVING_REPORT') EXCEPT
      SELECT p.auth_user_id, p.company_id, p.work_context_id, p.resource_code, p.action_code, p.decision, p.decision_reason, p.menu_visible
      FROM acl.precomputed_acl_view p JOIN acl.acl_versions v USING (acl_version_id)
      WHERE v.is_active AND p.resource_code NOT IN ('PROC_PO_STATUS_REPORT', 'PROC_GRN_RECEIVING_REPORT'))
    UNION ALL
    (SELECT p.auth_user_id, p.company_id, p.work_context_id, p.resource_code, p.action_code, p.decision, p.decision_reason, p.menu_visible
      FROM acl.precomputed_acl_view p JOIN acl.acl_versions v USING (acl_version_id)
      WHERE v.is_active AND p.resource_code NOT IN ('PROC_PO_STATUS_REPORT', 'PROC_GRN_RECEIVING_REPORT')
      EXCEPT SELECT * FROM po2x_before WHERE resource_code NOT IN ('PROC_PO_STATUS_REPORT', 'PROC_GRN_RECEIVING_REPORT'))
  ) THEN RAISE EXCEPTION 'PO23/PO24 rollout would change unrelated ACL decisions'; END IF;

  -- 2. PO24: everyone who could see Purchase Orders (PO01) now sees PO24 ...
  IF EXISTS (
    SELECT auth_user_id, company_id, work_context_id FROM po2x_before WHERE resource_code = 'PROC_PO_LIST' AND action_code = 'VIEW' AND decision = 'ALLOW'
    EXCEPT
    SELECT p.auth_user_id, p.company_id, p.work_context_id FROM acl.precomputed_acl_view p JOIN acl.acl_versions v USING (acl_version_id)
    WHERE v.is_active AND p.resource_code = 'PROC_PO_STATUS_REPORT' AND p.action_code = 'VIEW' AND p.decision = 'ALLOW'
  ) THEN RAISE EXCEPTION 'PO24 is missing for someone who can see Purchase Orders'; END IF;
  -- ... and only people who already had some Procurement-menu page.
  IF EXISTS (
    SELECT p.auth_user_id, p.company_id, p.work_context_id FROM acl.precomputed_acl_view p JOIN acl.acl_versions v USING (acl_version_id)
    WHERE v.is_active AND p.resource_code = 'PROC_PO_STATUS_REPORT' AND p.action_code = 'VIEW' AND p.decision = 'ALLOW'
    EXCEPT
    SELECT b.auth_user_id, b.company_id, b.work_context_id FROM po2x_before b
    JOIN erp_menu.menu_master child ON child.menu_code = b.resource_code AND child.menu_type = 'PAGE'
    JOIN erp_menu.menu_tree t ON t.child_menu_id = child.id
    JOIN erp_menu.menu_master grp ON grp.id = t.parent_menu_id AND grp.menu_code = 'GRP_ACL_PROCUREMENT'
    WHERE b.action_code = 'VIEW' AND b.decision = 'ALLOW'
  ) THEN RAISE EXCEPTION 'PO24 leaked to someone with no Procurement-menu access'; END IF;

  -- 3. PO23: everyone who could see the Gate Entry Report (PO18) now sees PO23.
  IF EXISTS (
    SELECT auth_user_id, company_id, work_context_id FROM po2x_before WHERE resource_code = 'PROC_GATE_REPORT' AND action_code = 'VIEW' AND decision = 'ALLOW'
    EXCEPT
    SELECT p.auth_user_id, p.company_id, p.work_context_id FROM acl.precomputed_acl_view p JOIN acl.acl_versions v USING (acl_version_id)
    WHERE v.is_active AND p.resource_code = 'PROC_GRN_RECEIVING_REPORT' AND p.action_code = 'VIEW' AND p.decision = 'ALLOW'
  ) THEN RAISE EXCEPTION 'PO23 is missing for someone who can see the Gate Entry Report'; END IF;
END $verify$;

COMMIT;
