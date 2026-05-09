/*
 * File-ID: 12B.2
 * File-Path: supabase/migrations/20260509201000_gate12b_machine_master.sql
 * Gate: 12B
 * Phase: 12B
 * Domain: MASTER
 * Purpose: Machine/mixer master table for SA-governed plant equipment.
 * Authority: Backend
 */

BEGIN;

CREATE TABLE IF NOT EXISTS erp_master.machine_master (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Plant this machine belongs to (references erp_master.projects)
  plant_id            uuid NOT NULL,

  machine_code        text NOT NULL,
  machine_name        text NOT NULL,

  -- Type of machine
  machine_type        text NOT NULL
    CHECK (machine_type IN ('MIXER','FILLING','PACKAGING','REACTOR','OTHER')),

  -- Optional capacity info
  capacity_per_batch  numeric NULL CHECK (capacity_per_batch > 0),
  capacity_uom_code   text NULL,

  description         text NULL,
  active              boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NULL,

  UNIQUE (plant_id, machine_code)
);

CREATE INDEX IF NOT EXISTS idx_mm_plant  ON erp_master.machine_master (plant_id);
CREATE INDEX IF NOT EXISTS idx_mm_active ON erp_master.machine_master (active);
CREATE INDEX IF NOT EXISTS idx_mm_type   ON erp_master.machine_master (machine_type);

COMMENT ON TABLE erp_master.machine_master IS
'SA-owned machine/mixer master. Plant-scoped. Process orders require machine assignment before saving.';

GRANT SELECT, INSERT, UPDATE ON erp_master.machine_master TO service_role;

COMMIT;
