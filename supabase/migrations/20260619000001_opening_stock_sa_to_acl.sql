-- Gate-19 Amendment: Move Opening Stock from SA universe to ACL universe.
-- Opening Stock should be accessible to managers (assertManagerOrSARole), not SA-only.
-- Capability: CAP_PROC_INVENTORY (same as PI_LIST, STOCK_LEDGER, STOCK_VALUATION)
-- tx_code: IN05 (next in IN series after IN04 = PROC_STOCK_VALUATION)
--
-- Companion detail page (PROC_OPENING_STOCK_DETAIL) is NOT registered in acl.menu_master.
-- It is a route-only companion — authorization comes from routeIndex.js companionRoutePairs.
--
-- NOTE: After running this migration on any environment, the SA must go to the
-- ACL admin panel and regenerate ACL snapshots so the new menu items are
-- picked up in user sessions.

-- ─── 1. Update erp_menu.menu_master ─────────────────────────────────────────
UPDATE erp_menu.menu_master
SET
  menu_code     = 'PROC_OPENING_STOCK_LIST',
  resource_code = 'PROC_OPENING_STOCK_LIST',
  universe      = 'ACL',
  tx_code       = 'IN05',
  route_path    = '/dashboard/procurement/opening-stock',
  updated_at    = now()
WHERE menu_code = 'SA_OPENING_STOCK_LIST';

-- Move tree parent: GRP_SA_INVENTORY → GRP_ACL_INVENTORY (display_order 5, after Physical Inventory)
UPDATE erp_menu.menu_tree
SET
  parent_menu_id = (SELECT id FROM erp_menu.menu_master WHERE menu_code = 'GRP_ACL_INVENTORY'),
  display_order  = 5
WHERE child_menu_id = (SELECT id FROM erp_menu.menu_master WHERE menu_code = 'PROC_OPENING_STOCK_LIST');

-- ─── 2. Insert into acl.menu_master (list page only) ─────────────────────────
INSERT INTO acl.menu_master (menu_code, display_name, description, is_system)
VALUES
  ('PROC_OPENING_STOCK_LIST', 'Opening Stock', 'Opening stock migration document list.', true)
ON CONFLICT (menu_code) DO NOTHING;

-- ─── 3. Ensure capability exists (was added via MCP on dev, needs to be idempotent for prod) ──
INSERT INTO acl.capabilities (capability_code, capability_name, description, is_system)
VALUES ('CAP_PROC_INVENTORY', 'Inventory & Reports', 'Stock reports and physical inventory', false)
ON CONFLICT (capability_code) DO NOTHING;

-- ─── 4. Add capability_menu_actions (list page only) ─────────────────────────
INSERT INTO acl.capability_menu_actions (capability_code, menu_id, action, allowed)
SELECT 'CAP_PROC_INVENTORY', am.id, 'VIEW', true
FROM acl.menu_master am WHERE am.menu_code = 'PROC_OPENING_STOCK_LIST'
ON CONFLICT DO NOTHING;

INSERT INTO acl.capability_menu_actions (capability_code, menu_id, action, allowed)
SELECT 'CAP_PROC_INVENTORY', am.id, 'WRITE', true
FROM acl.menu_master am WHERE am.menu_code = 'PROC_OPENING_STOCK_LIST'
ON CONFLICT DO NOTHING;
