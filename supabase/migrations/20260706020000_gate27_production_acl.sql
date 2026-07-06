/*
 * Migration: 20260706020000_gate27_production_acl
 * Gate: 27
 * Purpose: ACL capabilities, menu entries, and capability_menu_actions for
 *          the production domain. Seeds pack_code_master with the 4 fixed codes.
 */

BEGIN;

-- ── SEED PACK CODE MASTER (4 fixed codes) ────────────────────────────────────
INSERT INTO erp_production.pack_code_master
  (pack_code, pack_name, pack_type, billing_uom, active)
VALUES
  ('599', 'Barrel (600 KG)',  'BARREL',  'PER_UNIT', true),
  ('510', 'IBC (1000 KG)',    'IBC',     'PER_KG',   true),
  ('000', 'Tanker',           'TANKER',  'PER_KG',   true),
  ('001', 'MTEST (5-10 KG)', 'MTEST',   'PER_UNIT',  true)
ON CONFLICT (pack_code) DO NOTHING;

-- ── NEW ACL CAPABILITIES ─────────────────────────────────────────────────────
INSERT INTO acl.capabilities (capability_code, capability_name, description, is_system)
VALUES
  ('CAP_PROD_OPERATOR', 'Production Operator',
   'Access to production transaction screens: Process Orders, Packing Orders, Plan Feed, Stroke Master, Prodshade Pack Config, Order Overview.',
   false),
  ('CAP_PROD_PLANNER', 'Production Planner',
   'Access to Plan Feed (Factory Orders) management only.',
   false)
ON CONFLICT (capability_code) DO NOTHING;

-- ── PRODUCTION MENU GROUP ────────────────────────────────────────────────────
-- ACL universe group — display_order 95 (after Inventory=90, before HR=110)
INSERT INTO erp_menu.menu_master
  (menu_code, resource_code, title, description, route_path, menu_type, universe,
   is_system, display_order, is_active, tx_code)
VALUES
  ('GRP_ACL_PRODUCTION', 'GRP_ACL_PRODUCTION',
   'Production', 'L3 Production — Process Orders, Packing Orders, Plan Feed',
   NULL, 'GROUP', 'ACL', false, 95, true, NULL)
ON CONFLICT (menu_code) DO NOTHING;

-- ── PRODUCTION PAGES ─────────────────────────────────────────────────────────
INSERT INTO erp_menu.menu_master
  (menu_code, resource_code, title, description, route_path, menu_type, universe,
   is_system, display_order, is_active, tx_code)
VALUES
  ('PROD_PLAN_FEED',
   'PROD_PLAN_FEED',
   'Plan Feed',
   'Factory Order (FO) management — create, edit, cancel, and track dispatch',
   '/dashboard/production/plan-feed',
   'PAGE', 'ACL', false, 10, true, 'PR00'),

  ('PROD_STROKE_MASTER',
   'PROD_STROKE_MASTER',
   'Stroke Master',
   'BOM / formulation master — Prodshade + Stroke Number + RM dosage lines',
   '/dashboard/production/stroke-master',
   'PAGE', 'ACL', false, 20, true, 'PR01'),

  ('PROD_PACK_CONFIG',
   'PROD_PACK_CONFIG',
   'Prodshade Pack Config',
   'Configure allowed pack codes and fill qty per company + prodshade',
   '/dashboard/production/pack-config',
   'PAGE', 'ACL', false, 30, true, 'PR03'),

  ('PROD_PROCESS_ORDER',
   'PROD_PROCESS_ORDER',
   'Process Orders',
   'L3 Process Orders — MTO/HPS/MTS/INT/MTEST lifecycle',
   '/dashboard/production/process-orders',
   'PAGE', 'ACL', false, 40, true, 'PR10'),

  ('PROD_PACKING_ORDER',
   'PROD_PACKING_ORDER',
   'Packing Orders',
   'Packing Orders — PMTO/PHPS/PMTS/PTEST Standard and Final',
   '/dashboard/production/packing-orders',
   'PAGE', 'ACL', false, 50, true, 'PR09'),

  ('PROD_ORDER_OVERVIEW',
   'PROD_ORDER_OVERVIEW',
   'Order Overview',
   'COID — linked Process + Packing order summary view',
   '/dashboard/production/order-overview',
   'PAGE', 'ACL', false, 60, true, 'PR13')
ON CONFLICT (menu_code) DO NOTHING;

-- ── MENU TREE (group → pages) ─────────────────────────────────────────────────
INSERT INTO erp_menu.menu_tree (parent_menu_id, child_menu_id, display_order)
SELECT
  p.id AS parent_menu_id,
  c.id AS child_menu_id,
  v.display_order
