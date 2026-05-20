/*
 * File-ID: 11.7
 * File-Path: supabase/migrations/20260509106000_gate11_11_7_create_storage_location_plant_map.sql
 * Gate: 11
 * Phase: 11
 * Domain: INVENTORY
 * Purpose: Create the storage_location_plant_map table for plant-specific location rules.
 * Authority: Backend
 */

BEGIN;

CREATE TABLE IF NOT EXISTS erp_inventory.storage_location_plant_map (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  storage_location_id     uuid NOT NULL
    REFERENCES erp_inventory.storage_location_master(id)
    ON DELETE RESTRICT,

  -- References erp_master.companies
  company_id              uuid NOT NULL,

  -- References erp_master.projects (plant = project in PACE)
  plant_id                uuid NOT NULL,

  -- Is this location the default landing spot for GRN at this plant?
  is_default_grn_location boolean NOT NULL DEFAULT false,

  -- Comma-separated or array of allowed stock type codes for this location+plant
  -- e.g. ARRAY['UNRESTRICTED','QUALITY_INSPECTION']
  allowed_stock_types     text[] NOT NULL DEFAULT ARRAY['UNRESTRICTED'],

  active                  boolean NOT NULL DEFAULT true,
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid NULL,

  UNIQUE (storage_location_id, company_id, plant_id)
);

COMMENT ON TABLE erp_inventory.storage_location_plant_map IS
'Maps a global storage location to a company+plant. Defines allowed stock types per location per plant.';

-- Only one default GRN location per company+plant
CREATE UNIQUE INDEX IF NOT EXISTS idx_slpm_one_default_grn
  ON erp_inventory.storage_location_plant_map (company_id, plant_id)
  WHERE is_default_grn_location = true AND active = true;

COMMIT;
