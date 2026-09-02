-- Found live 2026-09-02 (business owner, SO02 Prepare Invoice): the invoice
-- preview shows Quantity (base KG) but never Pack Quantity, because
-- delivery_challan_line never carried it in the first place -- the DO
-- Create page's own pick.pack_qty (frontend-only) was never sent to the
-- backend, and the table has no column for it. Display-only, same pattern
-- as display_rate_basis (20260901130000): pack_qty/pack_uom_code frozen at
-- DO-line time from that line's own drawn quantity ÷ per_pack_qty, never
-- used in any actual money/stock calculation.
ALTER TABLE erp_procurement.delivery_challan_line
  ADD COLUMN pack_qty numeric,
  ADD COLUMN pack_uom_code text;

ALTER TABLE erp_procurement.sales_invoice_line
  ADD COLUMN pack_qty numeric,
  ADD COLUMN pack_uom_code text;

NOTIFY pgrst, 'reload schema';
