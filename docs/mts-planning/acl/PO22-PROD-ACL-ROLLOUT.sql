-- PO21 / PO22 PROD ACL rollout — R-04 operational MCP SQL (outside migration history).
-- Owner decision 2026-10-20: PO22 full authority = SCM, ACL-MASTER, Director only
-- (CAP_MTS_PLAN_FULL); PO21 cross company = same procurement team.
-- Run on PROD only AFTER PR #680 is merged and deploy-prod.yml has applied the PO22 migrations.
-- One transaction: provisioning (idempotent, copied verbatim from the three provisioning files),
-- new ACL version per company (CMP003 / CMP005 / CMP011), capture, snapshot, activate, menu
-- rebuild, then verification that aborts the whole run if any unrelated ACL decision changes
-- or the PO22 access matrix is wrong.
BEGIN;

CREATE TEMP TABLE po22_before ON COMMIT DROP AS
SELECT p.auth_user_id, p.company_id, p.work_context_id, p.resource_code, p.action_code, p.decision, p.decision_reason, p.menu_visible
FROM acl.precomputed_acl_view p JOIN acl.acl_versions v USING (acl_version_id)
JOIN erp_master.companies c ON c.id = p.company_id
WHERE v.is_active AND c.company_code IN ('CMP003', 'CMP005', 'CMP011');

-- ===== from MTS-CUSTOMER-PLAN-ACL-PROVISIONING.sql =====
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM erp_menu.menu_master WHERE tx_code = 'PO21' AND menu_code <> 'PROC_MTS_CUSTOMER_PLAN') THEN
    RAISE EXCEPTION 'TX code PO21 is already used by another menu in this database.';
  END IF;
END $$;

-- 1a. Menu page (erp_menu) + resource registry rows (acl).
INSERT INTO erp_menu.menu_master (menu_code, resource_code, title, description, route_path, menu_type, universe, is_system, display_order, is_active, created_by, tx_code)
SELECT 'PROC_MTS_CUSTOMER_PLAN', 'PROC_MTS_CUSTOMER_PLAN', 'MTS Customer Plan',
       'Asian Paints MTS customer plan: Plan Entry, Stroke & RM Primary, Plan Report',
       '/dashboard/procurement/mts-customer-plan', 'PAGE', 'ACL', false, 20, true, 'MTS_PLANNING_SETUP', 'PO21'
WHERE NOT EXISTS (SELECT 1 FROM erp_menu.menu_master WHERE menu_code = 'PROC_MTS_CUSTOMER_PLAN');

INSERT INTO erp_menu.menu_tree (parent_menu_id, child_menu_id, display_order)
SELECT p.id, c.id, 20
FROM erp_menu.menu_master p, erp_menu.menu_master c
WHERE p.menu_code = 'GRP_ACL_PROCUREMENT' AND c.menu_code = 'PROC_MTS_CUSTOMER_PLAN'
  AND NOT EXISTS (SELECT 1 FROM erp_menu.menu_tree t WHERE t.child_menu_id = c.id);

INSERT INTO acl.menu_master (menu_code, display_name, description, is_system)
SELECT v.code, v.name, v.descr, true
FROM (VALUES
  ('PROC_MTS_CUSTOMER_PLAN', 'MTS Customer Plan', 'Page view; Additional / Urgent plan entry'),
  ('PROC_MTS_CUSTOMER_PLAN_MAINTAIN', 'MTS Customer Plan — Maintain', 'Rolling / Final plan entry and Tab 2 stroke setup (companion resource, no menu row)'),
  ('PROC_MTS_PLAN_GROUP_MAINTAIN', 'MTS Customer Plan — Product Group', 'Mother / Child Product Group layout of Prodshades (companion resource, no menu row)'),
  ('PROC_MTS_PLAN_PRODUCTION_COMPANY', 'MTS Customer Plan — Cross company', 'Choose which company produces a plan month x SKU (procurement team; companion resource, no menu row)')
) AS v(code, name, descr)
WHERE NOT EXISTS (SELECT 1 FROM acl.menu_master m WHERE m.menu_code = v.code);

-- 1b. Capabilities.
INSERT INTO acl.capabilities (capability_code, capability_name, description, is_system)
SELECT v.code, v.name, v.descr, false
FROM (VALUES
  ('CAP_MTS_PLAN_FULL', 'MTS Customer Plan — Full', 'SCM / Director / ACL-MASTER: all plan types and stroke setup'),
  ('CAP_MTS_PLAN_ADDON', 'MTS Customer Plan — Additional/Urgent', 'Stores / Logistics: view plus Additional and Urgent entry'),
  ('CAP_MTS_PLAN_ADDON_PLANTHEAD', 'MTS Customer Plan — Additional/Urgent (Plant Head)', 'L3_MANAGER under MANAGEMENT: view plus Additional and Urgent entry')
) AS v(code, name, descr)
WHERE NOT EXISTS (SELECT 1 FROM acl.capabilities c WHERE c.capability_code = v.code);

