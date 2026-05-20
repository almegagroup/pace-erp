/*
 * File-ID: 11.6
 * File-Path: supabase/migrations/20260509105000_gate11_11_6_create_storage_location_master.sql
 * Gate: 11
 * Phase: 11
 * Domain: INVENTORY
 * Purpose: Create the global storage_location_master table.
 * Authority: Backend
 */

BEGIN;

CREATE TABLE IF NOT EXISTS erp_inventory.storage_location_master (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- e.g. R001, P001, F001, S001, T001
  code                text NOT NULL UNIQUE,
  name                text NOT NULL,

  -- PHYSICAL = real room/area, LOGICAL = system-only bucket, TRANSIT = in-motion stock
  location_type       text NOT NULL CHECK (location_type IN ('PHYSICAL', 'LOGICAL', 'TRANSIT')),

  -- If true, stock here is always in motion (IN_TRANSIT stock type only)
  is_transit_location boolean NOT NULL DEFAULT false,

  -- Can dispatch GI (P601) originate from this location?
  dispatch_allowed    boolean NOT NULL DEFAULT false,

  -- Does all stock here require QA release before issue?
  qa_hold_flag        boolean NOT NULL DEFAULT false,

  active              boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NULL
);

COMMENT ON TABLE erp_inventory.storage_location_master IS
'Global storage location registry. SA-owned. Plant mapping via storage_location_plant_map.';

COMMIT;
