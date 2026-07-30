-- §113 Stage 2 (Delivery Order) fix: delivery_challan.status's pre-existing
-- CHECK constraint only allowed 'AUTO_GENERATED' (written by SO/STO's own
-- legacy atomic issue/dispatch handlers) and 'DISPATCHED' (unused today).
-- The new DO Create handler (delivery_order.handlers.ts) inserts status
-- 'CREATED' for its own Order -> DO -> GI+Invoice lifecycle, which the
-- constraint silently rejected (23514 violation -> generic 500 DO_CREATE_FAILED,
-- caught live 2026-07-30 for both SO- and STO-sourced DO creation).
-- Widen the constraint to also allow 'CREATED' without touching the two
-- existing values, which the legacy atomic flow still relies on.

ALTER TABLE erp_procurement.delivery_challan
  DROP CONSTRAINT delivery_challan_status_check;

ALTER TABLE erp_procurement.delivery_challan
  ADD CONSTRAINT delivery_challan_status_check
  CHECK (status = ANY (ARRAY['AUTO_GENERATED'::text, 'DISPATCHED'::text, 'CREATED'::text]));
