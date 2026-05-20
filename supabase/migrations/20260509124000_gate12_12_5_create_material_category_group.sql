/*
 * File-ID: 12.5
 * File-Path: supabase/migrations/20260509124000_gate12_12_5_create_material_category_group.sql
 * Gate: 12
 * Phase: 12
 * Domain: MASTER
 * Purpose: Create material category groups and group membership with one active primary material per group.
 * Authority: Backend
 */

BEGIN;

CREATE TABLE IF NOT EXISTS erp_master.material_category_group (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_code  text NOT NULL UNIQUE,
  group_name  text NOT NULL,
  description text NULL,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid NULL
);

CREATE TABLE IF NOT EXISTS erp_master.material_category_group_member (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    uuid NOT NULL
    REFERENCES erp_master.material_category_group(id)
    ON DELETE RESTRICT,
  material_id uuid NOT NULL
    REFERENCES erp_master.material_master(id)
    ON DELETE RESTRICT,

  -- Only one material can be primary per group
  is_primary  boolean NOT NULL DEFAULT false,

  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid NULL,

  UNIQUE (group_id, material_id)
);

COMMENT ON TABLE erp_master.material_category_group IS
'Groups functionally equivalent materials. Used for aggregate planning only. BOM references specific materials, not groups.';

-- Only one primary material per group
CREATE UNIQUE INDEX IF NOT EXISTS idx_mcgm_one_primary
  ON erp_master.material_category_group_member (group_id)
  WHERE is_primary = true AND active = true;

COMMIT;
