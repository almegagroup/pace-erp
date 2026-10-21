-- PO22 P4 — companion resource for the user's plan edits (owner 2026-10-20).
--
-- Resource (route-acl-registry.ts):
--   PROC_MTS_ITEM_PLAN_EDIT  companion (acl.menu_master only, no menu row):
--                            WRITE → POST /api/procurement/mts-requirement/item-plan/scenario
--   Separate from reschedule / Material Settings (different action — bug pattern #6).
-- Who: CAP_MTS_PLAN_FULL only = SUPPLY CHAIN / DIRECTOR / ACL-MASTER (PO22 full authority).
-- AI review uses PROC_MTS_REQUIREMENT:VIEW (budget-capped), no new grant.
--
-- NOT EXECUTED. Run only with the owner's explicit approval, inside the same one-transaction
-- pattern as docs/mts-planning/acl/PO22-P1-PROD-ACL-ROLLOUT.sql (new ACL version per company,
-- capture, snapshot, activate, menu rebuild, verification).

INSERT INTO acl.menu_master (menu_code, display_name, description, is_system)
SELECT 'PROC_MTS_ITEM_PLAN_EDIT', 'MTS Planning — Edit item plan',
       'Fix / change lots in the Engine + AI item plan (planning only, versioned; companion resource, no menu row)', true
WHERE NOT EXISTS (SELECT 1 FROM acl.menu_master m WHERE m.menu_code = 'PROC_MTS_ITEM_PLAN_EDIT');

INSERT INTO acl.capability_menu_actions (capability_code, menu_id, action, allowed, menu_visible)
SELECT 'CAP_MTS_PLAN_FULL', m.id, 'WRITE', true, false
FROM acl.menu_master m
WHERE m.menu_code = 'PROC_MTS_ITEM_PLAN_EDIT'
  AND NOT EXISTS (
    SELECT 1 FROM acl.capability_menu_actions x
    WHERE x.capability_code = 'CAP_MTS_PLAN_FULL' AND x.menu_id = m.id AND x.action = 'WRITE'
  );
