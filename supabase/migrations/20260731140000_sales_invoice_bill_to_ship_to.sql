-- §113.16-addendum — a GST invoice legally needs both Bill-To (customer's
-- own registered identity) and Ship-To (delivery destination) printed.
-- Frozen onto sales_invoice itself at PGI time so the invoice stays
-- self-contained even if the DO/customer record changes later.

ALTER TABLE erp_procurement.sales_invoice
  ADD COLUMN bill_to_name text,
  ADD COLUMN bill_to_address text,
  ADD COLUMN bill_to_state text,
  ADD COLUMN bill_to_gst_number text,
  ADD COLUMN ship_to_name text,
  ADD COLUMN ship_to_address text,
  ADD COLUMN ship_to_state text,
  ADD COLUMN ship_to_gst_number text;
