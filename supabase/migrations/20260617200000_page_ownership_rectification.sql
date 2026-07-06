-- Migration: Page ownership rectification
-- 1. Remove SA-universe duplicate masters (OM04, OM07-OM12) from erp_menu.menu_master
-- 2. Merge PM05+PM06 (Import+Domestic Lead Times) into single PM05, renumber PM06/PM07
-- 3. Move Material Create and Vendor Create to SA universe
-- 4. Update acl.menu_master: remove PROC_DOMESTIC_LEAD_TIME_MASTER

-- ── Step 1: Remove SA duplicate masters ────────────────────────────────────────
DELETE FROM erp_menu.menu_master
WHERE menu_code IN (
  'SA_PAYMENT_TERMS',
  'SA_PORT_MASTER',
  'SA_PORT_TRANSIT',
  'SA_LEAD_TIMES',
  'SA_TRANSPORTERS',
  'SA_CHA_MASTER',
  'SA_OM_MCG'
);

-- ── Step 2: Merge Lead Times — update PM05 to combined page, delete PM06 ──────
UPDATE erp_menu.menu_master
SET
  title        = 'Lead Times',
  route_path   = '/dashboard/procurement/masters/lead-times',
  tx_code      = 'PM05',
  updated_at   = now()
WHERE menu_code = 'PROC_IMPORT_LEAD_TIME_MASTER';

DELETE FROM erp_menu.menu_master WHERE menu_code = 'PROC_DOMESTIC_LEAD_TIME_MASTER';

-- Renumber Transporters PM07 → PM06, CHA PM08 → PM07
UPDATE erp_menu.menu_master SET tx_code = 'PM06', updated_at = now()
WHERE menu_code = 'PROC_TRANSPORTER_MASTER';

UPDATE erp_menu.menu_master SET tx_code = 'PM07', updated_at = now()
WHERE menu_code = 'PROC_CHA_MASTER';

-- ── Step 3: Move Material Create and Vendor Create to SA universe ──────────────
UPDATE erp_menu.menu_master
SET
  universe     = 'SA',
  route_path   = '/sa/om/material/create',
  updated_at   = now()
WHERE menu_code = 'OM_MATERIAL_CREATE';

UPDATE erp_menu.menu_master
SET
  universe     = 'SA',
  route_path   = '/sa/om/vendor/create',
  updated_at   = now()
WHERE menu_code = 'OM_VENDOR_CREATE';

-- ── Step 4: acl.menu_master — remove PROC_DOMESTIC_LEAD_TIME_MASTER ───────────
DELETE FROM acl.menu_master WHERE menu_code = 'PROC_DOMESTIC_LEAD_TIME_MASTER';
