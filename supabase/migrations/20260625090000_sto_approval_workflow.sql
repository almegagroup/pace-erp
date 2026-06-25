-- Add an approval gate to Stock Transfer Orders, matching the
-- DRAFT -> PENDING_APPROVAL -> CONFIRMED-equivalent flow already used by
-- Purchase Orders. STO's existing fulfillment lifecycle (CREATED ->
-- DISPATCHED -> RECEIVED -> CLOSED / CANCELLED) is unchanged; DRAFT and
-- PENDING_APPROVAL are inserted before CREATED.

ALTER TABLE erp_procurement.stock_transfer_order DROP CONSTRAINT stock_transfer_order_status_check;
ALTER TABLE erp_procurement.stock_transfer_order ADD CONSTRAINT stock_transfer_order_status_check
  CHECK (status = ANY (ARRAY['DRAFT','PENDING_APPROVAL','CREATED','DISPATCHED','RECEIVED','CLOSED','CANCELLED']));

ALTER TABLE erp_procurement.stock_transfer_order ADD COLUMN approved_by uuid;
ALTER TABLE erp_procurement.stock_transfer_order ADD COLUMN approved_at timestamptz;
