-- GST Terms moved from order-group (header) level to per-material-line
-- level, per design correction during the PO Create redesign session
-- (2026-06-24): same vendor, different materials can have different
-- GST treatment.

ALTER TABLE erp_procurement.po_order_group
  DROP COLUMN IF EXISTS gst_terms;

ALTER TABLE erp_procurement.purchase_order
  ADD COLUMN gst_terms text NULL
    CHECK (gst_terms IN ('INCLUSIVE', 'EXCLUSIVE'));

COMMENT ON COLUMN erp_procurement.purchase_order.gst_terms IS
'Optional — Domestic GST treatment for this material: INCLUSIVE or EXCLUSIVE.';
