/*
 * File-ID: 11.3
 * File-Path: supabase/migrations/20260509102000_gate11_11_3_create_stock_type_master.sql
 * Gate: 11
 * Phase: 11
 * Domain: INVENTORY
 * Purpose: Create the stock_type_master table for all valid stock states.
 * Authority: Backend
 */

BEGIN;

CREATE TABLE IF NOT EXISTS erp_inventory.stock_type_master (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  code                        text NOT NULL UNIQUE,
  name                        text NOT NULL,

  -- Can stock in this type be issued to production?
  available_for_issue         boolean NOT NULL DEFAULT false,

  -- Can stock in this type be dispatched to customer?
  available_for_dispatch      boolean NOT NULL DEFAULT false,

  -- Does moving stock OUT of this type require approval?
  requires_approval_to_move   boolean NOT NULL DEFAULT false,

  -- true = built-in PACE type, false = SA-added custom type
  is_system_type              boolean NOT NULL DEFAULT false,

  active                      boolean NOT NULL DEFAULT true,

  created_at                  timestamptz NOT NULL DEFAULT now(),
  created_by                  uuid NULL
);

COMMENT ON TABLE erp_inventory.stock_type_master IS
'All valid stock states. SA-extensible. Phase-1 has 5 active types: UNRESTRICTED, QUALITY_INSPECTION, BLOCKED, IN_TRANSIT, FOR_REPROCESS.';

COMMIT;
