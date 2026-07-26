/*
 * Migration: 20260708160000_register_missing_create_resources
 * Purpose: Same class of bug as PROC_PO_CREATE (20260708150001) — a systemic
 *          audit of every resourceCode in route-acl-registry.ts against
 *          acl.menu_master found 6 more companion "*_CREATE" resources that
 *          were referenced by routes but never registered, meaning create/
 *          edit/delete/approve on all of these has been DENY-ALL for every
 *          non-SA/GA user:
 *            OM_CUSTOMER_CREATE, OM_MATERIAL_CREATE, PROC_IV_CREATE,
 *            PROC_RTV_CREATE, PROC_SO_CREATE, PROC_STO_CREATE
 *          Grants go to whichever capability already owns the sibling
 *          "*_LIST" resource (found by inspecting live capability_menu_actions).
 *
 *          Also: SA_OPENING_STOCK_LIST was renamed to PROC_OPENING_STOCK_LIST
 *          by migration 20260619000001 (Gate-19 amendment, SA -> ACL universe)
 *          but only ever got VIEW + WRITE grants — EDIT/DELETE/APPROVE were
 *          never added even though route-acl-registry.ts references them
 *          (registry itself was also still pointing at the old SA_ name,
 *          fixed separately in code). Backfilling the missing actions here.
 */

BEGIN;

-- ── REGISTER MISSING COMPANION RESOURCES ──────────────────────────────────────
INSERT INTO acl.menu_master (menu_code, display_name)
VALUES
  ('OM_CUSTOMER_CREATE', 'Customer Create'),
  ('OM_MATERIAL_CREATE', 'Material Create'),
  ('PROC_IV_CREATE',     'Invoice Verification Create'),
  ('PROC_RTV_CREATE',    'Return to Vendor Create'),
  ('PROC_SO_CREATE',     'Sales Order Create'),
  ('PROC_STO_CREATE',    'Stock Transfer Order Create')
ON CONFLICT (menu_code) DO NOTHING;

-- ── GRANT TO THE CAPABILITY THAT ALREADY OWNS THE SIBLING *_LIST RESOURCE ─────
INSERT INTO acl.capability_menu_actions (capability_code, menu_id, action, allowed)
SELECT v.cap, am.id, v.action, true
FROM (VALUES
  ('CAP_OM_MASTER_DATA', 'OM_CUSTOMER_CREATE', 'VIEW'),
  ('CAP_OM_MASTER_DATA', 'OM_CUSTOMER_CREATE', 'WRITE'),
  ('CAP_OM_MASTER_DATA', 'OM_CUSTOMER_CREATE', 'EDIT'),

  ('CAP_OM_MASTER_DATA', 'OM_MATERIAL_CREATE', 'VIEW'),
  ('CAP_OM_MASTER_DATA', 'OM_MATERIAL_CREATE', 'WRITE'),
  ('CAP_OM_MASTER_DATA', 'OM_MATERIAL_CREATE', 'EDIT'),

  ('CAP_PROC_ACCOUNTS', 'PROC_IV_CREATE', 'VIEW'),
  ('CAP_PROC_ACCOUNTS', 'PROC_IV_CREATE', 'WRITE'),
  ('CAP_PROC_ACCOUNTS', 'PROC_IV_CREATE', 'EDIT'),
  ('CAP_PROC_ACCOUNTS', 'PROC_IV_CREATE', 'DELETE'),
  ('CAP_PROC_ACCOUNTS', 'PROC_IV_CREATE', 'APPROVE'),

  ('CAP_PROC_RETURNS', 'PROC_RTV_CREATE', 'VIEW'),
  ('CAP_PROC_RETURNS', 'PROC_RTV_CREATE', 'WRITE'),
  ('CAP_PROC_RETURNS', 'PROC_RTV_CREATE', 'EDIT'),
  ('CAP_PROC_RETURNS', 'PROC_RTV_CREATE', 'APPROVE'),

  ('CAP_PROC_SALES', 'PROC_SO_CREATE', 'VIEW'),
  ('CAP_PROC_SALES', 'PROC_SO_CREATE', 'WRITE'),
  ('CAP_PROC_SALES', 'PROC_SO_CREATE', 'EDIT'),

  ('CAP_PROC_LOGISTICS', 'PROC_STO_CREATE', 'VIEW'),
  ('CAP_PROC_LOGISTICS', 'PROC_STO_CREATE', 'WRITE'),
  ('CAP_PROC_LOGISTICS', 'PROC_STO_CREATE', 'EDIT'),
  ('CAP_PROC_LOGISTICS', 'PROC_STO_CREATE', 'APPROVE')
) AS v(cap, menu_code, action)
JOIN acl.menu_master am ON am.menu_code = v.menu_code
ON CONFLICT DO NOTHING;

-- ── OPENING STOCK: BACKFILL MISSING ACTIONS (VIEW/WRITE already existed) ──────
INSERT INTO acl.capability_menu_actions (capability_code, menu_id, action, allowed)
SELECT 'CAP_PROC_INVENTORY', am.id, v.action, true
FROM (VALUES ('EDIT'), ('DELETE'), ('APPROVE')) AS v(action)
JOIN acl.menu_master am ON am.menu_code = 'PROC_OPENING_STOCK_LIST'
ON CONFLICT DO NOTHING;

COMMIT;
