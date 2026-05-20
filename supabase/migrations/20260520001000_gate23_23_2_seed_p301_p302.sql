/*
 * File-ID: 23.2
 * File-Path: supabase/migrations/20260520001000_gate23_23_2_seed_p301_p302.sql
 * Gate: 23
 * Phase: 23
 * Domain: INVENTORY
 * Purpose: Add missing P301 (one-step plant transfer) and P302 (reversal) movement types.
 * Authority: Backend
 */

BEGIN;

INSERT INTO erp_inventory.movement_type_master
  (code, name, direction, source_stock_type, target_stock_type,
   reference_document_required, reference_document_type,
   reversal_of, reversed_by, role_restricted, approval_required, is_custom, active)
VALUES
  ('P301', 'Plant Transfer (One-Step)', 'TRANSFER', 'UNRESTRICTED', 'UNRESTRICTED', true, 'PLANT_TRANSFER_ORDER', NULL, 'P302', false, true, false, true),
  ('P302', 'P301 Reversal', 'TRANSFER', 'UNRESTRICTED', 'UNRESTRICTED', true, 'PLANT_TRANSFER_ORDER', 'P301', NULL, false, true, false, true)
ON CONFLICT (code) DO NOTHING;

COMMIT;
