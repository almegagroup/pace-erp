-- Section 113 (Sales Module Redesign) — Task A/C
-- Adds Freight Term / Rebate (mirroring stock_transfer_order_line's existing
-- shape) and the new Packaging Cost mechanism (§113.9) to sales_order_line.
-- Storage Location / Cost Center are deliberately NOT added here — §113.8
-- locks those to the future DO stage, not SO.

ALTER TABLE erp_procurement.sales_order_line
  ADD COLUMN freight_term text NULL,
  ADD COLUMN remarks text NULL,
  ADD COLUMN has_rebate boolean NOT NULL DEFAULT false,
  ADD COLUMN rebate_rate numeric NULL,
  ADD COLUMN rebate_rate_uom_basis text NULL,
  ADD COLUMN rebate_remarks text NULL,
  ADD COLUMN packaging_cost_basis text NULL,
  ADD COLUMN packaging_cost_rate numeric NULL,
  ADD COLUMN packaging_cost_amount numeric NULL,
  ADD COLUMN packaging_gst_treatment text NULL,
  ADD COLUMN packaging_gst_rate numeric NULL;

ALTER TABLE erp_procurement.sales_order_line
  ADD CONSTRAINT sales_order_line_rebate_basis_check
  CHECK (rebate_rate_uom_basis IS NULL OR rebate_rate_uom_basis IN ('BASE_UOM', 'PO_UOM'));

ALTER TABLE erp_procurement.sales_order_line
  ADD CONSTRAINT sales_order_line_packaging_basis_check
  CHECK (packaging_cost_basis IS NULL OR packaging_cost_basis IN ('FLAT', 'PER_KG'));

ALTER TABLE erp_procurement.sales_order_line
  ADD CONSTRAINT sales_order_line_packaging_gst_treatment_check
  CHECK (packaging_gst_treatment IS NULL OR packaging_gst_treatment IN ('NO_GST', 'SAME_AS_MATERIAL', 'CUSTOM'));
