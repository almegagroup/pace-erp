-- Per-line Round Off on SO01 (Sales Order) — business owner wants Round Off
-- entered per item line, not just once at the SO header (the header
-- erp_procurement.sales_order.round_off_amount column already existed and
-- stays as a derived/informational sum of the line values below).
ALTER TABLE erp_procurement.sales_order_line
  ADD COLUMN IF NOT EXISTS round_off_amount numeric NOT NULL DEFAULT 0;
