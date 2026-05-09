/*
 * File-ID: 11.13
 * File-Path: supabase/migrations/20260509112000_gate11_11_13_create_stock_snapshot.sql
 * Gate: 11
 * Phase: 11
 * Domain: INVENTORY
 * Purpose: Create the stock_snapshot table for fast-read current stock balances.
 * Authority: Backend
 */

BEGIN;

CREATE TABLE IF NOT EXISTS erp_inventory.stock_snapshot (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Stock position key (unique combination)
  company_id            uuid NOT NULL,
  plant_id              uuid NOT NULL,
  storage_location_id   uuid NOT NULL
    REFERENCES erp_inventory.storage_location_master(id)
    ON DELETE RESTRICT,
  material_id           uuid NOT NULL,
  batch_id              uuid NULL,
  stock_type_code       text NOT NULL,

  -- Current quantity and value
  quantity              numeric(20, 6) NOT NULL DEFAULT 0,
  base_uom_code         text NOT NULL,
  value                 numeric(20, 4) NOT NULL DEFAULT 0,

  -- Current weighted average rate (recalculated on every IN movement)
  valuation_rate        numeric(20, 6) NOT NULL DEFAULT 0,

  -- Reference to last ledger entry that updated this snapshot
  last_ledger_id        uuid NULL
    REFERENCES erp_inventory.stock_ledger(id),

  last_updated_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE erp_inventory.stock_snapshot IS
'Fast-read current stock position. Updated on every posting. Read from here for UI. Audit from stock_ledger. Must reconcile with ledger at all times.';

COMMENT ON COLUMN erp_inventory.stock_snapshot.valuation_rate IS
'Current weighted average valuation rate for this stock position. Recalculated on every IN movement.';

CREATE INDEX IF NOT EXISTS idx_ss_company_plant_material
  ON erp_inventory.stock_snapshot (company_id, plant_id, material_id);

CREATE INDEX IF NOT EXISTS idx_ss_location_type
  ON erp_inventory.stock_snapshot (storage_location_id, stock_type_code);

CREATE INDEX IF NOT EXISTS idx_ss_material_all_plants
  ON erp_inventory.stock_snapshot (material_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ss_unique_stock_position
  ON erp_inventory.stock_snapshot (
    company_id,
    plant_id,
    storage_location_id,
    material_id,
    stock_type_code,
    COALESCE(batch_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

COMMIT;
