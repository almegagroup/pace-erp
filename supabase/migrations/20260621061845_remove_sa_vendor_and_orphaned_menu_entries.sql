-- Remove SA Vendor Create sidebar entry and orphaned companion pages.
-- OM_VENDOR_CREATE removed: vendor master moved to SA_VENDOR_MASTER flow.
-- OM_MATERIAL_DETAIL_SA and OM_VENDOR_DETAIL_SA removed: orphaned companion pages.

DELETE FROM erp_menu.menu_tree
WHERE child_menu_id IN (
  SELECT id FROM erp_menu.menu_master
  WHERE menu_code IN ('OM_VENDOR_CREATE', 'OM_MATERIAL_DETAIL_SA', 'OM_VENDOR_DETAIL_SA')
);

DELETE FROM erp_menu.menu_master
WHERE menu_code IN ('OM_VENDOR_CREATE', 'OM_MATERIAL_DETAIL_SA', 'OM_VENDOR_DETAIL_SA');
