BEGIN;

-- §6 point 14 — Bulk DO Upload (SO03) captures Tally Invoice Number/Date and
-- Inbound Number at upload time, before any sales_invoice row exists (that
-- only gets created later, at SO02 Bulk Posting / Invoice-only time). These
-- are purely additive pre-invoice staging fields on delivery_challan -- the
-- existing sales_invoice.tally_invoice_number/tally_invoice_date/
-- inbound_number columns (written at invoice-group post time) are
-- untouched; the new Invoice-only endpoint (implementation Phase 4) reads
-- these to prefill that write, so the user never re-types them.
ALTER TABLE erp_procurement.delivery_challan
  ADD COLUMN IF NOT EXISTS pre_invoice_tally_invoice_number text NULL,
  ADD COLUMN IF NOT EXISTS pre_invoice_tally_invoice_date date NULL,
  ADD COLUMN IF NOT EXISTS pre_invoice_inbound_number text NULL;

COMMENT ON COLUMN erp_procurement.delivery_challan.pre_invoice_tally_invoice_number IS
  'Captured at Bulk DO Upload (SO03) time for VDC rows, before any sales_invoice exists. Copied into sales_invoice.tally_invoice_number when the new Invoice-only endpoint posts -- never read by any existing handler.';
COMMENT ON COLUMN erp_procurement.delivery_challan.pre_invoice_tally_invoice_date IS
  'Same pre-invoice staging as pre_invoice_tally_invoice_number, for the Tally Invoice Date.';
COMMENT ON COLUMN erp_procurement.delivery_challan.pre_invoice_inbound_number IS
  'Same pre-invoice staging as pre_invoice_tally_invoice_number, for the Inbound Number (IBN).';

NOTIFY pgrst, 'reload schema';
COMMIT;
