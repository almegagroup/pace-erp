/*
 * File-ID: 11.12
 * File-Path: supabase/migrations/20260509111000_gate11_11_12_create_stock_ledger.sql
 * Gate: 11
 * Phase: 11
 * Domain: INVENTORY
 * Purpose: Create the append-only stock_ledger table and immutability rules.
 * Authority: Backend
 */

BEGIN;

CREATE TABLE IF NOT EXISTS erp_inventory.stock_ledger (
  -- Sequential ID for ordering (bigserial, not UUID, for correct ordering)
  ledger_seq              bigserial NOT NULL,
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Reference to the stock document that created this ledger entry
  stock_document_id       uuid NOT NULL
    REFERENCES erp_inventory.stock_document(id)
    ON DELETE RESTRICT,

  posting_date            date NOT NULL,

  -- Stock position
  company_id              uuid NOT NULL,
  plant_id                uuid NOT NULL,
  storage_location_id     uuid NOT NULL
    REFERENCES erp_inventory.storage_location_master(id)
    ON DELETE RESTRICT,
  material_id             uuid NOT NULL,
  batch_id                uuid NULL,
  stock_type_code         text NOT NULL,

  -- Movement
  movement_type_code      text NOT NULL,

  -- IN = stock received, OUT = stock consumed/issued
  direction               text NOT NULL CHECK (direction IN ('IN', 'OUT')),

  -- Always positive (direction field indicates sign)
  quantity                numeric(20, 6) NOT NULL CHECK (quantity > 0),
  base_uom_code           text NOT NULL,

  -- Always positive monetary value
  value                   numeric(20, 4) NOT NULL DEFAULT 0,
  valuation_rate          numeric(20, 6) NOT NULL DEFAULT 0,

  -- Audit - who posted this entry
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid NOT NULL
);

COMMENT ON TABLE erp_inventory.stock_ledger IS
'APPEND-ONLY source of truth for all stock movements. Rows are never updated or deleted. Every stock position is derived from this table.';

COMMENT ON COLUMN erp_inventory.stock_ledger.ledger_seq IS
'Sequential integer for correct ordering of ledger entries. Use this for historical balance calculations, not created_at.';

COMMENT ON COLUMN erp_inventory.stock_ledger.direction IS
'IN = stock added to position. OUT = stock removed from position. Quantity is always positive.';

CREATE OR REPLACE RULE stock_ledger_no_update AS
  ON UPDATE TO erp_inventory.stock_ledger
  DO INSTEAD NOTHING;

CREATE OR REPLACE RULE stock_ledger_no_delete AS
  ON DELETE TO erp_inventory.stock_ledger
  DO INSTEAD NOTHING;

CREATE INDEX IF NOT EXISTS idx_sl_company_plant_material
  ON erp_inventory.stock_ledger (company_id, plant_id, material_id);

CREATE INDEX IF NOT EXISTS idx_sl_location_stock_type
  ON erp_inventory.stock_ledger (storage_location_id, stock_type_code);

CREATE INDEX IF NOT EXISTS idx_sl_posting_date
  ON erp_inventory.stock_ledger (posting_date);

CREATE INDEX IF NOT EXISTS idx_sl_stock_document
  ON erp_inventory.stock_ledger (stock_document_id);

CREATE INDEX IF NOT EXISTS idx_sl_batch
  ON erp_inventory.stock_ledger (batch_id)
  WHERE batch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sl_seq
  ON erp_inventory.stock_ledger (ledger_seq);

COMMIT;
