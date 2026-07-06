-- Fix OM04: route_path was /sa/om/material/create (old single-create page).
-- Material Master redesign replaced it with /sa/om/materials (new SAP-style grid).

UPDATE erp_menu.menu_master
SET
  route_path = '/sa/om/materials',
  title      = 'Material Master'
WHERE tx_code = 'OM04';
