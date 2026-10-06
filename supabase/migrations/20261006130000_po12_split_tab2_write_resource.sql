/*
 * File-Path: supabase/migrations/20261006130000_po12_split_tab2_write_resource.sql
 * Domain: PROCUREMENT / PO12 (Plant Transfer Order)
 * Purpose: Tab 1 (CRCP Discrepancy/Settlement, Accounts-only write per the
 *          2026-10-04 lock) and Tab 2 (Transfer/Receive, Logistics write)
 *          were sharing one ACL resource_code (PROC_PLANT_TRANSFER_LIST) for
 *          their WRITE/EDIT actions. Found live 2026-10-06: granting
 *          CAP_PROC_LOGISTICS WRITE+EDIT on that shared resource (needed for
 *          Tab 2's Transfer/Receive) also silently unlocked Tab 1's
 *          Settlement Invoice create/reverse + CRCP Cost Component Entry for
 *          the same Stores/SCM/Logistics users -- exactly CLAUDE.md's bug
 *          pattern #6 ("one resource code reused for two different actions
 *          destroys independent ACL design later").
 *
 * Fix: a new, ACL-only resource PROC_RETURNABLE_TRANSFER (no erp_menu.
 * menu_master row -- same "write-action-only, not a navigable page" shape as
 * the existing PROC_RTV_CREATE, registered by migration 20260708160000)
 * carries Tab 2's WRITE/EDIT authority from now on. VIEW-tier reads for both
 * tabs stay on the shared PROC_PLANT_TRANSFER_LIST (viewing isn't the risk,
 * only write-tier was). Backend: crcp_discrepancy.handlers.ts's
 * canWriteCrcp()/requireCrcpWriteAccess() gained an optional resourceCode
 * param; returnable_transfer.handlers.ts's 3 write call sites (create,
 * receive, settlement-create) now pass "PROC_RETURNABLE_TRANSFER" instead of
 * relying on the default. route-acl-registry.ts's matching 3 route entries
 * updated the same way.
 *
 * Grants mirror exactly who already held write-tier PROC_PLANT_TRANSFER_LIST
 * access in Prod as of today, so nobody's access regresses:
 *   - CAP_PROC_PLANT_TRANSFER (ACL-MASTER's own "full access" capability --
 *     must carry over explicitly, since a brand-new resource_code starts
 *     with zero grants; ACL-MASTER is maintenance-based full access, not a
 *     code-level bypass like SA/GA, per CLAUDE.md).
 *   - CAP_ACC_GRN_COST_PLANTHEAD (role-mapped to L3_MANAGER + DIRECTOR,
 *     business owner's explicit instruction 2026-10-06 that both keep Tab 2
 *     access too, not just Tab 1's).
 *   - CAP_PROC_LOGISTICS (Stores/SCM/Logistics -- the actual Transfer/
 *     Receive doers; this is also the grant being MOVED off
 *     PROC_PLANT_TRANSFER_LIST in the same migration, see below).
 * CAP_ACC_GRN_COST_MAKER (ordinary Accounts clerks) is deliberately NOT
 * carried over -- Tab 1 is their function, Tab 2's physical transfer is not.
 *
 * Also reverts the one Prod-only mistake from earlier today: CAP_PROC_
 * LOGISTICS's WRITE+EDIT grant on PROC_PLANT_TRANSFER_LIST itself (added to
 * unblock Tab 2 before this split existed) is removed, restoring that
 * capability to VIEW-only on Tab 1's own resource, matching the 2026-10-04
 * lock ("Stores and SCM = VIEW only" for Tab 1). Dev never had this grant in
 * the first place (never applied there), so the DELETE is a no-op on Dev and
 * a real revert on Prod -- same migration, applies cleanly to both.
 *
 * Any ACL version active before this migration runs still needs the usual
 * per-company capture_acl_version_source + generate_acl_snapshot bump
 * afterward (CLAUDE.md §8) -- this migration only updates the LIVE
 * capability_menu_actions table, which an already-captured version does not
 * see until re-captured on a fresh version.
 */

BEGIN;

-- ── Register the new ACL-only resource (no erp_menu.menu_master row --
--    write-action gate, not a navigable page; PROC_RTV_CREATE precedent) ────
INSERT INTO acl.menu_master (menu_code, display_name, description, is_system)
VALUES (
  'PROC_RETURNABLE_TRANSFER',
  'Returnable Material Transfer (Write)',
  'PO12 Tab 2 write-tier action gate (create/receive/settle) -- split 2026-10-06 from PROC_PLANT_TRANSFER_LIST so a Logistics grant here never also unlocks Tab 1''s Accounts-only Settlement/Cost-Component actions.',
  false
)
ON CONFLICT (menu_code) DO NOTHING;

-- ── Grant WRITE/EDIT (+VIEW for symmetry) to whoever should drive Tab 2 ─────
INSERT INTO acl.capability_menu_actions (capability_code, menu_id, action, allowed)
SELECT v.cap, am.id, v.action, true
FROM (VALUES
  ('CAP_PROC_PLANT_TRANSFER',    'VIEW'),
  ('CAP_PROC_PLANT_TRANSFER',    'WRITE'),
  ('CAP_PROC_PLANT_TRANSFER',    'EDIT'),

  ('CAP_ACC_GRN_COST_PLANTHEAD', 'VIEW'),
  ('CAP_ACC_GRN_COST_PLANTHEAD', 'WRITE'),
  ('CAP_ACC_GRN_COST_PLANTHEAD', 'EDIT'),

  ('CAP_PROC_LOGISTICS',         'VIEW'),
  ('CAP_PROC_LOGISTICS',         'WRITE'),
  ('CAP_PROC_LOGISTICS',         'EDIT')
) AS v(cap, action)
JOIN acl.menu_master am ON am.menu_code = 'PROC_RETURNABLE_TRANSFER'
ON CONFLICT DO NOTHING;

-- ── Revert the Prod-only interim grant: CAP_PROC_LOGISTICS goes back to
--    VIEW-only on Tab 1's own resource (2026-10-04 lock). No-op on Dev. ─────
DELETE FROM acl.capability_menu_actions cma
USING acl.menu_master mm
WHERE cma.menu_id = mm.id
  AND mm.menu_code = 'PROC_PLANT_TRANSFER_LIST'
  AND cma.capability_code = 'CAP_PROC_LOGISTICS'
  AND cma.action IN ('WRITE', 'EDIT');

COMMIT;
