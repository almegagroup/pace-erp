ALTER TABLE erp_procurement.purchase_order
  DROP CONSTRAINT IF EXISTS ck_po_import_trade_type;
ALTER TABLE erp_procurement.purchase_order
  ADD CONSTRAINT ck_po_import_trade_type
  CHECK (
    import_trade_type IS NULL OR import_trade_type IN (
      'DIRECT_IMPORT',
      'HIGH_SEA_SALE',
      'BONDED_WAREHOUSE',
      'EPCG_ADVANCE_AUTH'
    )
  );
