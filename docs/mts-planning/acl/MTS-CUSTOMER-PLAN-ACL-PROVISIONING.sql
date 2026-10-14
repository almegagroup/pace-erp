-- MTS Customer Plan — ACL / menu provisioning (DATA CONFIG, run via MCP).
-- Status: PREPARED, NOT APPLIED anywhere. TX code PO21 approved by owner (2026-10-14).
--
-- Owner access rule (2026-10-14):
--   * Page sits in the Procurement menu group (GRP_ACL_PROCUREMENT).
--   * Full access (all plan types + Tab 2 stroke setup): SCM (SUPPLY CHAIN work
--     context), DIRECTOR, and ACL-MASTER (P0076 maintenance, CLAUDE.md pattern #5).
--   * View + Additional / Urgent entry only (Rolling / Final shown disabled):
--     STORES and LOGISTICS users and their managers, and the company's
--     L3_MANAGER (Plant Head, held under the MANAGEMENT work context —
--     PROD-ACL-Access-Decisions.md Basic Rule #6 / Special Rule #5).
--   * L4_MANAGER is never in a department's working grant (Basic Rule #5).
--   * Everyone else: no access.
--
-- Resources (route-acl-registry.ts):
--   PROC_MTS_CUSTOMER_PLAN           page resource: VIEW (all reads), WRITE (Additional/Urgent)
--   PROC_MTS_CUSTOMER_PLAN_MAINTAIN  companion (acl.menu_master only, no menu row):
--                                    WRITE (Rolling/Final + Tab 2)
--
-- Capabilities (a capability takes effect only when granted to BOTH the role
-- and the work context — PROD-ACL-Access-Decisions.md, generate_acl_snapshot note):
--   CAP_MTS_PLAN_FULL            roles L1..L4_USER, L1/L2_MANAGER, DIRECTOR;
--                                work contexts SUPPLY CHAIN, DIRECTOR, ACL-MASTER
--   CAP_MTS_PLAN_ADDON           roles L1..L4_USER, L1/L2_MANAGER;
--                                work contexts STORES, LOGISTICS
--   CAP_MTS_PLAN_ADDON_PLANTHEAD role L3_MANAGER; work context MANAGEMENT
--   (separate Plant Head capability so MANAGEMENT's other ranks do not inherit it)
--
-- Companies: CMP003, CMP005, CMP011 (owner B14).
--
-- After this script (same session, same DB):
--   2. Create a NEW acl_versions row per company and run
--      acl.capture_acl_version_source(new_version, company, actor)
--      (re-capturing an already-captured version is a silent no-op — CLAUDE.md §8).
--   3. acl.generate_acl_snapshot(new_version, company) and activate per runbook.
--   4. public.rebuild_acl_menu_snapshot(user, company, work_context) for affected users.
--   5. node scripts/acl-master-drift-check.mjs and dependency-provisioning-check SQL.
-- Run on DEV first; PROD only with separate explicit owner approval.

BEGIN;

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
  ('PROC_MTS_CUSTOMER_PLAN_MAINTAIN', 'MTS Customer Plan — Maintain', 'Rolling / Final plan entry and Tab 2 stroke setup (companion resource, no menu row)')
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

COMMIT;
