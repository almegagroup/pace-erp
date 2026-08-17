/*
 * File-Path: supabase/migrations/20260817040750_inventory_location_transfer_request_workbench.sql
 * Purpose: IN10/IN11 inventory location transfer request + posting workbench foundation.
 * Authority: Backend / Database
 */

BEGIN;

ALTER TABLE erp_production.reservation_document
  ADD COLUMN IF NOT EXISTS source_lot_ref text NULL;

COMMENT ON COLUMN erp_production.reservation_document.source_lot_ref IS
  'Optional exact lot identity for reservations where batch_number alone is insufficient, e.g. FG rows tied to a specific Packing PO lot.';

CREATE TABLE IF NOT EXISTS erp_inventory.location_transfer_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ltr_number text NOT NULL UNIQUE,
  company_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN', 'PARTIALLY_POSTED', 'POSTED', 'CANCELLED')),
  request_date date NOT NULL,
  required_by_date date NULL,
  remarks text NULL,
  cancelled_by uuid NULL,
  cancelled_at timestamptz NULL,
  cancellation_reason text NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_updated_by uuid NULL,
  last_updated_at timestamptz NULL
);

CREATE TABLE IF NOT EXISTS erp_inventory.location_transfer_request_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES erp_inventory.location_transfer_request(id) ON DELETE CASCADE,
  line_no integer NOT NULL,
  source_storage_location_id uuid NOT NULL,
  target_storage_location_id uuid NOT NULL,
  material_id uuid NOT NULL,
  requested_qty numeric(20,6) NOT NULL CHECK (requested_qty > 0),
  posted_qty numeric(20,6) NOT NULL DEFAULT 0 CHECK (posted_qty >= 0),
  uom_code text NOT NULL,
  stock_type_code text NOT NULL,
  batch_number text NULL,
  source_lot_ref text NULL,
  remarks text NULL,
  status text NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN', 'PARTIALLY_POSTED', 'POSTED', 'CANCELLED')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_updated_by uuid NULL,
  last_updated_at timestamptz NULL,
  CONSTRAINT location_transfer_request_line_unique_line UNIQUE (request_id, line_no),
  CONSTRAINT location_transfer_request_line_diff_sloc_ck CHECK (source_storage_location_id <> target_storage_location_id),
  CONSTRAINT location_transfer_request_line_posted_le_requested_ck CHECK (posted_qty <= requested_qty)
);

CREATE TABLE IF NOT EXISTS erp_inventory.location_transfer_posting (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES erp_inventory.location_transfer_request(id) ON DELETE CASCADE,
  request_line_id uuid NOT NULL REFERENCES erp_inventory.location_transfer_request_line(id) ON DELETE CASCADE,
  movement_type_code text NOT NULL CHECK (movement_type_code IN ('P311', 'P312')),
  posted_qty numeric(20,6) NOT NULL CHECK (posted_qty > 0),
  uom_code text NOT NULL,
  batch_number text NULL,
  source_lot_ref text NULL,
  material_doc_number text NOT NULL,
  material_doc_year text NOT NULL,
  stock_document_id_out uuid NULL,
  stock_document_id_in uuid NULL,
  reversal_of_posting_id uuid NULL REFERENCES erp_inventory.location_transfer_posting(id),
  remarks text NULL,
  posted_by uuid NOT NULL,
  posted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ltr_company_status_date
  ON erp_inventory.location_transfer_request (company_id, status, request_date DESC);

CREATE INDEX IF NOT EXISTS idx_ltr_company_created_at
  ON erp_inventory.location_transfer_request (company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ltr_line_request_status
  ON erp_inventory.location_transfer_request_line (request_id, status, line_no);

CREATE INDEX IF NOT EXISTS idx_ltr_line_material_scope
  ON erp_inventory.location_transfer_request_line (material_id, source_storage_location_id, target_storage_location_id);

CREATE INDEX IF NOT EXISTS idx_ltr_line_identity_grain
  ON erp_inventory.location_transfer_request_line (material_id, source_storage_location_id, stock_type_code, batch_number, source_lot_ref);

CREATE INDEX IF NOT EXISTS idx_ltr_posting_request_line
  ON erp_inventory.location_transfer_posting (request_line_id, posted_at DESC);

CREATE INDEX IF NOT EXISTS idx_ltr_posting_reverse_link
  ON erp_inventory.location_transfer_posting (reversal_of_posting_id)
  WHERE reversal_of_posting_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_reservation_location_transfer_identity
  ON erp_production.reservation_document (source_type, source_id, source_line_id, material_id, storage_location_id, status);

CREATE INDEX IF NOT EXISTS idx_reservation_location_transfer_lot
  ON erp_production.reservation_document (material_id, storage_location_id, batch_number, source_lot_ref, status)
  WHERE source_type = 'LOCATION_TRANSFER';

GRANT ALL ON erp_inventory.location_transfer_request TO service_role;
GRANT ALL ON erp_inventory.location_transfer_request_line TO service_role;
GRANT ALL ON erp_inventory.location_transfer_posting TO service_role;

ALTER TABLE erp_inventory.location_transfer_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_inventory.location_transfer_request_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_inventory.location_transfer_posting ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS backend_only ON erp_inventory.location_transfer_request;
CREATE POLICY backend_only ON erp_inventory.location_transfer_request
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS backend_only ON erp_inventory.location_transfer_request_line;
CREATE POLICY backend_only ON erp_inventory.location_transfer_request_line
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS backend_only ON erp_inventory.location_transfer_posting;
CREATE POLICY backend_only ON erp_inventory.location_transfer_posting
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false);

INSERT INTO erp_procurement.document_number_series (doc_type, starting_number, last_number, pad_width)
VALUES ('LTR', 7100000001, 0, 10)
ON CONFLICT (doc_type) DO UPDATE
  SET starting_number = EXCLUDED.starting_number,
      pad_width = EXCLUDED.pad_width
  WHERE erp_procurement.document_number_series.starting_number < EXCLUDED.starting_number;

UPDATE erp_procurement.document_number_series
SET last_number = 0
WHERE doc_type = 'LTR' AND last_number > 0 AND last_number < starting_number;

COMMIT;
