-- Cleanup: remove companion create pages from menu registries
-- OM_MATERIAL_CREATE and OM_VENDOR_CREATE are SA-only companion pages
-- accessed via button in MaterialListPage/VendorListPage, not sidebar items.
-- They have no parent in menu_tree so never appeared in sidebar.
-- Removing them from both menu schemas for consistency.

DELETE FROM acl.menu_master
WHERE menu_code IN ('OM_MATERIAL_CREATE', 'OM_VENDOR_CREATE');

DELETE FROM erp_menu.menu_master
WHERE menu_code IN ('OM_MATERIAL_CREATE', 'OM_VENDOR_CREATE');
