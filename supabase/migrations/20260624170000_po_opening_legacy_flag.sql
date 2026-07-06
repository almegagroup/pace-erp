-- Opening/Legacy PO support: allow manual entry of pre-existing open/in-transit
-- purchase orders at go-live, with duplicate po_number allowed only among
-- opening POs (legacy practice used one PO number across multiple materials;
-- PACE is per-material PO, so the same legacy number repeats across records).

ALTER TABLE erp_procurement.purchase_order
  ADD COLUMN is_opening_po boolean NOT NULL DEFAULT false;

ALTER TABLE erp_procurement.purchase_order
  DROP CONSTRAINT purchase_order_po_number_key;

CREATE UNIQUE INDEX purchase_order_po_number_unique_normal
  ON erp_procurement.purchase_order (po_number)
  WHERE is_opening_po = false;
