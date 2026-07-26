/*
 * Migration: 20260712193000_gate19_2_opening_stock_redesign
 * Gate: 19.2
 * Purpose: Add opening stock document currency_code and register IN06 Opening Stock Approval.
 */

BEGIN;

ALTER TABLE erp_procurement.opening_stock_document
ADD COLUMN IF NOT EXISTS currency_code TEXT NOT NULL DEFAULT 'INR';

UPDATE erp_procurement.opening_stock_document
SET currency_code = 'INR'
WHERE currency_code IS NULL OR btrim(currency_code) = '';

INSERT INTO erp_menu.menu_master
  (menu_code, resource_code, title, description, route_path, menu_type, universe,
   is_system, display_order, is_active, tx_code)
VALUES
  ('PROC_OPENING_STOCK_APPROVAL',
   'PROC_OPENING_STOCK_APPROVAL',
   'Opening Stock Approval',
   'Review, correct, approve, and post submitted opening stock documents.',
   '/dashboard/procurement/opening-stock/approval',
   'PAGE', 'ACL', false, 6, true, 'IN06')
ON CONFLICT (menu_code) DO UPDATE
SET
  resource_code = EXCLUDED.resource_code,
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  route_path = EXCLUDED.route_path,
  menu_type = EXCLUDED.menu_type,
  universe = EXCLUDED.universe,
  is_system = EXCLUDED.is_system,
  display_order = EXCLUDED.display_order,
  is_active = EXCLUDED.is_active,
  tx_code = EXCLUDED.tx_code,
  updated_at = now();

INSERT INTO erp_menu.menu_tree (parent_menu_id, child_menu_id, display_order)
SELECT
  parent_menu.id,
  child_menu.id,
  6
FROM erp_menu.menu_master parent_menu
JOIN erp_menu.menu_master child_menu
  ON child_menu.menu_code = 'PROC_OPENING_STOCK_APPROVAL'
WHERE parent_menu.menu_code = 'GRP_ACL_INVENTORY'
ON CONFLICT (child_menu_id) DO UPDATE
SET
  parent_menu_id = EXCLUDED.parent_menu_id,
  display_order = EXCLUDED.display_order;

INSERT INTO acl.menu_master (menu_code, display_name, description, is_system)
VALUES
  ('PROC_OPENING_STOCK_APPROVAL', 'Opening Stock Approval', 'Submitted opening stock approval and correction screen.', true)
ON CONFLICT (menu_code) DO UPDATE
SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  is_system = EXCLUDED.is_system;

INSERT INTO acl.capability_menu_actions (capability_code, menu_id, action, allowed)
SELECT 'CAP_PROC_INVENTORY', am.id, action_name, true
FROM acl.menu_master am
CROSS JOIN (VALUES ('VIEW'), ('EDIT'), ('APPROVE')) AS actions(action_name)
WHERE am.menu_code = 'PROC_OPENING_STOCK_APPROVAL'
ON CONFLICT DO NOTHING;

COMMIT;
