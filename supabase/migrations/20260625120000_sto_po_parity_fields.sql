-- STO Create is being rebuilt to mirror Purchase Order's structure
-- exactly (the sending company is treated as a vendor). PO already
-- carries payment term, freight term, GST terms, rebate, and a
-- delivery date per line, plus a cost center at header level. STO
-- needs the line-level equivalents (it keeps multiple lines per
-- document, unlike PO's per-material model, so these stay on the
-- line table rather than the header) plus a cost center per side of
-- the transfer (sending and receiving company each have their own).

ALTER TABLE erp_procurement.stock_transfer_order
  ADD COLUMN sending_cost_center_id uuid,
  ADD COLUMN receiving_cost_center_id uuid;

ALTER TABLE erp_procurement.stock_transfer_order_line
  ADD COLUMN payment_term_id uuid,
  ADD COLUMN freight_term text,
  ADD COLUMN gst_terms text,
  ADD COLUMN remarks text,
  ADD COLUMN has_rebate boolean NOT NULL DEFAULT false,
  ADD COLUMN rebate_rate numeric,
  ADD COLUMN rebate_rate_uom_basis text,
  ADD COLUMN rebate_remarks text,
  ADD COLUMN expected_delivery_date date;