-- 1c. Capability → resource actions.
INSERT INTO acl.capability_menu_actions (capability_code, menu_id, action, allowed, menu_visible)
SELECT v.cap, m.id, v.action, true, v.visible
FROM (VALUES
  ('CAP_MTS_PLAN_FULL',            'PROC_MTS_CUSTOMER_PLAN',          'VIEW',  true),
  ('CAP_MTS_PLAN_FULL',            'PROC_MTS_CUSTOMER_PLAN',          'WRITE', true),
  ('CAP_MTS_PLAN_FULL',            'PROC_MTS_CUSTOMER_PLAN_MAINTAIN', 'WRITE', false),
  ('CAP_MTS_PLAN_FULL',            'PROC_MTS_PLAN_GROUP_MAINTAIN',    'WRITE', false),
  ('CAP_MTS_PLAN_FULL',            'PROC_MTS_PLAN_PRODUCTION_COMPANY','WRITE', false),
  ('CAP_MTS_PLAN_ADDON',           'PROC_MTS_CUSTOMER_PLAN',          'VIEW',  true),
  ('CAP_MTS_PLAN_ADDON',           'PROC_MTS_CUSTOMER_PLAN',          'WRITE', true),
  ('CAP_MTS_PLAN_ADDON_PLANTHEAD', 'PROC_MTS_CUSTOMER_PLAN',          'VIEW',  true),
  ('CAP_MTS_PLAN_ADDON_PLANTHEAD', 'PROC_MTS_CUSTOMER_PLAN',          'WRITE', true)
) AS v(cap, menu_code, action, visible)
JOIN acl.menu_master m ON m.menu_code = v.menu_code
WHERE NOT EXISTS (
  SELECT 1 FROM acl.capability_menu_actions x
  WHERE x.capability_code = v.cap AND x.menu_id = m.id AND x.action = v.action
);

-- 1d. Role grants.
INSERT INTO acl.role_capabilities (role_code, capability_code)
SELECT v.role_code, v.cap
FROM (VALUES
  ('L1_USER', 'CAP_MTS_PLAN_FULL'), ('L2_USER', 'CAP_MTS_PLAN_FULL'), ('L3_USER', 'CAP_MTS_PLAN_FULL'), ('L4_USER', 'CAP_MTS_PLAN_FULL'),
  ('L1_MANAGER', 'CAP_MTS_PLAN_FULL'), ('L2_MANAGER', 'CAP_MTS_PLAN_FULL'), ('DIRECTOR', 'CAP_MTS_PLAN_FULL'),
  ('L1_USER', 'CAP_MTS_PLAN_ADDON'), ('L2_USER', 'CAP_MTS_PLAN_ADDON'), ('L3_USER', 'CAP_MTS_PLAN_ADDON'), ('L4_USER', 'CAP_MTS_PLAN_ADDON'),
  ('L1_MANAGER', 'CAP_MTS_PLAN_ADDON'), ('L2_MANAGER', 'CAP_MTS_PLAN_ADDON'),
  ('L3_MANAGER', 'CAP_MTS_PLAN_ADDON_PLANTHEAD')
) AS v(role_code, cap)
WHERE NOT EXISTS (SELECT 1 FROM acl.role_capabilities r WHERE r.role_code = v.role_code AND r.capability_code = v.cap);

-- 1e. Work-context grants, resolved by name per company (no hard-coded ids).
INSERT INTO acl.work_context_capabilities (work_context_id, capability_code)
SELECT w.work_context_id, v.cap
FROM (VALUES
  ('SUPPLY CHAIN', 'CAP_MTS_PLAN_FULL'),
  ('DIRECTOR',     'CAP_MTS_PLAN_FULL'),
  ('ACL-MASTER',   'CAP_MTS_PLAN_FULL'),
  ('STORES',       'CAP_MTS_PLAN_ADDON'),
  ('LOGISTICS',    'CAP_MTS_PLAN_ADDON'),
  ('MANAGEMENT',   'CAP_MTS_PLAN_ADDON_PLANTHEAD')
) AS v(wc_name, cap)
JOIN erp_acl.work_contexts w ON w.work_context_name = v.wc_name AND w.is_active
JOIN erp_master.companies c ON c.id = w.company_id AND c.company_code IN ('CMP003', 'CMP005', 'CMP011')
WHERE NOT EXISTS (
  SELECT 1 FROM acl.work_context_capabilities x WHERE x.work_context_id = w.work_context_id AND x.capability_code = v.cap
);

-- ===== from MTS-REQUIREMENT-ACL-PROVISIONING.sql =====
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM erp_menu.menu_master WHERE tx_code = 'PO22' AND menu_code <> 'PROC_MTS_REQUIREMENT') THEN
    RAISE EXCEPTION 'TX code PO22 is already used by another menu in this database.';
  END IF;
