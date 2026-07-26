/*
 * Migration: 20260711120000_gate27_processpo_full_chain
 * Gate: 27.6
 * Purpose: Add Process PO full-chain machine, final/verify, and reco schema support.
 */

BEGIN;

ALTER TABLE erp_production.process_order
  ADD COLUMN IF NOT EXISTS machine_id UUID REFERENCES erp_master.machine_master(id),
  ADD COLUMN IF NOT EXISTS has_unapproved_deviation BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS qi_release_stock_ledger_id UUID,
  ADD COLUMN IF NOT EXISTS reverse_reason TEXT; -- CORS (PR15) reason, mandatory per §83.4 "Reason mandatory at every CORS action"

ALTER TABLE erp_production.process_order_line
  ADD COLUMN IF NOT EXISTS actual_material_id UUID REFERENCES erp_master.material_master(id),
  ADD COLUMN IF NOT EXISTS dosage_pct NUMERIC,
  ADD COLUMN IF NOT EXISTS is_formulation_line BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS approved_status TEXT
    CHECK (approved_status IS NULL OR approved_status = ANY (ARRAY['YES','NO','PARTIAL'])),
  ADD COLUMN IF NOT EXISTS ap_approved_qty NUMERIC,
  ADD COLUMN IF NOT EXISTS variance_qty NUMERIC;

CREATE TABLE IF NOT EXISTS erp_production.process_order_line_reco (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            UUID NOT NULL REFERENCES erp_master.companies(id),
  po_number             TEXT NOT NULL,
  batch_number          TEXT,
  po_type               TEXT NOT NULL,
  prodshade_material_id UUID NOT NULL REFERENCES erp_master.material_master(id),
  stroke_number         TEXT,
  machine_id            UUID REFERENCES erp_master.machine_master(id),
  segment_code          TEXT,
  batch_started_at      TIMESTAMPTZ,
  verified_at           TIMESTAMPTZ,
  process_order_id      UUID NOT NULL REFERENCES erp_production.process_order(id),
  process_order_line_id UUID NOT NULL REFERENCES erp_production.process_order_line(id),
  material_id           UUID NOT NULL REFERENCES erp_master.material_master(id),
  line_material_type    TEXT NOT NULL DEFAULT 'RM' CHECK (line_material_type = ANY (ARRAY['RM','INT'])),
  dosage_pct            NUMERIC,
  actual_material_id    UUID REFERENCES erp_master.material_master(id),
  storage_location_id   UUID REFERENCES erp_inventory.storage_location_master(id),
  standard_qty          NUMERIC,
  actual_qty            NUMERIC NOT NULL,
  approved_status       TEXT NOT NULL CHECK (approved_status = ANY (ARRAY['YES','NO','PARTIAL'])),
  ap_approved_qty       NUMERIC NOT NULL,
  variance_qty          NUMERIC NOT NULL,
  is_formulation_line   BOOLEAN NOT NULL DEFAULT true,
  is_voided             BOOLEAN NOT NULL DEFAULT false,
  voided_at             TIMESTAMPTZ,
  last_updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_updated_by       UUID
);

CREATE INDEX IF NOT EXISTS ix_po_line_reco_order ON erp_production.process_order_line_reco (process_order_id, is_voided);
CREATE INDEX IF NOT EXISTS ix_po_line_reco_company ON erp_production.process_order_line_reco (company_id, po_number);

GRANT ALL ON TABLE erp_production.process_order_line_reco TO service_role;

COMMIT;
