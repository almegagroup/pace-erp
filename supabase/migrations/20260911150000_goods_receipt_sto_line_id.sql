-- Same-day self-caught bug (2026-09-11): the previous commit in this chain
-- (STO->DO->GE->GRN gap fixes) added `sto_line_id: geLine.sto_line_id` to
-- createGrnFromGateEntryLineHandler's INSERT into erp_procurement.
-- goods_receipt -- but that column never existed on goods_receipt, only on
-- the legacy goods_receipt_line table. goods_receipt already carries
-- po_id+po_line_id as a matched pair for the PO path; sto_id existed alone
-- with no sto_line_id counterpart, an asymmetry that was clearly just an
-- oversight when STO support was bolted on. Adding it here, mirroring
-- po_line_id's own FK shape exactly, so the pending code fix (same commit)
-- has a real column to write to.
ALTER TABLE erp_procurement.goods_receipt
  ADD COLUMN IF NOT EXISTS sto_line_id uuid REFERENCES erp_procurement.stock_transfer_order_line(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_goods_receipt_sto_line_id
  ON erp_procurement.goods_receipt (sto_line_id)
  WHERE sto_line_id IS NOT NULL;
