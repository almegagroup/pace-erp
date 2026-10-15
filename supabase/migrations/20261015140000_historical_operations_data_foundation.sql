/*
 * Migration: 20261015140000_historical_operations_data_foundation
 * Purpose:   Private, auditable historical production and FG-dispatch data.
 *            Historical data is reporting-only: this migration does not touch
 *            stock, inventory, valuation, GL, production or delivery tables.
 * Cutover:   historical source dates must be on or before 2026-09-30.
 */

BEGIN;

CREATE SCHEMA IF NOT EXISTS erp_history;
REVOKE ALL ON SCHEMA erp_history FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA erp_history TO service_role;

CREATE TABLE erp_history.import_batch (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid NOT NULL REFERENCES erp_master.companies(id) ON DELETE RESTRICT,
  record_kind          text NOT NULL CHECK (record_kind IN ('PRODUCTION', 'FG_DISPATCH')),
  source_system        text NOT NULL DEFAULT 'HISTORICAL_FILE',
  source_file_key      text NOT NULL CHECK (btrim(source_file_key) <> '' AND length(source_file_key) <= 300),
  source_file_name     text NULL,
  source_sheet_name    text NOT NULL CHECK (btrim(source_sheet_name) <> '' AND length(source_sheet_name) <= 300),
  source_checksum      text NULL,
  status               text NOT NULL DEFAULT 'COMMITTING'
                       CHECK (status IN ('COMMITTING', 'COMMITTED', 'COMMITTED_WITH_EXCEPTIONS', 'FAILED')),
  submitted_row_count  integer NOT NULL DEFAULT 0 CHECK (submitted_row_count >= 0),
  imported_row_count   integer NOT NULL DEFAULT 0 CHECK (imported_row_count >= 0),
  exception_row_count  integer NOT NULL DEFAULT 0 CHECK (exception_row_count >= 0),
  normalized_kg_total  numeric(20,6) NULL CHECK (normalized_kg_total IS NULL OR normalized_kg_total >= 0),
  reconciliation       jsonb NOT NULL DEFAULT '{}'::jsonb,
  validation_metadata  jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by           uuid NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  committed_at         timestamptz NULL
);
CREATE INDEX ix_history_import_batch_company_created ON erp_history.import_batch (company_id, created_at DESC);
CREATE INDEX ix_history_import_batch_source ON erp_history.import_batch (company_id, record_kind, source_file_key, source_sheet_name);

CREATE TABLE erp_history.production_actual (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id               uuid NOT NULL REFERENCES erp_master.companies(id) ON DELETE RESTRICT,
  first_import_batch_id    uuid NOT NULL REFERENCES erp_history.import_batch(id) ON DELETE RESTRICT,
  last_import_batch_id     uuid NOT NULL REFERENCES erp_history.import_batch(id) ON DELETE RESTRICT,
  source_system            text NOT NULL,
  source_file_key          text NOT NULL,
  source_sheet_name        text NOT NULL,
  source_row_number        integer NOT NULL CHECK (source_row_number > 0),
  source_line_key          text NOT NULL DEFAULT '',
  source_production_date   text NULL,
  production_date          date NULL CHECK (production_date <= DATE '2026-09-30'),
  plant_source_id          text NULL,
  external_sku             text NOT NULL CHECK (btrim(external_sku) <> ''),
  material_id              uuid NULL REFERENCES erp_master.material_master(id) ON DELETE RESTRICT,
  prodshade                text NULL,
  product_description      text NULL,
  shift                    text NULL,
  machine                  text NULL,
  stroke_reference         text NULL,
  process_order_reference  text NULL,
  original_quantity        numeric(20,6) NULL CHECK (original_quantity IS NULL OR original_quantity >= 0),
  original_uom             text NULL,
  normalized_kg            numeric(20,6) NULL CHECK (normalized_kg IS NULL OR normalized_kg >= 0),
  validation_status        text NOT NULL DEFAULT 'VALIDATED'
                           CHECK (validation_status IN ('VALIDATED', 'UNMAPPED', 'QUARANTINED')),
  source_payload           jsonb NOT NULL DEFAULT '{}'::jsonb,
  validation_metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_revision_count    integer NOT NULL DEFAULT 1 CHECK (source_revision_count >= 1),
  imported_at              timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_history_production_source_row
    UNIQUE (company_id, source_system, source_file_key, source_sheet_name, source_row_number, source_line_key)
);
CREATE INDEX ix_history_production_company_date_material ON erp_history.production_actual (company_id, production_date, material_id);
CREATE INDEX ix_history_production_company_date_sku ON erp_history.production_actual (company_id, production_date, external_sku);
CREATE INDEX ix_history_production_batch ON erp_history.production_actual (last_import_batch_id);

