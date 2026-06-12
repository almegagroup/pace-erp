-- Migration: 20260612120000_expand_storage_location_types
-- Purpose: Expand location_type CHECK constraint to include semantic subtypes
-- (WAREHOUSE, SHOP_FLOOR, SCRAP, EXTERNAL) in addition to PHYSICAL/LOGICAL/TRANSIT.
-- Previously all were normalised to PHYSICAL/LOGICAL/TRANSIT, losing the distinction.

ALTER TABLE erp_inventory.storage_location_master
  DROP CONSTRAINT IF EXISTS storage_location_master_location_type_check;

ALTER TABLE erp_inventory.storage_location_master
  ADD CONSTRAINT storage_location_master_location_type_check
  CHECK (location_type IN (
    'PHYSICAL',
    'LOGICAL',
    'TRANSIT',
    'WAREHOUSE',
    'SHOP_FLOOR',
    'SCRAP',
    'EXTERNAL'
  ));
