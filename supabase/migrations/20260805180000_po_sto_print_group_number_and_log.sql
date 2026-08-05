INSERT INTO erp_procurement.document_number_series (doc_type, starting_number, last_number, pad_width)
VALUES ('PRINT_GROUP', 9700000001, 0, 10)
ON CONFLICT (doc_type) DO NOTHING;

ALTER TABLE erp_procurement.po_order_group
  ADD COLUMN IF NOT EXISTS group_number TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS ux_po_order_group_group_number
  ON erp_procurement.po_order_group (group_number)
  WHERE group_number IS NOT NULL;

ALTER TABLE erp_procurement.stock_transfer_order
  ADD COLUMN IF NOT EXISTS group_number TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS ux_stock_transfer_order_group_number
  ON erp_procurement.stock_transfer_order (group_number)
  WHERE group_number IS NOT NULL;

CREATE TABLE IF NOT EXISTS erp_procurement.print_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_number TEXT NOT NULL,
  document_kind TEXT NOT NULL CHECK (document_kind IN ('PO_GROUP', 'STO')),
  document_ids JSONB NOT NULL,
  printed_by UUID NOT NULL,
  printed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_print_log_group_number
  ON erp_procurement.print_log (group_number);
