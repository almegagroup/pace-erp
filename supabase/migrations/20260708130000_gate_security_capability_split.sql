BEGIN;

-- Gate Report menu page (PO18)
INSERT INTO erp_menu.menu_master
  (menu_code, resource_code, title, description, route_path, menu_type, universe,
   is_system, display_order, is_active, tx_code)
VALUES
  ('PROC_GATE_REPORT', 'PROC_GATE_REPORT',
   'Gate Entry Report', 'Line-level gate entry register with GRN and GEX details (ZGATE equivalent)',
   '/dashboard/procurement/gate-report', 'PAGE', 'ACL', true, 3, true, 'PO18')
ON CONFLICT (menu_code) DO NOTHING;

INSERT INTO erp_menu.menu_tree (parent_menu_id, child_menu_id, display_order)
SELECT p.id, c.id, 3
FROM erp_menu.menu_master p, erp_menu.menu_master c
WHERE p.menu_code = 'GRP_ACL_RECEIVING'
  AND c.menu_code = 'PROC_GATE_REPORT'
ON CONFLICT DO NOTHING;

INSERT INTO acl.menu_master (menu_code, display_name)
VALUES ('PROC_GATE_REPORT', 'Gate Entry Report')
ON CONFLICT (menu_code) DO NOTHING;

INSERT INTO acl.capability_menu_actions (capability_code, menu_id, action, allowed)
SELECT 'CAP_PROC_RECEIVING', am.id, v.action, true
FROM (VALUES ('VIEW')) AS v(action)
JOIN acl.menu_master am ON am.menu_code = 'PROC_GATE_REPORT'
ON CONFLICT DO NOTHING;

COMMIT;
