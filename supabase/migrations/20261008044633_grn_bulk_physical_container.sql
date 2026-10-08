-- Bulk GRN physical-container verification. The GE/container number remains the
-- transport-document value; this pair records the number physically observed at
-- receipt and whether it was confirmed as the same value.
BEGIN;

ALTER TABLE erp_procurement.goods_receipt
  ADD COLUMN physical_container_number text NULL,
  ADD COLUMN physical_container_matches_ge boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN erp_procurement.goods_receipt.physical_container_number IS
'Bulk-only physical container number observed at GRN. Mandatory for every newly posted Bulk GRN by handler validation. When physical_container_matches_ge=true it is copied from bulk_container_number.';

COMMENT ON COLUMN erp_procurement.goods_receipt.physical_container_matches_ge IS
'Bulk-only verification flag. Defaults false; true means the GRN/GE container number was confirmed against the physical container and copied into physical_container_number.';

COMMIT;
