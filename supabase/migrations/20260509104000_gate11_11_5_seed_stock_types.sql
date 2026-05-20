/*
 * File-ID: 11.5
 * File-Path: supabase/migrations/20260509104000_gate11_11_5_seed_stock_types.sql
 * Gate: 11
 * Phase: 11
 * Domain: INVENTORY
 * Purpose: Seed the five Phase-1 stock types.
 * Authority: Backend
 */

BEGIN;

INSERT INTO erp_inventory.stock_type_master
  (code, name, available_for_issue, available_for_dispatch, requires_approval_to_move, is_system_type, active)
VALUES
  ('UNRESTRICTED',       'Unrestricted',       true,  true,  false, true, true),
  ('QUALITY_INSPECTION', 'Quality Inspection', false, false, false, true, true),
  ('BLOCKED',            'Blocked',            false, false, true,  true, true),
  ('IN_TRANSIT',         'In Transit',         false, false, false, true, true),
  ('FOR_REPROCESS',      'For Reprocess',      false, false, true,  true, true)
ON CONFLICT (code) DO NOTHING;

COMMIT;
