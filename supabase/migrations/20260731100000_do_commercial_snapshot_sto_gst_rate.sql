-- §113.13/§113.15 Stage 3 design lock (2026-07-31): DO must carry a full
-- commercial snapshot (rate/GST/packaging-cost/rebate/freight/payment-term)
-- copied from the source SO/STO line at DO-create time -- safe because that
-- line freezes the moment a DO exists against it (§113.5). PGI+Invoice
-- (Accounts) then reads only from the DO, never re-joins back to SO/STO.
--
-- CGST/SGST vs IGST is NOT stored here -- that split depends on the GST
-- type determination (customer/company state comparison), which only
-- happens at Invoice-creation time. DO stores the raw gst_rate/gst_amount
-- only.
--
-- STO also gets gst_rate/gst_amount added to its own line (business owner
-- decision, 2026-07-31): STO never had a GST rate source at all
-- (stock_transfer_order_line only had gst_terms INCLUSIVE/EXCLUSIVE, no
-- rate; material_master has no GST field either) -- captured at STO
-- create/edit time, same shape as sales_order_line's existing gst_rate.

ALTER TABLE erp_procurement.delivery_challan
  ADD COLUMN freight_term text,
  ADD COLUMN payment_term_id uuid;

ALTER TABLE erp_procurement.delivery_challan_line
  ADD COLUMN gst_rate numeric,
  ADD COLUMN gst_amount numeric,
  ADD COLUMN packaging_cost_basis text,
  ADD COLUMN packaging_cost_rate numeric,
  ADD COLUMN packaging_cost_amount numeric,
  ADD COLUMN packaging_gst_treatment text,
  ADD COLUMN packaging_gst_rate numeric,
  ADD COLUMN has_rebate boolean DEFAULT false,
  ADD COLUMN rebate_rate numeric,
  ADD COLUMN rebate_rate_uom_basis text,
  ADD COLUMN rebate_remarks text;

ALTER TABLE erp_procurement.stock_transfer_order_line
  ADD COLUMN gst_rate numeric,
  ADD COLUMN gst_amount numeric;
