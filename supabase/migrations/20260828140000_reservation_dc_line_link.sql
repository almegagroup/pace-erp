-- §133.12 correctness fix — under the OLD single-source DO model, a source
-- line could only ever be referenced by one ACTIVE DO at a time (exclusive
-- lock, §113.5), so cancelDeliveryOrderHandler releasing every OPEN
-- reservation_document row for that source_line_id was always safe: there
-- was never more than one. §133.12's multi-source, partial-qty-per-vehicle
-- model breaks that assumption — multiple DOs can now legitimately hold
-- separate OPEN reservations against the SAME source line at once.
-- Cancelling one must never release another DO's reservation.

ALTER TABLE erp_production.reservation_document
  ADD COLUMN dc_line_id uuid REFERENCES erp_procurement.delivery_challan_line(id);

CREATE INDEX idx_reservation_document_dc_line_id ON erp_production.reservation_document(dc_line_id) WHERE dc_line_id IS NOT NULL;

COMMENT ON COLUMN erp_production.reservation_document.dc_line_id IS
  'Feasibility §133.12 — which specific delivery_challan_line created this reservation. NULL only on rows inserted before this column existed (safe under the old model''s exclusive per-line lock, where a source line never had more than one concurrent reservation); every DO created after this migration always sets it, and cancelDeliveryOrderHandler releases by this column first, falling back to the old source_line_id-wide match only for legacy NULL rows.';

NOTIFY pgrst, 'reload schema';
