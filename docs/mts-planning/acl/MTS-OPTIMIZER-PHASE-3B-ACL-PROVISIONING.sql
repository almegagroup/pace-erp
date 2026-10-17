-- REVIEW ONLY — NOT RUN in DEV or PROD.
--
-- PO22 Phase 3B has no frontend or API yet. This companion script is the
-- proposed company-level ACL data provisioning needed before a later screen can
-- read immutable optimizer inputs or save the manual, monthly NEW-buy choice.
-- It must be reviewed and run only after migration
-- 20261017085658_erp_planning_mts_optimizer_phase3b.sql is separately approved.
--
-- Proposed access matrix (no menu row and no implied ability to issue stock,
-- create a PO, modify a CSN, or change the current PO22 calculation):
--   CAP_MTS_PLAN_FULL            PROC_MTS_OPTIMIZER_INPUT      VIEW
--   CAP_MTS_PLAN_FULL            PROC_MTS_OPTIMIZER_SELECTION  WRITE
--   CAP_MTS_PLAN_ADDON           PROC_MTS_OPTIMIZER_INPUT      VIEW
--   CAP_MTS_PLAN_ADDON_PLANTHEAD PROC_MTS_OPTIMIZER_INPUT      VIEW
--
-- The same company-scoped PO21 capability grants determine CMP003/CMP005/CMP011
-- scope. The existing CAP_MTS_PLAN_FULL coverage includes ACL-MASTER/P0076;
-- verify it in the target ACL version instead of assuming it.
--
-- Required post-provision sequence for EACH company (new ACL version only):
--   1. create a new acl_versions record;
--   2. acl.capture_acl_version_source(new_version, company, actor);
--   3. confirm the new version-scoped action rows directly;
--   4. acl.generate_acl_snapshot(new_version, company), then activate under
--      the ACL runbook;
--   5. public.rebuild_acl_menu_snapshot(user, company, work_context) for every
--      affected user; run ACL-MASTER drift/dependency checks.
-- `capture_acl_version_source()` is bootstrap-only for a version; never use it
-- to attempt to amend a captured version.

BEGIN;

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
  ('CAP_MTS_PLAN_FULL',            'PROC_MTS_OPTIMIZER_SELECTION', 'WRITE'),
  ('CAP_MTS_PLAN_ADDON',           'PROC_MTS_OPTIMIZER_INPUT',     'VIEW'),
  ('CAP_MTS_PLAN_ADDON_PLANTHEAD', 'PROC_MTS_OPTIMIZER_INPUT',     'VIEW')
) AS v(capability_code, menu_code, action)
JOIN acl.menu_master m ON m.menu_code = v.menu_code
WHERE EXISTS (SELECT 1 FROM acl.capabilities c WHERE c.capability_code = v.capability_code)
  AND NOT EXISTS (
    SELECT 1 FROM acl.capability_menu_actions existing
    WHERE existing.capability_code = v.capability_code
      AND existing.menu_id = m.id
      AND existing.action = v.action
  );

COMMIT;
