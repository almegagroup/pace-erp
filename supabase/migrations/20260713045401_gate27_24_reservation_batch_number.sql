/*
 * Migration: 20260713110000_gate27_24_reservation_batch_number
 * Gate: 27.24
 * Purpose: Packing PO's SFG-line reservation must be batch-specific (a Packing PO
 *          draws from one specific Process PO batch, not a generic material+location
 *          pool like RM/PM reservation). reservation_document had no batch dimension
 *          at all — add it so SFG reservations can be scoped to (material, location,
 *          batch_number) instead of just (material, location).
 * Authority: Backend
 */

BEGIN;

ALTER TABLE erp_production.reservation_document
  ADD COLUMN IF NOT EXISTS batch_number text NULL;

COMMENT ON COLUMN erp_production.reservation_document.batch_number IS
  'NULL for generic (non-batch) reservations, e.g. Process PO RM/PM. Set for batch-specific reservations, e.g. Packing PO SFG lines drawing from a specific Process PO batch.';

COMMIT;
