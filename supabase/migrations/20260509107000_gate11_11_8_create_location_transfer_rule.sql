/*
 * File-ID: 11.8
 * File-Path: supabase/migrations/20260509107000_gate11_11_8_create_location_transfer_rule.sql
 * Gate: 11
 * Phase: 11
 * Domain: INVENTORY
 * Purpose: Create the location_transfer_rule table for one-step and two-step transfers.
 * Authority: Backend
 */

BEGIN;

CREATE TABLE IF NOT EXISTS erp_inventory.location_transfer_rule (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  source_location_id uuid NOT NULL
    REFERENCES erp_inventory.storage_location_master(id)
    ON DELETE RESTRICT,

  dest_location_id   uuid NOT NULL
    REFERENCES erp_inventory.storage_location_master(id)
    ON DELETE RESTRICT,

  -- ONE_STEP = P311 (instant), TWO_STEP = P303->P305 (via IN_TRANSIT)
  transfer_type      text NOT NULL CHECK (transfer_type IN ('ONE_STEP', 'TWO_STEP')),

  active             boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid NULL,

  UNIQUE (source_location_id, dest_location_id)
);

COMMENT ON TABLE erp_inventory.location_transfer_rule IS
'SA-configured rule: for each source->destination location pair, is transfer one-step or two-step?';

COMMIT;
