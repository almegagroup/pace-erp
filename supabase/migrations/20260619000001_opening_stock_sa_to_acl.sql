-- Gate-19 Amendment: Move Opening Stock from SA universe to ACL universe.
-- Opening Stock should be accessible to managers (assertManagerOrSARole), not SA-only.
-- Capability: CAP_PROC_INVENTORY (same as PI_LIST, STOCK_LEDGER, STOCK_VALUATION)
-- tx_code: IN05 (next in IN series after IN04 = PROC_STOCK_VALUATION)
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

-- Companion detail page (no tx_code — companion screens are route-only)
INSERT INTO erp_menu.menu_master (
  menu_code, resource_code, title, description,
  route_path, menu_type, universe, is_system,
  display_order, is_active, tx_code
) VALUES (
  'PROC_OPENING_STOCK_DETAIL',
  'PROC_OPENING_STOCK_DETAIL',
  'Opening Stock Detail',
  'Opening stock document detail and posting workflow.',
  '/dashboard/procurement/opening-stock/:id',
  'PAGE',
  'ACL',
  true,
  0,
  true,
  null
)
ON CONFLICT (menu_code) DO NOTHING;

-- ─── 2. Insert into acl.menu_master ──────────────────────────────────────────
INSERT INTO acl.menu_master (menu_code, display_name, description, is_system)
VALUES
  ('PROC_OPENING_STOCK_LIST',   'Opening Stock',        'Opening stock migration document list.',  true),
  ('PROC_OPENING_STOCK_DETAIL', 'Opening Stock Detail', 'Opening stock document detail and post.', true)
ON CONFLICT (menu_code) DO NOTHING;

-- ─── 3. Add capability_menu_actions ─────────────────────────────────────────
-- CAP_PROC_INVENTORY VIEW + WRITE for both screens
INSERT INTO acl.capability_menu_actions (capability_code, menu_id, action, allowed)
SELECT 'CAP_PROC_INVENTORY', am.id, 'VIEW', true
FROM acl.menu_master am
WHERE am.menu_code IN ('PROC_OPENING_STOCK_LIST', 'PROC_OPENING_STOCK_DETAIL')
ON CONFLICT DO NOTHING;

INSERT INTO acl.capability_menu_actions (capability_code, menu_id, action, allowed)
SELECT 'CAP_PROC_INVENTORY', am.id, 'WRITE', true
FROM acl.menu_master am
WHERE am.menu_code IN ('PROC_OPENING_STOCK_LIST', 'PROC_OPENING_STOCK_DETAIL')
ON CONFLICT DO NOTHING;
