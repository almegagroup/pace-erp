/*
 * Migration: 20260705182130_restore_opening_stock_qa_blocked_movement_types
 * Purpose: Restore P563/P564 (Opening Stock QA) and P565/P566 (Opening Stock Blocked).
 *
 * These were incorrectly removed. At go-live, opening stock must be postable
 * directly to QA or Blocked stock (not just Unrestricted). The previous
 * "SAP simplification" did not account for this business requirement.
 */

BEGIN;

INSERT INTO erp_inventory.movement_type_master
  (code, name, direction, source_stock_type, target_stock_type,
   reference_document_required, reference_document_type,
   reversal_of, reversed_by, role_restricted, approval_required, is_custom, active)
VALUES
  ('P563', 'Opening Stock - QA',       'IN',  NULL,                 'QUALITY_INSPECTION', false, NULL, NULL,   'P564', false, false, false, true),
  ('P564', 'P563 Reversal',            'OUT', 'QUALITY_INSPECTION', NULL,                 false, NULL, 'P563', NULL,   false, false, false, true),
  ('P565', 'Opening Stock - Blocked',  'IN',  NULL,                 'BLOCKED',            false, NULL, NULL,   'P566', false, false, false, true),
  ('P566', 'P565 Reversal',            'OUT', 'BLOCKED',            NULL,                 false, NULL, 'P565', NULL,   false, false, false, true);

COMMIT;
