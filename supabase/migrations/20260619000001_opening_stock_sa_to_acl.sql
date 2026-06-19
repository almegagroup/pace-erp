-- Gate-19 Amendment: Move Opening Stock from SA universe to ACL universe
-- Opening Stock should be accessible to managers (assertManagerOrSARole), not SA-only.
-- Capability: CAP_PROC_INVENTORY (same as PI_LIST, STOCK_LEDGER, STOCK_VALUATION)
-- tx_code: IN05 (next in IN series after IN04 = PROC_STOCK_VALUATION)

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

-- Companion detail page (no tx_code, companion screens are route-only)
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

-- ─── 2. Update / insert acl.menu_master ──────────────────────────────────────
-- SA_OPENING_STOCK_LIST was not in acl.menu_master (it was SA universe).
-- Insert both list + detail.
INSERT INTO acl.menu_master (menu_code, display_name, description, is_system)
VALUES
  ('PROC_OPENING_STOCK_LIST',   'Opening Stock',        'Opening stock migration document list.',   true),
  ('PROC_OPENING_STOCK_DETAIL', 'Opening Stock Detail', 'Opening stock document detail and post.',  true)
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

-- ─── 4. Backfill version_capability_menu_actions ─────────────────────────────
-- capture_acl_version_source is a one-time operation (guards on source_captured_at IS NULL).
-- For already-captured versions, we must INSERT directly into version_capability_menu_actions.
INSERT INTO acl.version_capability_menu_actions (acl_version_id, capability_code, menu_id, action, allowed)
SELECT
  av.acl_version_id,
  cma.capability_code,
  cma.menu_id,
  cma.action,
  cma.allowed
FROM acl.acl_versions av
CROSS JOIN acl.capability_menu_actions cma
JOIN acl.menu_master am ON am.id = cma.menu_id
WHERE av.is_active = true
  AND am.menu_code IN ('PROC_OPENING_STOCK_LIST', 'PROC_OPENING_STOCK_DETAIL')
ON CONFLICT DO NOTHING;

-- ─── 5. Rebuild precomputed_acl_view for all companies ───────────────────────
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT acl_version_id, company_id FROM acl.acl_versions WHERE is_active = true
  LOOP
    BEGIN
      PERFORM acl.generate_acl_snapshot(r.acl_version_id, r.company_id);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;
END $$;

-- ─── 6. Rebuild menu snapshots for all snapshot users ────────────────────────
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT DISTINCT user_id, company_id, universe, work_context_id
    FROM erp_menu.menu_snapshot
  LOOP
    BEGIN
      IF r.universe = 'SA' THEN
        PERFORM public.rebuild_sa_menu_snapshot(r.user_id);
      ELSE
        PERFORM public.rebuild_acl_menu_snapshot(r.user_id, r.company_id, r.work_context_id);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;
END $$;
