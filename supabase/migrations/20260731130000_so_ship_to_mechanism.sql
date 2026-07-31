-- §113.16 — SO Ship-To mechanism + GST place-of-supply correction.
-- sales_order carries the resolved/effective Ship-To (either copied from
-- the customer, or manually entered) so downstream code never has to
-- branch on ship_to_same_as_customer to know the real state. delivery_challan
-- gets a frozen snapshot copy at DO-create time, same pattern as the
-- existing §113.13 commercial snapshot -- createPgiInvoiceHandler reads
-- delivery_challan.ship_to_state directly instead of live-querying
-- customer_master.billing_state.

ALTER TABLE erp_procurement.sales_order
  ADD COLUMN ship_to_same_as_customer boolean NOT NULL DEFAULT true,
  ADD COLUMN ship_to_type text CHECK (ship_to_type IN ('REGISTERED', 'UNREGISTERED')),
  ADD COLUMN ship_to_gst_number text,
  ADD COLUMN ship_to_name text,
  ADD COLUMN ship_to_address text,
  ADD COLUMN ship_to_state text;

ALTER TABLE erp_procurement.delivery_challan
  ADD COLUMN ship_to_state text,
  ADD COLUMN ship_to_name text,
  ADD COLUMN ship_to_address text,
  ADD COLUMN ship_to_gst_number text;
