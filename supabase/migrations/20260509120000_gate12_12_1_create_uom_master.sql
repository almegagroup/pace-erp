/*
 * File-ID: 12.1
 * File-Path: supabase/migrations/20260509120000_gate12_12_1_create_uom_master.sql
 * Gate: 12
 * Phase: 12
 * Domain: MASTER
 * Purpose: Create the global UOM master and seed standard units of measure.
 * Authority: Backend
 */

BEGIN;

CREATE TABLE IF NOT EXISTS erp_master.uom_master (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- e.g. KG, L, NOS, BAG, DRM, PKT, MTR, MT
  code        text NOT NULL UNIQUE,
  name        text NOT NULL,

  -- WEIGHT, VOLUME, COUNT, LENGTH, PACKING
  uom_type    text NOT NULL CHECK (uom_type IN ('WEIGHT', 'VOLUME', 'COUNT', 'LENGTH', 'PACKING')),

  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid NULL
);

COMMENT ON TABLE erp_master.uom_master IS
'Global unit of measure master. All material UOM references must exist here.';

-- Seed standard UOMs
INSERT INTO erp_master.uom_master (code, name, uom_type) VALUES
  ('KG',  'Kilogram',       'WEIGHT'),
  ('G',   'Gram',           'WEIGHT'),
  ('MT',  'Metric Tonne',   'WEIGHT'),
  ('L',   'Litre',          'VOLUME'),
  ('ML',  'Millilitre',     'VOLUME'),
  ('NOS', 'Numbers/Pieces', 'COUNT'),
  ('MTR', 'Metre',          'LENGTH'),
  ('BAG', 'Bag',            'PACKING'),
  ('DRM', 'Drum',           'PACKING'),
  ('PKT', 'Packet',         'PACKING'),
  ('BOX', 'Box',            'PACKING'),
  ('CTN', 'Carton',         'PACKING'),
  ('CAN', 'Can',            'PACKING'),
  ('SET', 'Set',            'COUNT')
ON CONFLICT (code) DO NOTHING;

COMMIT;