FROM (VALUES
  ('PROD_PLAN_FEED',     10),
  ('PROD_STROKE_MASTER', 20),
  ('PROD_PACK_CONFIG',   30),
  ('PROD_PROCESS_ORDER', 40),
  ('PROD_PACKING_ORDER', 50),
  ('PROD_ORDER_OVERVIEW',60)
) AS v(child_code, display_order)
JOIN erp_menu.menu_master p ON p.menu_code = 'GRP_ACL_PRODUCTION'
JOIN erp_menu.menu_master c ON c.menu_code = v.child_code
ON CONFLICT DO NOTHING;

-- ── ACL MENU MASTER (mirrors erp_menu, resource_code = menu_code rule) ────────
INSERT INTO acl.menu_master (menu_code, display_name)
VALUES
  ('GRP_ACL_PRODUCTION',  'Production'),
  ('PROD_PLAN_FEED',      'Plan Feed'),
  ('PROD_STROKE_MASTER',  'Stroke Master'),
  ('PROD_PACK_CONFIG',    'Prodshade Pack Config'),
  ('PROD_PROCESS_ORDER',  'Process Orders'),
  ('PROD_PACKING_ORDER',  'Packing Orders'),
  ('PROD_ORDER_OVERVIEW', 'Order Overview')
ON CONFLICT (menu_code) DO NOTHING;

-- ── CAPABILITY → MENU ACTIONS ─────────────────────────────────────────────────
-- CAP_PROD_OPERATOR: full access to all production screens
INSERT INTO acl.capability_menu_actions (capability_code, menu_id, action, allowed)
SELECT
  v.cap_code,
  am.id,
  v.action,
  true
FROM (VALUES
  ('CAP_PROD_OPERATOR', 'PROD_PLAN_FEED',      'VIEW'),
  ('CAP_PROD_OPERATOR', 'PROD_PLAN_FEED',      'WRITE'),
  ('CAP_PROD_OPERATOR', 'PROD_PLAN_FEED',      'EDIT'),
  ('CAP_PROD_OPERATOR', 'PROD_STROKE_MASTER',  'VIEW'),
  ('CAP_PROD_OPERATOR', 'PROD_STROKE_MASTER',  'WRITE'),
  ('CAP_PROD_OPERATOR', 'PROD_STROKE_MASTER',  'EDIT'),
  ('CAP_PROD_OPERATOR', 'PROD_STROKE_MASTER',  'APPROVE'),
  ('CAP_PROD_OPERATOR', 'PROD_PACK_CONFIG',    'VIEW'),
  ('CAP_PROD_OPERATOR', 'PROD_PACK_CONFIG',    'WRITE'),
  ('CAP_PROD_OPERATOR', 'PROD_PACK_CONFIG',    'EDIT'),
  ('CAP_PROD_OPERATOR', 'PROD_PROCESS_ORDER',  'VIEW'),
  ('CAP_PROD_OPERATOR', 'PROD_PROCESS_ORDER',  'WRITE'),
  ('CAP_PROD_OPERATOR', 'PROD_PROCESS_ORDER',  'EDIT'),
  ('CAP_PROD_OPERATOR', 'PROD_PROCESS_ORDER',  'APPROVE'),
  ('CAP_PROD_OPERATOR', 'PROD_PACKING_ORDER',  'VIEW'),
  ('CAP_PROD_OPERATOR', 'PROD_PACKING_ORDER',  'WRITE'),
  ('CAP_PROD_OPERATOR', 'PROD_PACKING_ORDER',  'EDIT'),
  ('CAP_PROD_OPERATOR', 'PROD_ORDER_OVERVIEW', 'VIEW')
) AS v(cap_code, menu_code, action)
JOIN acl.menu_master am ON am.menu_code = v.menu_code
ON CONFLICT DO NOTHING;

-- CAP_PROD_PLANNER: Plan Feed access only
INSERT INTO acl.capability_menu_actions (capability_code, menu_id, action, allowed)
SELECT
  v.cap_code,
  am.id,
  v.action,
  true
FROM (VALUES
  ('CAP_PROD_PLANNER', 'PROD_PLAN_FEED',      'VIEW'),
  ('CAP_PROD_PLANNER', 'PROD_PLAN_FEED',      'WRITE'),
  ('CAP_PROD_PLANNER', 'PROD_PLAN_FEED',      'EDIT'),
  ('CAP_PROD_PLANNER', 'PROD_ORDER_OVERVIEW', 'VIEW')
) AS v(cap_code, menu_code, action)
JOIN acl.menu_master am ON am.menu_code = v.menu_code
ON CONFLICT DO NOTHING;

COMMIT;
