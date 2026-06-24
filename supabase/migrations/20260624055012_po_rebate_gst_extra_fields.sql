-- PO Create redesign (2026-06-24): Payment Term + Freight Term moved to
-- per-line (already supported by existing purchase_order columns), plus
-- new fields: structured rebate rate, GST terms, and free-text extra
-- print fields.

ALTER TABLE erp_procurement.purchase_order
  ADD COLUMN rebate_rate numeric NULL,
  ADD COLUMN rebate_rate_uom_basis text NULL
    CHECK (rebate_rate_uom_basis IN ('BASE_UOM', 'PO_UOM'));

COMMENT ON COLUMN erp_procurement.purchase_order.rebate_rate IS
'Optional — rebate amount per unit (basis set by rebate_rate_uom_basis), in vendor currency. Used for later remittance reconciliation.';
COMMENT ON COLUMN erp_procurement.purchase_order.rebate_rate_uom_basis IS
'Optional — whether rebate_rate is per Base UOM or per PO UOM.';

ALTER TABLE erp_procurement.po_order_group
  ADD COLUMN gst_terms text NULL
    CHECK (gst_terms IN ('INCLUSIVE', 'EXCLUSIVE')),
  ADD COLUMN extra_fields jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN erp_procurement.po_order_group.gst_terms IS
'Optional — Domestic GST treatment for this order: INCLUSIVE or EXCLUSIVE.';
COMMENT ON COLUMN erp_procurement.po_order_group.extra_fields IS
'Free-text additional fields/clauses to appear on the printed Order Copy. Array of strings.';
