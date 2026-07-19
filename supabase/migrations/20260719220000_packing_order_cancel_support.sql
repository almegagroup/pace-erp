-- ============================================================================
-- Packing PO cancel support (feasibility §83.4.1)
--
-- PR10-এর Packing PO cancel-এর জন্য দুটো schema gap:
--   ১. status CHECK-এ CANCELLED ছিল না (শুধু STANDARD/FINAL/REVERSED)
--   ২. cancel_reason column ছিল না (reason বাধ্যতামূলক — business owner)
-- ============================================================================

ALTER TABLE erp_production.packing_order
  ADD COLUMN IF NOT EXISTS cancel_reason text;

ALTER TABLE erp_production.packing_order
  DROP CONSTRAINT IF EXISTS packing_order_status_check;

ALTER TABLE erp_production.packing_order
  ADD CONSTRAINT packing_order_status_check
  CHECK (status = ANY (ARRAY['STANDARD','FINAL','REVERSED','CANCELLED']));

COMMENT ON COLUMN erp_production.packing_order.cancel_reason IS
  'PR10 Packing PO cancel-এর mandatory reason (§83.4.1)।';
