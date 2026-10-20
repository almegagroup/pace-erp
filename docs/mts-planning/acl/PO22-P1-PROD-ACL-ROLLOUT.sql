-- PO22 P1 PROD ACL rollout — R-04 operational MCP SQL (outside migration history).
-- Owner approval 2026-10-20: PR almegagroup/pace-erp#684 merge + ACL for the new companion
-- resource PROC_MTS_INBOUND_RESCHEDULE (planning-side rescheduled ETA), CAP_MTS_PLAN_FULL only
-- = SUPPLY CHAIN / DIRECTOR / ACL-MASTER work contexts.
-- Run on PROD only AFTER deploy-prod.yml has applied migration 20261021100000.
-- One transaction: provisioning (idempotent), new ACL version per company, capture, snapshot,
-- activate, menu rebuild, verification that aborts on any unrelated change.
BEGIN;

CREATE TEMP TABLE p1_before ON COMMIT DROP AS
SELECT p.auth_user_id, p.company_id, p.work_context_id, p.resource_code, p.action_code, p.decision, p.decision_reason, p.menu_visible
FROM acl.precomputed_acl_view p JOIN acl.acl_versions v USING (acl_version_id)
JOIN erp_master.companies c ON c.id = p.company_id
WHERE v.is_active AND c.company_code IN ('CMP003', 'CMP005', 'CMP011');

INSERT INTO acl.menu_master (menu_code, display_name, description, is_system)
SELECT 'PROC_MTS_INBOUND_RESCHEDULE', 'MTS Planning — Reschedule arrivals',
       'Planning-only rescheduled plant ETA of a not-yet-shipped PO / CSN / lot (CSN Tracker untouched; companion resource, no menu row)', true
WHERE NOT EXISTS (SELECT 1 FROM acl.menu_master m WHERE m.menu_code = 'PROC_MTS_INBOUND_RESCHEDULE');

INSERT INTO acl.capability_menu_actions (capability_code, menu_id, action, allowed, menu_visible)
SELECT 'CAP_MTS_PLAN_FULL', m.id, 'WRITE', true, false
FROM acl.menu_master m
WHERE m.menu_code = 'PROC_MTS_INBOUND_RESCHEDULE'
  AND NOT EXISTS (
    SELECT 1 FROM acl.capability_menu_actions x
    WHERE x.capability_code = 'CAP_MTS_PLAN_FULL' AND x.menu_id = m.id AND x.action = 'WRITE'
  );

CREATE TEMP TABLE p1_old_versions ON COMMIT DROP AS
SELECT v.* FROM acl.acl_versions v JOIN erp_master.companies c ON c.id = v.company_id
WHERE v.is_active AND c.company_code IN ('CMP003', 'CMP005', 'CMP011');

DO $rollout$
DECLARE v record; new_id uuid; next_number integer; u record;
BEGIN
  IF (SELECT count(*) FROM p1_old_versions) <> 3 THEN
    RAISE EXCEPTION 'P1 rollout: expected exactly one active ACL version for each of CMP003/CMP005/CMP011';
  END IF;
  FOR v IN SELECT * FROM p1_old_versions ORDER BY company_id LOOP
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO next_number FROM acl.acl_versions WHERE company_id = v.company_id;
    INSERT INTO acl.acl_versions (company_id, version_number, description, is_active, created_by)
    VALUES (v.company_id, next_number, 'PO22 P1 Item Plan: reschedule arrivals (SCM / ACL-MASTER / Director)', false, v.created_by)
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
    (SELECT * FROM p1_before WHERE resource_code <> 'PROC_MTS_INBOUND_RESCHEDULE' EXCEPT
      SELECT p.auth_user_id, p.company_id, p.work_context_id, p.resource_code, p.action_code, p.decision, p.decision_reason, p.menu_visible
      FROM acl.precomputed_acl_view p JOIN acl.acl_versions v USING (acl_version_id)
      JOIN erp_master.companies c ON c.id = p.company_id
      WHERE v.is_active AND c.company_code IN ('CMP003', 'CMP005', 'CMP011') AND p.resource_code <> 'PROC_MTS_INBOUND_RESCHEDULE')
    UNION ALL
    (SELECT p.auth_user_id, p.company_id, p.work_context_id, p.resource_code, p.action_code, p.decision, p.decision_reason, p.menu_visible
      FROM acl.precomputed_acl_view p JOIN acl.acl_versions v USING (acl_version_id)
      JOIN erp_master.companies c ON c.id = p.company_id
      WHERE v.is_active AND c.company_code IN ('CMP003', 'CMP005', 'CMP011') AND p.resource_code <> 'PROC_MTS_INBOUND_RESCHEDULE'
      EXCEPT SELECT * FROM p1_before WHERE resource_code <> 'PROC_MTS_INBOUND_RESCHEDULE')
  ) THEN RAISE EXCEPTION 'P1 rollout would change unrelated ACL decisions'; END IF;

  -- 2. reschedule only in SUPPLY CHAIN, DIRECTOR, ACL-MASTER
  IF EXISTS (
    SELECT 1 FROM acl.precomputed_acl_view p JOIN acl.acl_versions v USING (acl_version_id)
    JOIN erp_acl.work_contexts w ON w.work_context_id = p.work_context_id
    JOIN erp_master.companies c ON c.id = p.company_id
    WHERE v.is_active AND c.company_code IN ('CMP003', 'CMP005', 'CMP011')
      AND p.resource_code = 'PROC_MTS_INBOUND_RESCHEDULE' AND p.decision = 'ALLOW'
      AND w.work_context_name NOT IN ('SUPPLY CHAIN', 'DIRECTOR', 'ACL-MASTER')
  ) THEN RAISE EXCEPTION 'Reschedule access leaked outside SCM / Director / ACL-MASTER'; END IF;

  -- 3. every company has at least one user who can reschedule
  IF (SELECT count(DISTINCT p.company_id) FROM acl.precomputed_acl_view p JOIN acl.acl_versions v USING (acl_version_id)
      JOIN erp_master.companies c ON c.id = p.company_id
      WHERE v.is_active AND c.company_code IN ('CMP003', 'CMP005', 'CMP011')
        AND p.resource_code = 'PROC_MTS_INBOUND_RESCHEDULE' AND p.action_code = 'WRITE' AND p.decision = 'ALLOW') <> 3
  THEN RAISE EXCEPTION 'Reschedule WRITE missing in at least one company'; END IF;
END $verify$;

COMMIT;
