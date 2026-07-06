/*
 * Migration: 20260705175344_cleanup_redundant_movement_types
 * Purpose: Remove redundant/unused movement types that have no SAP equivalent
 *          and no stock ledger usage.
 *
 * Removed:
 *   P103 — GRN → Blocked (direct). SAP never bypasses QI. No use case.
 *   P104 — P103 Reversal. Removed with P103.
 *   P324 — "P323 Reversal" (Blocked→QA). Duplicate of P349 (same stock movement).
 *   P350 — "QA → Blocked". Duplicate of P323 (same stock movement).
 *
 * After cleanup, P323 (QA→Blocked) ↔ P349 (Blocked→QA) become the clean pair.
 */

BEGIN;

-- Fix reversal pair: P323 ↔ P349 (before deleting P324 and P350)
UPDATE erp_inventory.movement_type_master
  SET reversed_by = 'P349'
  WHERE code = 'P323';

UPDATE erp_inventory.movement_type_master
  SET reversed_by = 'P323'
  WHERE code = 'P349';

-- Clear references to codes being deleted
UPDATE erp_inventory.movement_type_master
  SET reversal_of = NULL
  WHERE code = 'P324';

-- Delete redundant movement types
DELETE FROM erp_inventory.movement_type_master
  WHERE code IN ('P103', 'P104', 'P324', 'P350');

COMMIT;
