-- PO22 Requirement — ACL / menu provisioning (DATA CONFIG, run via MCP).
-- Status: NOT RUN anywhere. PROD only with explicit owner approval, after the PO22
--         migrations are applied (main deploy).
-- TX code: PO22 (verified free on PROD 2026-10-16: PO codes in use PO01–PO14,
--          PO16–PO19, PO21, POTMP). The script refuses to run if PO22 is taken.
--
-- Menu: Procurement (GRP_ACL_PROCUREMENT). The brief names "Procurement → MTS
-- Planning → Requirement", but erp_menu.menu_tree holds no nested group under
-- any ACL group today (verified PROD: every child of a group is a PAGE; PO21
-- also sits directly under GRP_ACL_PROCUREMENT). A "MTS Planning" sub-group is
-- therefore NOT created here — that needs the sidebar to support a third level
-- first (owner decision).
--
-- OWNER DECISION 2026-10-20: PO22 full authority = SCM, ACL-MASTER and Director only.
--   PROC_MTS_REQUIREMENT         VIEW  — CAP_MTS_PLAN_FULL only
--   PROC_MTS_REQUIREMENT_POLICY  WRITE — CAP_MTS_PLAN_FULL only (companion, no menu row)
-- CAP_MTS_PLAN_FULL reaches users only through the SUPPLY CHAIN / DIRECTOR / ACL-MASTER
-- work contexts (verified PROD 2026-10-20 for CMP003/CMP005/CMP011; snapshot = role ∩ work
-- context). Stores / Logistics / Plant Head (PO21 add-on capabilities) do NOT get PO22.
-- Reusing the PO21 capabilities keeps the role × work-context grants exactly as
-- the owner set them for PO21 (MTS-CUSTOMER-PLAN-ACL-PROVISIONING.sql) — no new
-- capability, so P0076 (ACL-MASTER) is covered through CAP_MTS_PLAN_FULL.
-- Companies: CMP003, CMP005, CMP011 (owner B14) — already scoped by those grants.
--
-- After this script (same session, same DB):
--   2. NEW acl_versions row per company, then acl.capture_acl_version_source(new_version, company, actor)
--      (re-capturing an already-captured version is a silent no-op — CLAUDE.md §8).
--   3. acl.generate_acl_snapshot(new_version, company) and activate per runbook.
--   4. public.rebuild_acl_menu_snapshot(user, company, work_context) for affected users.
--   5. node scripts/acl-master-drift-check.mjs and the dependency-provisioning-check SQL.

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM erp_menu.menu_master WHERE tx_code = 'PO22' AND menu_code <> 'PROC_MTS_REQUIREMENT') THEN
    RAISE EXCEPTION 'TX code PO22 is already used by another menu in this database.';
  END IF;
END $$;

INSERT INTO erp_menu.menu_master (menu_code, resource_code, title, description, route_path, menu_type, universe, is_system, display_order, is_active, created_by, tx_code)
SELECT 'PROC_MTS_REQUIREMENT', 'PROC_MTS_REQUIREMENT', 'Requirement',
       'MTS Planning: RM/PM Requirement Report and Material Settings (coverage days, MOQ)',
       '/dashboard/procurement/mts-requirement', 'PAGE', 'ACL', false, 22, true, 'MTS_PLANNING_SETUP', 'PO22'
WHERE NOT EXISTS (SELECT 1 FROM erp_menu.menu_master WHERE menu_code = 'PROC_MTS_REQUIREMENT');

-- display_order 21 is already POTMP in PROD (found by the 2026-10-20 dry run): use 22, or the next
-- free slot if 22 is taken too (ux_menu_tree_order is unique per parent).
INSERT INTO erp_menu.menu_tree (parent_menu_id, child_menu_id, display_order)
SELECT p.id, c.id,
       CASE WHEN NOT EXISTS (SELECT 1 FROM erp_menu.menu_tree x WHERE x.parent_menu_id = p.id AND x.display_order = 22)
            THEN 22 ELSE (SELECT max(x.display_order) + 1 FROM erp_menu.menu_tree x WHERE x.parent_menu_id = p.id) END
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

COMMIT;
