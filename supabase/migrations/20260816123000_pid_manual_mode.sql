-- IN01/PID manual MI01 mode
-- Adds a third document mode for explicitly staged company-mapped materials whose
-- target storage location + stock type are chosen by the user during MI01 creation.

BEGIN;

ALTER TABLE erp_procurement.physical_inventory_document
  DROP CONSTRAINT IF EXISTS physical_inventory_document_mode_check;

ALTER TABLE erp_procurement.physical_inventory_document
  DROP CONSTRAINT IF EXISTS physical_inventory_document_mode_check1;

ALTER TABLE erp_procurement.physical_inventory_document
  ADD CONSTRAINT physical_inventory_document_mode_check
  CHECK (mode IN ('LOCATION_WISE', 'ITEM_WISE', 'MANUAL_WISE'));

COMMENT ON COLUMN erp_procurement.physical_inventory_document.mode IS
'LOCATION_WISE = one storage location sweep; ITEM_WISE = stock-driven multi-location picks; MANUAL_WISE = explicit company-mapped material/location/status staging from MI01.';

COMMIT;
