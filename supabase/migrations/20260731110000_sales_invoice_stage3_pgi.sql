-- §113.15 Stage 3 (PGI + Invoice) design lock, 2026-07-31: sales_invoice
-- (SO02) becomes the unified PGI+Invoice mechanism for BOTH SO and STO
-- dispatches -- was hard-blocked to dc_type=SALES only, customer_id was
-- NOT NULL (STO has no customer, it's inter-company). Adds STO support,
-- the mandatory Tally reference fields, optional freight, and the
-- CANCELLED status + cancellation audit fields for the reversal path.

ALTER TABLE erp_procurement.sales_invoice
  ALTER COLUMN customer_id DROP NOT NULL;

ALTER TABLE erp_procurement.sales_invoice
  ADD COLUMN sto_id uuid REFERENCES erp_procurement.stock_transfer_order(id) ON DELETE RESTRICT,
  -- ERP's own invoice is tracking-only (no IRN/e-invoice link) -- the real
  -- legal/GST document is created in Tally separately. Mandatory for every
  -- invoice through the new PGI+Invoice flow (0 existing rows in dev, so
  -- NOT NULL directly, no backfill needed).
  ADD COLUMN tally_invoice_number text NOT NULL,
  ADD COLUMN tally_invoice_date date NOT NULL,
  ADD COLUMN freight_included boolean NOT NULL DEFAULT false,
  ADD COLUMN freight_amount numeric,
  ADD COLUMN cancelled_by uuid,
  ADD COLUMN cancelled_at timestamp with time zone,
  ADD COLUMN cancellation_reason text;

ALTER TABLE erp_procurement.sales_invoice
  ADD CONSTRAINT sales_invoice_customer_xor_sto_check
  CHECK (
    (customer_id IS NOT NULL AND sto_id IS NULL)
    OR (customer_id IS NULL AND sto_id IS NOT NULL)
  );

ALTER TABLE erp_procurement.sales_invoice
  DROP CONSTRAINT sales_invoice_status_check;

ALTER TABLE erp_procurement.sales_invoice
  ADD CONSTRAINT sales_invoice_status_check
  CHECK (status = ANY (ARRAY['DRAFT'::text, 'POSTED'::text, 'CANCELLED'::text]));
