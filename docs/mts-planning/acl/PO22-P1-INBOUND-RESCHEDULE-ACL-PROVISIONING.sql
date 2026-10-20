-- PO22 P1 — companion resource for the planning-side rescheduled ETA (owner 2026-10-20).
--
-- Resource (route-acl-registry.ts):
--   PROC_MTS_INBOUND_RESCHEDULE  companion (acl.menu_master only, no menu row):
--                                WRITE → POST /api/procurement/mts-requirement/inbound-reschedule
--   A separate resource because it is a different action from Material Settings (bug pattern #6).
--
-- Who: CAP_MTS_PLAN_FULL only = SUPPLY CHAIN / DIRECTOR / ACL-MASTER work contexts (PO22 full
-- authority, owner 2026-10-20). Viewing the Item Plan uses PROC_MTS_REQUIREMENT:VIEW (no change).
--
-- NOT EXECUTED. Run only with the owner's explicit approval, in one transaction, then:
--   1. new acl_versions row per company (CMP003 / CMP005 / CMP011) +
--      acl.capture_acl_version_source(new_version, company, actor)
--      (re-capturing an already-captured version is a silent no-op — CLAUDE.md §8)
--   2. acl.generate_acl_snapshot(new_version, company) and activate per runbook
--   3. public.rebuild_acl_menu_snapshot(...) for affected users
--   4. node scripts/acl-master-drift-check.mjs → P0076 (ACL-MASTER) covers the new resource

BEGIN;

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

COMMIT;
