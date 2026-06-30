-- Material Master: rename purchase_uom_code / issue_uom_code semantics to Alt UOM 1 / Alt UOM 2
-- These columns were previously NOT NULL with base_uom_code fallback — now optional.

ALTER TABLE erp_master.material_master
  ALTER COLUMN purchase_uom_code DROP NOT NULL,
  ALTER COLUMN issue_uom_code DROP NOT NULL;

COMMENT ON COLUMN erp_master.material_master.purchase_uom_code IS 'Alternate UOM 1 — optional alternative unit (e.g. Bag, Roll, Carton)';
COMMENT ON COLUMN erp_master.material_master.issue_uom_code IS 'Alternate UOM 2 — optional second alternative unit (e.g. Bottle, Box)';
