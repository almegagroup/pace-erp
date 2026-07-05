/*
 * Migration: 20260705182845_restore_pid_qa_blocked_movement_types
 * Purpose: Restore P703-P706 and P713-P716 (PID QA and Blocked movement types).
 *
 * These were incorrectly removed. Physical Inventory counts can be taken on
 * QA or Blocked stock — surplus/deficit must post to the correct stock type,
 * not always to Unrestricted.
 */

BEGIN;

INSERT INTO erp_inventory.movement_type_master
  (code, name, direction, source_stock_type, target_stock_type,
   reference_document_required, reference_document_type,
   reversal_of, reversed_by, role_restricted, approval_required, is_custom, active)
VALUES
  ('P703', 'PI Surplus - Quality Inspection', 'IN',  NULL,                 'QUALITY_INSPECTION', false, NULL,   NULL,   'P713', false, false, false, true),
  ('P704', 'PI Deficit - Quality Inspection', 'OUT', 'QUALITY_INSPECTION', NULL,                 false, NULL,   NULL,   'P714', false, false, false, true),
  ('P705', 'PI Surplus - Blocked',            'IN',  NULL,                 'BLOCKED',            false, NULL,   NULL,   'P715', false, false, false, true),
  ('P706', 'PI Deficit - Blocked',            'OUT', 'BLOCKED',            NULL,                 false, NULL,   NULL,   'P716', false, false, false, true),
  ('P713', 'P703 Reversal',                   'OUT', 'QUALITY_INSPECTION', NULL,                 false, NULL,   'P703', NULL,   false, false, false, true),
  ('P714', 'P704 Reversal',                   'IN',  NULL,                 'QUALITY_INSPECTION', false, NULL,   'P704', NULL,   false, false, false, true),
  ('P715', 'P705 Reversal',                   'OUT', 'BLOCKED',            NULL,                 false, NULL,   'P705', NULL,   false, false, false, true),
  ('P716', 'P706 Reversal',                   'IN',  NULL,                 'BLOCKED',            false, NULL,   'P706', NULL,   false, false, false, true);

COMMIT;
