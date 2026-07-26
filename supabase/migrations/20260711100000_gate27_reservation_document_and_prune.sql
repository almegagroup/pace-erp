/*
 * Migration: 20260711100000_gate27_reservation_document_and_prune
 * Gate: 27.4
 * Purpose: Add Process PO reservation support plus STANDARD prune metadata.
 */

BEGIN;

CREATE SEQUENCE IF NOT EXISTS erp_production.reservation_number_seq;

CREATE TABLE IF NOT EXISTS erp_production.reservation_document (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_number  TEXT NOT NULL DEFAULT ('RESV' || lpad(nextval('erp_production.reservation_number_seq')::text, 8, '0')),
  source_type         TEXT NOT NULL DEFAULT 'PROCESS_PO'
                        CHECK (source_type = ANY (ARRAY['PROCESS_PO','PACKING_PO','SALES_ORDER','STO','LOCATION_TRANSFER'])),
  source_id           UUID NOT NULL,
  source_line_id      UUID,
  company_id          UUID NOT NULL REFERENCES erp_master.companies(id),
  material_id         UUID NOT NULL REFERENCES erp_master.material_master(id),
  storage_location_id UUID REFERENCES erp_inventory.storage_location_master(id),
  required_qty        NUMERIC NOT NULL CHECK (required_qty >= 0),
  uom_code            TEXT NOT NULL DEFAULT 'KG',
  required_by_date    DATE,
  issued_qty          NUMERIC NOT NULL DEFAULT 0 CHECK (issued_qty >= 0),
  balance_qty         NUMERIC GENERATED ALWAYS AS (required_qty - issued_qty) STORED,
  status              TEXT NOT NULL DEFAULT 'OPEN'
                        CHECK (status = ANY (ARRAY['OPEN','PARTIAL','FULLY_ISSUED','CANCELLED'])),
  created_by          UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_updated_by     UUID,
  last_updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_reservation_avail
  ON erp_production.reservation_document (material_id, company_id, storage_location_id, status);

CREATE INDEX IF NOT EXISTS ix_reservation_source
  ON erp_production.reservation_document (source_type, source_id);

GRANT ALL ON TABLE erp_production.reservation_document TO service_role;
GRANT USAGE, SELECT ON SEQUENCE erp_production.reservation_number_seq TO service_role;

ALTER TABLE erp_production.process_order
  ADD COLUMN IF NOT EXISTS prune_reason TEXT,
  ADD COLUMN IF NOT EXISTS pruned_by UUID,
  ADD COLUMN IF NOT EXISTS pruned_at TIMESTAMPTZ;

ALTER TABLE erp_production.process_order
  DROP CONSTRAINT IF EXISTS process_order_status_check;

ALTER TABLE erp_production.process_order
  ADD CONSTRAINT process_order_status_check
  CHECK (status = ANY (ARRAY['STANDARD','QA_APPROVED','QA_REJECTED','BATCH_STARTED','FINAL','VERIFIED','REVERSED','CANCELLED']));

COMMIT;
