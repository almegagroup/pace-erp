ALTER TABLE erp_procurement.purchase_order
  ADD COLUMN IF NOT EXISTS shipment_mode TEXT,
  ADD COLUMN IF NOT EXISTS import_trade_type TEXT,
  ADD COLUMN IF NOT EXISTS customs_movement_type TEXT;

ALTER TABLE erp_procurement.purchase_order
  DROP CONSTRAINT IF EXISTS ck_po_shipment_mode;
ALTER TABLE erp_procurement.purchase_order
  ADD CONSTRAINT ck_po_shipment_mode
  CHECK (shipment_mode IS NULL OR shipment_mode IN ('FCL', 'LCL', 'AIR', 'COURIER'));

ALTER TABLE erp_procurement.purchase_order
  DROP CONSTRAINT IF EXISTS ck_po_import_trade_type;
ALTER TABLE erp_procurement.purchase_order
  ADD CONSTRAINT ck_po_import_trade_type
  CHECK (import_trade_type IS NULL OR import_trade_type IN ('DIRECT_IMPORT', 'HIGH_SEA_SALE'));

ALTER TABLE erp_procurement.purchase_order
  DROP CONSTRAINT IF EXISTS ck_po_customs_movement_type;
ALTER TABLE erp_procurement.purchase_order
  ADD CONSTRAINT ck_po_customs_movement_type
  CHECK (customs_movement_type IS NULL OR customs_movement_type IN ('DPD', 'CFS', 'ICD'));