END $$;

INSERT INTO erp_menu.menu_master (menu_code, resource_code, title, description, route_path, menu_type, universe, is_system, display_order, is_active, created_by, tx_code)
SELECT 'PROC_MTS_REQUIREMENT', 'PROC_MTS_REQUIREMENT', 'Requirement',
       'MTS Planning: RM/PM Requirement Report and Material Settings (coverage days, MOQ)',
       '/dashboard/procurement/mts-requirement', 'PAGE', 'ACL', false, 21, true, 'MTS_PLANNING_SETUP', 'PO22'
WHERE NOT EXISTS (SELECT 1 FROM erp_menu.menu_master WHERE menu_code = 'PROC_MTS_REQUIREMENT');

INSERT INTO erp_menu.menu_tree (parent_menu_id, child_menu_id, display_order)
SELECT p.id, c.id, 21
FROM erp_menu.menu_master p, erp_menu.menu_master c
WHERE p.menu_code = 'GRP_ACL_PROCUREMENT' AND c.menu_code = 'PROC_MTS_REQUIREMENT'
  AND NOT EXISTS (SELECT 1 FROM erp_menu.menu_tree t WHERE t.child_menu_id = c.id);

INSERT INTO acl.menu_master (menu_code, display_name, description, is_system)
SELECT v.code, v.name, v.descr, true
FROM (VALUES
  ('PROC_MTS_REQUIREMENT', 'Requirement', 'PO22 page view (Requirement Report + Material Settings read)'),
  ('PROC_MTS_REQUIREMENT_POLICY', 'Requirement — Material Settings', 'Save Target / Critical coverage days and MOQ (companion resource, no menu row)')
) AS v(code, name, descr)
WHERE NOT EXISTS (SELECT 1 FROM acl.menu_master m WHERE m.menu_code = v.code);

INSERT INTO acl.capability_menu_actions (capability_code, menu_id, action, allowed, menu_visible)
SELECT v.cap, m.id, v.action, true, v.visible
FROM (VALUES
  ('CAP_MTS_PLAN_FULL',            'PROC_MTS_REQUIREMENT',        'VIEW',  true),
  ('CAP_MTS_PLAN_FULL',            'PROC_MTS_REQUIREMENT_POLICY', 'WRITE', false)
) AS v(cap, menu_code, action, visible)
JOIN acl.menu_master m ON m.menu_code = v.menu_code
WHERE EXISTS (SELECT 1 FROM acl.capabilities c WHERE c.capability_code = v.cap)
  AND NOT EXISTS (
    SELECT 1 FROM acl.capability_menu_actions x
    WHERE x.capability_code = v.cap AND x.menu_id = m.id AND x.action = v.action
  );

-- ===== from MTS-OPTIMIZER-PHASE-3B-ACL-PROVISIONING.sql =====
-- Fail rather than silently omitting a grant if the existing PO21 capability
-- catalog is incomplete in the target database. ACL-MASTER/P0076 inclusion is
-- verified after new-version snapshot generation, not assumed from a role name.
DO $$
DECLARE v_capability text;
BEGIN
  FOREACH v_capability IN ARRAY ARRAY['CAP_MTS_PLAN_FULL'] LOOP
    IF NOT EXISTS (SELECT 1 FROM acl.capabilities c WHERE c.capability_code = v_capability) THEN
      RAISE EXCEPTION 'MTS_OPTIMIZER_ACL_CAPABILITY_MISSING: %', v_capability;
    END IF;
  END LOOP;
END;
$$;

INSERT INTO acl.menu_master (menu_code, display_name, description, is_system)
SELECT v.code, v.name, v.description, true
FROM (VALUES
  ('PROC_MTS_OPTIMIZER_INPUT', 'PO22 Optimizer Input', 'Read immutable optimizer source snapshots (no operational action)'),
  ('PROC_MTS_OPTIMIZER_SELECTION', 'PO22 Optimizer Selection', 'Save monthly new-purchase material eligibility only')
) AS v(code, name, description)
WHERE NOT EXISTS (SELECT 1 FROM acl.menu_master m WHERE m.menu_code = v.code);

INSERT INTO acl.capability_menu_actions (capability_code, menu_id, action, allowed, menu_visible)
SELECT v.capability_code, m.id, v.action, true, false
FROM (VALUES
  ('CAP_MTS_PLAN_FULL',            'PROC_MTS_OPTIMIZER_INPUT',     'VIEW'),
  ('CAP_MTS_PLAN_FULL',            'PROC_MTS_OPTIMIZER_SELECTION', 'WRITE')
) AS v(capability_code, menu_code, action)
JOIN acl.menu_master m ON m.menu_code = v.menu_code
WHERE NOT EXISTS (
    SELECT 1 FROM acl.capability_menu_actions existing
    WHERE existing.capability_code = v.capability_code
      AND existing.menu_id = m.id
      AND existing.action = v.action
  );

