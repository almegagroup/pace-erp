-- Fix goods_receipt target_stock_type CHECK constraint
-- QA_STOCK → QUALITY_INSPECTION to match stock_type_master values
ALTER TABLE erp_procurement.goods_receipt
  DROP CONSTRAINT goods_receipt_target_stock_type_check;

ALTER TABLE erp_procurement.goods_receipt
  ADD CONSTRAINT goods_receipt_target_stock_type_check
  CHECK (target_stock_type IN ('UNRESTRICTED', 'QUALITY_INSPECTION', 'BLOCKED') OR target_stock_type IS NULL);
