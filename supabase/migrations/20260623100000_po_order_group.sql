-- One PO = one material now (see feasibility doc 87.12A). Raising several
-- materials together creates one PO per material, all grouped under an
-- internal po_order_group for batch approval. The group is never exposed
-- to the vendor — each PO still carries its own normal number.

CREATE TABLE erp_procurement.po_order_group (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid        NOT NULL,
  vendor_id    uuid        NOT NULL,
  status       text        NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'CONFIRMED', 'REJECTED', 'CANCELLED')),
  remarks      text NULL,
  created_by   uuid        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  approved_by  uuid NULL,
  approved_at  timestamptz NULL,
  last_updated_at timestamptz NULL,
  last_updated_by uuid NULL
);

COMMENT ON TABLE erp_procurement.po_order_group IS
'Internal grouping of single-material POs raised together, for batch approval only. Never shown to the vendor.';

ALTER TABLE erp_procurement.purchase_order
  ADD COLUMN order_group_id uuid NULL
    REFERENCES erp_procurement.po_order_group(id) ON DELETE SET NULL;

CREATE INDEX idx_po_order_group_id ON erp_procurement.purchase_order (order_group_id);
CREATE INDEX idx_po_order_group_status ON erp_procurement.po_order_group (status);

ALTER TABLE erp_procurement.po_order_group ENABLE ROW LEVEL SECURITY;