-- ===== new ACL version per company (never re-capture a frozen version) =====
CREATE TEMP TABLE po22_old_versions ON COMMIT DROP AS
SELECT v.* FROM acl.acl_versions v JOIN erp_master.companies c ON c.id = v.company_id
WHERE v.is_active AND c.company_code IN ('CMP003', 'CMP005', 'CMP011');

DO $rollout$
DECLARE v record; new_id uuid; next_number integer; u record;
BEGIN
  IF (SELECT count(*) FROM po22_old_versions) <> 3 THEN
    RAISE EXCEPTION 'PO22 rollout: expected exactly one active ACL version for each of CMP003/CMP005/CMP011';
  END IF;
  FOR v IN SELECT * FROM po22_old_versions ORDER BY company_id LOOP
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO next_number FROM acl.acl_versions WHERE company_id = v.company_id;
    INSERT INTO acl.acl_versions (company_id, version_number, description, is_active, created_by)
    VALUES (v.company_id, next_number, 'PO22 Requirement/Planning + PO21 cross company (SCM / ACL-MASTER / Director)', false, v.created_by)
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

-- ===== verification =====
DO $verify$
DECLARE new_codes text[] := ARRAY['PROC_MTS_REQUIREMENT', 'PROC_MTS_REQUIREMENT_POLICY', 'PROC_MTS_OPTIMIZER_INPUT', 'PROC_MTS_OPTIMIZER_SELECTION', 'PROC_MTS_PLAN_PRODUCTION_COMPANY'];
BEGIN
  -- 1. nothing else changed for anyone
  IF EXISTS (
    (SELECT * FROM po22_before WHERE resource_code <> ALL (new_codes) EXCEPT
      SELECT p.auth_user_id, p.company_id, p.work_context_id, p.resource_code, p.action_code, p.decision, p.decision_reason, p.menu_visible
      FROM acl.precomputed_acl_view p JOIN acl.acl_versions v USING (acl_version_id)
      JOIN erp_master.companies c ON c.id = p.company_id
      WHERE v.is_active AND c.company_code IN ('CMP003', 'CMP005', 'CMP011') AND p.resource_code <> ALL (new_codes))
    UNION ALL
    (SELECT p.auth_user_id, p.company_id, p.work_context_id, p.resource_code, p.action_code, p.decision, p.decision_reason, p.menu_visible
      FROM acl.precomputed_acl_view p JOIN acl.acl_versions v USING (acl_version_id)
      JOIN erp_master.companies c ON c.id = p.company_id
      WHERE v.is_active AND c.company_code IN ('CMP003', 'CMP005', 'CMP011') AND p.resource_code <> ALL (new_codes)
      EXCEPT SELECT * FROM po22_before WHERE resource_code <> ALL (new_codes))
  ) THEN RAISE EXCEPTION 'PO22 rollout would change unrelated ACL decisions'; END IF;

  -- 2. PO22 / cross company only in SUPPLY CHAIN, DIRECTOR, ACL-MASTER work contexts
  IF EXISTS (
    SELECT 1 FROM acl.precomputed_acl_view p JOIN acl.acl_versions v USING (acl_version_id)
    JOIN erp_acl.work_contexts w ON w.work_context_id = p.work_context_id
    JOIN erp_master.companies c ON c.id = p.company_id
    WHERE v.is_active AND c.company_code IN ('CMP003', 'CMP005', 'CMP011')
      AND p.resource_code = ANY (new_codes) AND p.decision = 'ALLOW'
      AND w.work_context_name NOT IN ('SUPPLY CHAIN', 'DIRECTOR', 'ACL-MASTER')
  ) THEN RAISE EXCEPTION 'PO22 access leaked outside SCM / Director / ACL-MASTER'; END IF;

  -- 3. every company has at least one user who can open PO22 and save settings
  IF (SELECT count(DISTINCT p.company_id) FROM acl.precomputed_acl_view p JOIN acl.acl_versions v USING (acl_version_id)
      JOIN erp_master.companies c ON c.id = p.company_id
      WHERE v.is_active AND c.company_code IN ('CMP003', 'CMP005', 'CMP011')
        AND p.resource_code = 'PROC_MTS_REQUIREMENT_POLICY' AND p.action_code = 'WRITE' AND p.decision = 'ALLOW') <> 3
  THEN RAISE EXCEPTION 'PO22 settings WRITE missing in at least one company'; END IF;
END $verify$;

COMMIT;

-- After COMMIT: node scripts/acl-master-drift-check.mjs (P0076 coverage) and spot-check the
-- PO22 menu for one SCM user per company.
