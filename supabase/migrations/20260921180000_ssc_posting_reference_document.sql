-- MTS CORS (2026-09-21, business owner): stock_status_change_posting rows
-- written by MTS Verify's QA-hold allocation carry no link back to which
-- Process PO produced them (batch_number/packing_po_number are both NULL for
-- MTS, since MTS SKU stock is pooled/blended and never batch- or
-- packing-PO-tracked). Without a link, a CORS reversal of one Process PO
-- cannot tell its own hold posting apart from another Process PO's hold on
-- the same SKU sitting in the same blended Blocked/QI pool. Two generic
-- nullable columns close this -- same shape already used elsewhere
-- (stock_document.reference_document_type/id) rather than an MTS-specific
-- name, since any future non-MTS status-change source can use it too.
ALTER TABLE erp_inventory.stock_status_change_posting
  ADD COLUMN IF NOT EXISTS reference_document_type text NULL,
  ADD COLUMN IF NOT EXISTS reference_document_id uuid NULL;

CREATE INDEX IF NOT EXISTS ix_ssc_posting_reference_document
  ON erp_inventory.stock_status_change_posting (reference_document_type, reference_document_id)
  WHERE reference_document_id IS NOT NULL;