CREATE TABLE erp_history.fg_dispatch_actual (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id               uuid NOT NULL REFERENCES erp_master.companies(id) ON DELETE RESTRICT,
  first_import_batch_id    uuid NOT NULL REFERENCES erp_history.import_batch(id) ON DELETE RESTRICT,
  last_import_batch_id     uuid NOT NULL REFERENCES erp_history.import_batch(id) ON DELETE RESTRICT,
  source_system            text NOT NULL,
  source_file_key          text NOT NULL,
  source_sheet_name        text NOT NULL,
  source_row_number        integer NOT NULL CHECK (source_row_number > 0),
  source_line_key          text NOT NULL DEFAULT '',
  source_dispatch_date     text NULL,
  dispatch_date            date NULL CHECK (dispatch_date <= DATE '2026-09-30'),
  external_sku             text NOT NULL CHECK (btrim(external_sku) <> ''),
  material_id              uuid NULL REFERENCES erp_master.material_master(id) ON DELETE RESTRICT,
  product_description      text NULL,
  dispatch_category        text NULL CHECK (dispatch_category IS NULL OR dispatch_category IN ('DIRECT', 'DEPOT')),
  mdn                      text NULL,
  invoice_number           text NULL,
  order_reference          text NULL,
  consignee                text NULL,
  depot_code               text NULL,
  original_quantity        numeric(20,6) NULL CHECK (original_quantity IS NULL OR original_quantity >= 0),
  original_uom             text NULL,
  normalized_dispatched_kg numeric(20,6) NULL CHECK (normalized_dispatched_kg IS NULL OR normalized_dispatched_kg >= 0),
  original_dispatch_status text NULL,
  cancellation_flag        boolean NOT NULL DEFAULT false,
  stock_posting_status     text NOT NULL DEFAULT 'UNKNOWN'
                           CHECK (stock_posting_status IN ('UNKNOWN', 'POSTED', 'NOT_POSTED')),
  stock_posting_evidence   jsonb NOT NULL DEFAULT '{}'::jsonb,
  validation_status        text NOT NULL DEFAULT 'VALIDATED'
                           CHECK (validation_status IN ('VALIDATED', 'UNMAPPED', 'QUARANTINED')),
  source_payload           jsonb NOT NULL DEFAULT '{}'::jsonb,
  validation_metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_revision_count    integer NOT NULL DEFAULT 1 CHECK (source_revision_count >= 1),
  imported_at              timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_history_dispatch_source_row
    UNIQUE (company_id, source_system, source_file_key, source_sheet_name, source_row_number, source_line_key)
);
CREATE INDEX ix_history_dispatch_company_date_material ON erp_history.fg_dispatch_actual (company_id, dispatch_date, material_id)
  WHERE NOT cancellation_flag AND validation_status <> 'QUARANTINED';
CREATE INDEX ix_history_dispatch_company_date_sku ON erp_history.fg_dispatch_actual (company_id, dispatch_date, external_sku)
  WHERE NOT cancellation_flag AND validation_status <> 'QUARANTINED';
CREATE INDEX ix_history_dispatch_invoice ON erp_history.fg_dispatch_actual (company_id, invoice_number, dispatch_date)
  WHERE invoice_number IS NOT NULL;
CREATE INDEX ix_history_dispatch_batch ON erp_history.fg_dispatch_actual (last_import_batch_id);

CREATE TABLE erp_history.import_exception (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_batch_id      uuid NOT NULL REFERENCES erp_history.import_batch(id) ON DELETE CASCADE,
  company_id           uuid NOT NULL REFERENCES erp_master.companies(id) ON DELETE RESTRICT,
  record_kind          text NOT NULL CHECK (record_kind IN ('PRODUCTION', 'FG_DISPATCH')),
  source_file_key      text NOT NULL,
  source_sheet_name    text NOT NULL,
  source_row_number    integer NULL CHECK (source_row_number IS NULL OR source_row_number > 0),
  source_line_key      text NOT NULL DEFAULT '',
  exception_code       text NOT NULL,
  exception_message    text NOT NULL,
  source_payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  validation_metadata  jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolved_at          timestamptz NULL,
  resolved_by          uuid NULL,
  resolution_note      text NULL,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_history_exception_batch ON erp_history.import_exception (import_batch_id, created_at);
CREATE INDEX ix_history_exception_open ON erp_history.import_exception (company_id, record_kind, created_at DESC)
  WHERE resolved_at IS NULL;

-- Corrected re-imports update exactly one stable source row and retain the
-- original batch reference.  No operational ERP tables are reachable here.
CREATE OR REPLACE FUNCTION erp_history.preserve_actual_import_origin()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.first_import_batch_id := OLD.first_import_batch_id;
  NEW.source_revision_count := OLD.source_revision_count + 1;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_history_production_preserve_origin
  BEFORE UPDATE ON erp_history.production_actual
  FOR EACH ROW EXECUTE FUNCTION erp_history.preserve_actual_import_origin();
CREATE TRIGGER trg_history_dispatch_preserve_origin
  BEFORE UPDATE ON erp_history.fg_dispatch_actual
  FOR EACH ROW EXECUTE FUNCTION erp_history.preserve_actual_import_origin();

ALTER TABLE erp_history.import_batch ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_history.production_actual ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_history.fg_dispatch_actual ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_history.import_exception ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA erp_history FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON erp_history.import_batch TO service_role;
GRANT SELECT, INSERT, UPDATE ON erp_history.production_actual TO service_role;
GRANT SELECT, INSERT, UPDATE ON erp_history.fg_dispatch_actual TO service_role;
GRANT SELECT, INSERT, UPDATE ON erp_history.import_exception TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
