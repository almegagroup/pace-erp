-- SO01 stores the user-entered signed rounding adjustment. Amount in Words
-- remains display-only; this numeric amount is needed for future SO/Invoice reports.
ALTER TABLE erp_procurement.sales_order
  ADD COLUMN IF NOT EXISTS round_off_amount numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN erp_procurement.sales_order.round_off_amount IS
  'SO01 user-entered signed Round Off adjustment; feasibility section 133.8-I/J.';

NOTIFY pgrst, 'reload schema';
