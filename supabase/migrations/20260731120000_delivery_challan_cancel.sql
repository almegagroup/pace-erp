-- §113.15 Stage 3 design lock, 2026-07-31: DO cancel (pre-PGI reversal) --
-- whole-DO cancel, not per-line, reason mandatory, releases the
-- reservation_document. delivery_challan.status never allowed CANCELLED
-- and had no cancellation audit columns at all.

ALTER TABLE erp_procurement.delivery_challan
  DROP CONSTRAINT delivery_challan_status_check;

ALTER TABLE erp_procurement.delivery_challan
  ADD CONSTRAINT delivery_challan_status_check
  CHECK (status = ANY (ARRAY['AUTO_GENERATED'::text, 'DISPATCHED'::text, 'CREATED'::text, 'CANCELLED'::text]));

ALTER TABLE erp_procurement.delivery_challan
  ADD COLUMN cancellation_reason text,
  ADD COLUMN cancelled_by uuid,
  ADD COLUMN cancelled_at timestamp with time zone;
