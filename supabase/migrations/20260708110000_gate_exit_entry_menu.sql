/*
 * Migration: 20260708110000_gate_exit_entry_menu
 * Purpose: New standalone "Gate Exit" transaction page (PO17) — Security/Stores
 *          enters a GE number, reviews the readonly header + lines, and records
 *          Exit Date / Exit Time / Tare Weight to close the inbound gate exit.
 *          Uses the existing erp_procurement.gate_exit_inbound table — no
 *          schema change needed. Placed under Receiving group, between
 *          Gate Entries (PO04) and Goods Receipts (PO05).
 */

BEGIN;

-- ── MENU PAGE ────────────────────────────────────────────────────────────────
INSERT INTO erp_menu.menu_master
  (menu_code, resource_code, title, description, route_path, menu_type, universe,
   is_system, display_order, is_active, tx_code)
VALUES
  ('PROC_GATE_EXIT', 'PROC_GATE_EXIT',
   'Gate Exit', 'Record inbound gate exit (Exit Date/Time, Tare Weight) against a Gate Entry number',
   '/dashboard/procurement/gate-exit', 'PAGE', 'ACL', true, 2, true, 'PO17')
ON CONFLICT (menu_code) DO NOTHING;

-- ── MENU TREE (Receiving group → Gate Exit) ───────────────────────────────────
INSERT INTO erp_menu.menu_tree (parent_menu_id, child_menu_id, display_order)
SELECT p.id, c.id, 2
FROM erp_menu.menu_master p, erp_menu.menu_master c
WHERE p.menu_code = 'GRP_ACL_RECEIVING'
  AND c.menu_code = 'PROC_GATE_EXIT'
ON CONFLICT DO NOTHING;

-- ── ACL MENU MASTER MIRROR (resource_code = menu_code rule) ───────────────────
INSERT INTO acl.menu_master (menu_code, display_name)
VALUES ('PROC_GATE_EXIT', 'Gate Exit')
ON CONFLICT (menu_code) DO NOTHING;

-- ── CAPABILITY → MENU ACTIONS ──────────────────────────────────────────────────
-- Same capability that already governs Gate Entry / GRN receiving actions.
INSERT INTO acl.capability_menu_actions (capability_code, menu_id, action, allowed)
SELECT 'CAP_PROC_RECEIVING', am.id, v.action, true
FROM (VALUES ('VIEW'), ('WRITE')) AS v(action)
JOIN acl.menu_master am ON am.menu_code = 'PROC_GATE_EXIT'
ON CONFLICT DO NOTHING;

COMMIT;
