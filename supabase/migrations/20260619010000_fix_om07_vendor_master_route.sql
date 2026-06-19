-- Fix OM07: route_path updated to new SA Vendor Master page.

UPDATE erp_menu.menu_master
SET
  route_path = '/sa/om/vendors',
  title      = 'Vendor Master'
WHERE tx_code = 'OM07';
