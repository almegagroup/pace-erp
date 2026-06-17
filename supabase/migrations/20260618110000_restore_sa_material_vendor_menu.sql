-- Restore Material Create and Vendor Create to SA Operation Masters menu.
-- Also register SA-universe detail page routes (companion pages, no sidebar entry).
-- Detail pages are needed so SA users can do company/plant mapping after creating.

-- ── Step 1: menu_master entries ───────────────────────────────────────────────
INSERT INTO erp_menu.menu_master
  (menu_code, resource_code, title, route_path, menu_type, universe, display_order, tx_code, is_system)
VALUES
  -- Sidebar items (will appear in SA Operation Masters)
  ('OM_MATERIAL_CREATE', 'OM_MATERIAL_CREATE', 'New Material',
   '/sa/om/material/create', 'PAGE', 'SA', 40, 'OM04', false),
  ('OM_VENDOR_CREATE', 'OM_VENDOR_CREATE', 'New Vendor',
   '/sa/om/vendor/create', 'PAGE', 'SA', 70, 'OM07', false),
  -- Companion pages (no sidebar, accessed programmatically after create)
  ('OM_MATERIAL_DETAIL_SA', 'OM_MATERIAL_DETAIL_SA', 'Material Detail',
   '/sa/om/material/detail', 'PAGE', 'SA', 0, null, false),
  ('OM_VENDOR_DETAIL_SA', 'OM_VENDOR_DETAIL_SA', 'Vendor Detail',
   '/sa/om/vendor/detail', 'PAGE', 'SA', 0, null, false);

-- ── Step 2: Add sidebar items to menu_tree under GRP_SA_OM ───────────────────
-- Companion detail pages intentionally NOT added to menu_tree (not in sidebar)
INSERT INTO erp_menu.menu_tree (parent_menu_id, child_menu_id, display_order)
SELECT
  (SELECT id FROM erp_menu.menu_master WHERE menu_code = 'GRP_SA_OM'),
  id,
  CASE menu_code
    WHEN 'OM_MATERIAL_CREATE' THEN 40
    WHEN 'OM_VENDOR_CREATE'   THEN 70
  END
FROM erp_menu.menu_master
WHERE menu_code IN ('OM_MATERIAL_CREATE', 'OM_VENDOR_CREATE');
