/*
 * File-ID: 12.3
 * File-Path: supabase/migrations/20260509122000_gate12_12_3_create_material_uom_conversion.sql
 * Gate: 12
 * Phase: 12
 * Domain: MASTER
 * Purpose: Create the per-material UOM conversion table for purchase and issue conversions.
 * Authority: Backend
 */

BEGIN;

CREATE TABLE IF NOT EXISTS erp_master.material_uom_conversion (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  material_id           uuid NOT NULL
    REFERENCES erp_master.material_master(id)
    ON DELETE RESTRICT,

  from_uom_code         text NOT NULL
    REFERENCES erp_master.uom_master(code)
    ON DELETE RESTRICT,

  to_uom_code           text NOT NULL
    REFERENCES erp_master.uom_master(code)
    ON DELETE RESTRICT,

  -- How many 'to_uom' units = 1 'from_uom' unit?
  -- e.g. from=BAG, to=KG, factor=25 -> 1 BAG = 25 KG
  conversion_factor     numeric(20, 6) NOT NULL CHECK (conversion_factor > 0),

  -- If true: conversion factor is entered at GRN time (varies per receipt)
  -- e.g. bags where actual weight varies
  variable_conversion   boolean NOT NULL DEFAULT false,

  active                boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid NULL,

  UNIQUE (material_id, from_uom_code, to_uom_code)
);

COMMENT ON TABLE erp_master.material_uom_conversion IS
'Per-material UOM conversion. variable_conversion=true means actual factor entered at GRN time (for variable-weight bags).';

CREATE INDEX IF NOT EXISTS idx_muom_material ON erp_master.material_uom_conversion (material_id);

COMMIT;
