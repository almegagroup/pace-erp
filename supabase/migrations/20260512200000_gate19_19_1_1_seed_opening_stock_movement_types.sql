/*
 * File-ID: 19.1.1
 * File-Path: supabase/migrations/20260512200000_gate19_19_1_1_seed_opening_stock_movement_types.sql
 * Gate: 19
 * Phase: 19
 * Domain: PROCUREMENT / INVENTORY
 * Purpose: Seed opening-stock QA and blocked movement types missing from Gate-11.
 * Authority: Database
 */

BEGIN;

INSERT INTO erp_inventory.movement_type_master
  (code, name, direction, source_stock_type, target_stock_type,
   reference_document_required, reference_document_type,
   reversal_of, reversed_by, role_restricted, approval_required, is_custom, active)
VALUES
  ('P563', 'Opening Stock - QA', 'IN', NULL, 'QUALITY_INSPECTION', false, 'OPENING_STOCK', NULL, 'P564', false, true, false, true),
  ('P564', 'P563 Reversal', 'OUT', 'QUALITY_INSPECTION', NULL, false, 'OPENING_STOCK', 'P563', NULL, false, true, false, true),
  ('P565', 'Opening Stock - Blocked', 'IN', NULL, 'BLOCKED', false, 'OPENING_STOCK', NULL, 'P566', false, true, false, true),
  ('P566', 'P565 Reversal', 'OUT', 'BLOCKED', NULL, false, 'OPENING_STOCK', 'P565', NULL, false, true, false, true)
ON CONFLICT (code) DO NOTHING;

COMMIT;
