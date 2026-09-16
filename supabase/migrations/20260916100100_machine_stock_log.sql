/*
 * File-Path: supabase/migrations/20260916100100_machine_stock_log.sql
 * Domain: PRODUCTION / INVENTORY
 * Purpose: machine_stock_log side-table (feasibility doc §138.6) -- tracks
 *          per-machine "bucket" attribution for MTS shop floor stock,
 *          without touching stock_ledger/stock_snapshot/reservation_document
 *          (those stay fully machine-agnostic, per §138.6's own decision).
 *
 *          machine_id NULL = the "Unassigned" bucket (§138.3) -- every
 *          (company, storage_location, material) combination has exactly
 *          one Unassigned bucket plus one bucket per real machine.
 *
 *          No writers exist yet -- Transfer (§138-Phase-2, pull-list design
 *          pending) and Consumption (§138-Phase-3, Standard hard-block
 *          conditions pending) are what will populate this table. This
 *          migration only creates the structure per the locked schema.
 * Authority: Backend
 */

BEGIN;

CREATE TABLE IF NOT EXISTS erp_production.machine_stock_log (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  company_id                uuid NOT NULL,
  storage_location_id       uuid NOT NULL
    REFERENCES erp_inventory.storage_location_master(id),
  material_id               uuid NOT NULL
    REFERENCES erp_master.material_master(id),

  -- NULL = Unassigned bucket (§138.3). Non-NULL = that specific machine's bucket.
  machine_id                uuid NULL
    REFERENCES erp_master.machine_master(id),

  batch_number              text NULL,

  qty                       numeric(18, 4) NOT NULL CHECK (qty > 0),
  direction                 text NOT NULL CHECK (direction IN ('IN', 'OUT')),

  -- TRANSFER: warehouse->shop floor, always lands Unassigned.
  -- CONSUMPTION: normal-case (machine bucket OUT) or exception-case (Unassigned
  --   bucket OUT, machine_id is an informational tag only, §138.4) -- both the
  --   same source_type, distinguished by whether machine_id is set.
  -- PID_ADJUSTMENT: physical inventory variance correction, whichever bucket.
  -- MANUAL_ALLOT: pure attribution move, no stock_ledger posting -- paired
  --   double-entry (Unassigned OUT + target machine IN), linked via a shared
  --   reference_document_id.
  source_type               text NOT NULL
    CHECK (source_type IN ('TRANSFER', 'CONSUMPTION', 'PID_ADJUSTMENT', 'MANUAL_ALLOT')),

  reference_document_type   text NULL,
  reference_document_id     uuid NULL,

  created_by                uuid NULL,
  created_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_machine_stock_log_bucket
  ON erp_production.machine_stock_log (company_id, storage_location_id, material_id, machine_id);

CREATE INDEX IF NOT EXISTS idx_machine_stock_log_batch
  ON erp_production.machine_stock_log (batch_number)
  WHERE batch_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_machine_stock_log_reference
  ON erp_production.machine_stock_log (reference_document_type, reference_document_id)
  WHERE reference_document_id IS NOT NULL;

COMMENT ON TABLE erp_production.machine_stock_log IS
'Per-machine stock "bucket" attribution for MTS machine-respect shop floor tracking (feasibility doc §138.3/§138.6). machine_id NULL = the Unassigned bucket. stock_ledger/stock_snapshot/reservation_document remain fully machine-agnostic -- this is a reporting/attribution layer only, not a core posting engine change.';

GRANT SELECT, INSERT, UPDATE, DELETE ON erp_production.machine_stock_log TO service_role;

COMMIT;
