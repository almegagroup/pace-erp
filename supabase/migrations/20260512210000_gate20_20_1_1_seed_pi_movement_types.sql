/*
 * File-ID: 20.1.1
 * File-Path: supabase/migrations/20260512210000_gate20_20_1_1_seed_pi_movement_types.sql
 * Gate: 20
 * Phase: 20
 * Domain: PROCUREMENT / INVENTORY
 * Purpose: Seed physical-inventory surplus, deficit, and reversal movement types.
 * Authority: Database
 */

BEGIN;

INSERT INTO erp_inventory.movement_type_master
  (code, name, direction, source_stock_type, target_stock_type,
   reference_document_required, reference_document_type,
   reversal_of, reversed_by, role_restricted, approval_required, is_custom, active)
VALUES
  ('P701', 'PI Surplus - Unrestricted',       'IN',  NULL,                 'UNRESTRICTED',       true,  'PID_DOCUMENT', NULL,   'P711', false, false, false, true),
  ('P703', 'PI Surplus - Quality Inspection', 'IN',  NULL,                 'QUALITY_INSPECTION', true,  'PID_DOCUMENT', NULL,   'P713', false, false, false, true),
  ('P705', 'PI Surplus - Blocked',            'IN',  NULL,                 'BLOCKED',            true,  'PID_DOCUMENT', NULL,   'P715', false, false, false, true),
  ('P702', 'PI Deficit - Unrestricted',       'OUT', 'UNRESTRICTED',       NULL,                 true,  'PID_DOCUMENT', NULL,   'P712', false, false, false, true),
  ('P704', 'PI Deficit - Quality Inspection', 'OUT', 'QUALITY_INSPECTION', NULL,                 true,  'PID_DOCUMENT', NULL,   'P714', false, false, false, true),
  ('P706', 'PI Deficit - Blocked',            'OUT', 'BLOCKED',            NULL,                 true,  'PID_DOCUMENT', NULL,   'P716', false, false, false, true),
  ('P711', 'P701 Reversal', 'OUT', 'UNRESTRICTED',       NULL,                 true,  'PID_DOCUMENT', 'P701', NULL, false, false, false, true),
  ('P712', 'P702 Reversal', 'IN',  NULL,                 'UNRESTRICTED',       true,  'PID_DOCUMENT', 'P702', NULL, false, false, false, true),
  ('P713', 'P703 Reversal', 'OUT', 'QUALITY_INSPECTION', NULL,                 true,  'PID_DOCUMENT', 'P703', NULL, false, false, false, true),
  ('P714', 'P704 Reversal', 'IN',  NULL,                 'QUALITY_INSPECTION', true,  'PID_DOCUMENT', 'P704', NULL, false, false, false, true),
  ('P715', 'P705 Reversal', 'OUT', 'BLOCKED',            NULL,                 true,  'PID_DOCUMENT', 'P705', NULL, false, false, false, true),
  ('P716', 'P706 Reversal', 'IN',  NULL,                 'BLOCKED',            true,  'PID_DOCUMENT', 'P706', NULL, false, false, false, true)
ON CONFLICT (code) DO NOTHING;

COMMIT;
