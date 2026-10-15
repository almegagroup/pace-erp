/*
 * Migration: 20261015180000_historical_procurement_and_lead_time
 * (Renumbered from 20261015150000: that version is already used on PROD by
 *  po_hss_mother_company. This file was never applied to DEV or PROD.)
 *
 * Historical procurement facts for analytical reporting only.
 * These tables are deliberately outside live procurement/inventory schemas:
 * no live PO, CSN, GRN, stock, valuation, GL or in-transit balance can be affected.
 *
 * Identity (stable across re-sorted sheets and corrections):
 *   purchase_order        (company_id, source_system, external_po_number)
 *   purchase_order_line   (purchase_order_id, external_line_reference)
 *   consignment_movement  (company_id, source_system, source_record_key)
 * source_file_key / source_sheet_name / source_row_number are lineage only.
 * Procurement dates are NOT cut off at 2026-09-30: overlap with ERP is
 * reconciled record by record, not by an unconditional date rule.
 */
BEGIN;

ALTER TABLE erp_history.import_batch
  DROP CONSTRAINT IF EXISTS import_batch_record_kind_check;
ALTER TABLE erp_history.import_batch
  ADD CONSTRAINT import_batch_record_kind_check
  CHECK (record_kind IN ('PRODUCTION', 'FG_DISPATCH', 'PURCHASE_ORDER', 'CONSIGNMENT_MOVEMENT'));

ALTER TABLE erp_history.import_exception
  DROP CONSTRAINT IF EXISTS import_exception_record_kind_check;
ALTER TABLE erp_history.import_exception
  ADD CONSTRAINT import_exception_record_kind_check
  CHECK (record_kind IN ('PRODUCTION', 'FG_DISPATCH', 'PURCHASE_ORDER', 'CONSIGNMENT_MOVEMENT'));

-- Idempotent replay: the same request (same checksum) is never committed twice.
CREATE INDEX IF NOT EXISTS ix_history_import_batch_checksum
  ON erp_history.import_batch (company_id, record_kind, source_checksum)
  WHERE source_checksum IS NOT NULL;

CREATE TABLE erp_history.purchase_order (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id               uuid NOT NULL REFERENCES erp_master.companies(id) ON DELETE RESTRICT,
  first_import_batch_id    uuid NOT NULL REFERENCES erp_history.import_batch(id) ON DELETE RESTRICT,
  last_import_batch_id     uuid NOT NULL REFERENCES erp_history.import_batch(id) ON DELETE RESTRICT,
  source_system            text NOT NULL,
  source_file_key          text NOT NULL,
  source_sheet_name        text NOT NULL,
  source_row_number        integer NOT NULL CHECK (source_row_number > 0),
  external_po_number       text NOT NULL CHECK (btrim(external_po_number) <> ''),
  revised_po_number        text NULL,
  order_date               date NULL,
  supplier_name            text NULL,
  vendor_code              text NULL,
  vendor_id                uuid NULL REFERENCES erp_master.vendor_master(id) ON DELETE RESTRICT,
  supply_type              text NULL CHECK (supply_type IS NULL OR supply_type IN ('LOCAL', 'IMPORT')),
  payment_terms            text NULL,
  payment_days             numeric(12,3) NULL CHECK (payment_days IS NULL OR payment_days >= 0),
  currency_code            text NULL,
  original_status          text NULL,
  cancellation_flag        boolean NOT NULL DEFAULT false,
  validation_status        text NOT NULL DEFAULT 'VALIDATED'
                           CHECK (validation_status IN ('VALIDATED', 'UNMAPPED', 'QUARANTINED')),
  source_payload           jsonb NOT NULL DEFAULT '{}'::jsonb,
  validation_metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_revision_count    integer NOT NULL DEFAULT 1 CHECK (source_revision_count >= 1),
  imported_at              timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_history_purchase_order_identity UNIQUE (company_id, source_system, external_po_number)
);
CREATE INDEX ix_history_po_company_date ON erp_history.purchase_order (company_id, order_date);
CREATE INDEX ix_history_po_batch ON erp_history.purchase_order (last_import_batch_id);

CREATE TABLE erp_history.purchase_order_line (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id        uuid NOT NULL REFERENCES erp_history.purchase_order(id) ON DELETE RESTRICT,
  company_id               uuid NOT NULL REFERENCES erp_master.companies(id) ON DELETE RESTRICT,
  first_import_batch_id    uuid NOT NULL REFERENCES erp_history.import_batch(id) ON DELETE RESTRICT,
  last_import_batch_id     uuid NOT NULL REFERENCES erp_history.import_batch(id) ON DELETE RESTRICT,
  source_system            text NOT NULL,
  source_file_key          text NOT NULL,
  source_sheet_name        text NOT NULL,
  source_row_number        integer NOT NULL CHECK (source_row_number > 0),
  external_line_reference  text NOT NULL CHECK (btrim(external_line_reference) <> ''),
  material_code            text NULL,
  material_id              uuid NULL REFERENCES erp_master.material_master(id) ON DELETE RESTRICT,
  item_description         text NULL,
  original_quantity        numeric(20,6) NULL CHECK (original_quantity IS NULL OR original_quantity >= 0),
  original_uom             text NULL,
  normalized_kg            numeric(20,6) NULL CHECK (normalized_kg IS NULL OR normalized_kg >= 0),
  unit_rate                numeric(20,6) NULL CHECK (unit_rate IS NULL OR unit_rate >= 0),
  validation_status        text NOT NULL DEFAULT 'VALIDATED'
                           CHECK (validation_status IN ('VALIDATED', 'UNMAPPED', 'QUARANTINED')),
  source_payload           jsonb NOT NULL DEFAULT '{}'::jsonb,
  validation_metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_revision_count    integer NOT NULL DEFAULT 1 CHECK (source_revision_count >= 1),
  imported_at              timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_history_po_line_identity UNIQUE (purchase_order_id, external_line_reference)
);
CREATE INDEX ix_history_po_line_company_material ON erp_history.purchase_order_line (company_id, material_id);
CREATE INDEX ix_history_po_line_batch ON erp_history.purchase_order_line (last_import_batch_id);

CREATE TABLE erp_history.consignment_movement (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id               uuid NOT NULL REFERENCES erp_master.companies(id) ON DELETE RESTRICT,
  purchase_order_line_id   uuid NOT NULL REFERENCES erp_history.purchase_order_line(id) ON DELETE RESTRICT,
  first_import_batch_id    uuid NOT NULL REFERENCES erp_history.import_batch(id) ON DELETE RESTRICT,
  last_import_batch_id     uuid NOT NULL REFERENCES erp_history.import_batch(id) ON DELETE RESTRICT,
  source_system            text NOT NULL,
  source_file_key          text NOT NULL,
  source_sheet_name        text NOT NULL,
  source_row_number        integer NOT NULL CHECK (source_row_number > 0),
  source_record_key        text NOT NULL CHECK (btrim(source_record_key) <> ''),
  consignment_reference    text NULL,
  invoice_number           text NULL,
  bl_number                text NULL,
  mdn_number               text NULL,
  supply_type              text NULL CHECK (supply_type IS NULL OR supply_type IN ('LOCAL', 'IMPORT')),
  dispatch_date            date NULL,
  etd_date                 date NULL,
  atd_date                 date NULL,
  eta_port_date            date NULL,
  ata_port_date            date NULL,
  boe_date                 date NULL,
  lr_date                  date NULL,
  inward_date              date NULL,
  original_quantity        numeric(20,6) NULL CHECK (original_quantity IS NULL OR original_quantity >= 0),
  original_uom             text NULL,
  normalized_kg            numeric(20,6) NULL CHECK (normalized_kg IS NULL OR normalized_kg >= 0),
  cancellation_flag        boolean NOT NULL DEFAULT false,
  validation_status        text NOT NULL DEFAULT 'VALIDATED'
                           CHECK (validation_status IN ('VALIDATED', 'UNMAPPED', 'QUARANTINED')),
  source_payload           jsonb NOT NULL DEFAULT '{}'::jsonb,
  validation_metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_revision_count    integer NOT NULL DEFAULT 1 CHECK (source_revision_count >= 1),
  imported_at              timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_history_consignment_identity UNIQUE (company_id, source_system, source_record_key)
);
CREATE INDEX ix_history_consignment_company_inward ON erp_history.consignment_movement (company_id, inward_date)
  WHERE NOT cancellation_flag AND validation_status = 'VALIDATED';
CREATE INDEX ix_history_consignment_po_line ON erp_history.consignment_movement (purchase_order_line_id);
CREATE INDEX ix_history_consignment_batch ON erp_history.consignment_movement (last_import_batch_id);

CREATE OR REPLACE FUNCTION erp_history.preserve_procurement_import_origin()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = erp_history, pg_temp
AS $$
BEGIN
  NEW.first_import_batch_id := OLD.first_import_batch_id;
  NEW.source_revision_count := OLD.source_revision_count + 1;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_history_po_preserve_origin BEFORE UPDATE ON erp_history.purchase_order
  FOR EACH ROW EXECUTE FUNCTION erp_history.preserve_procurement_import_origin();
CREATE TRIGGER trg_history_po_line_preserve_origin BEFORE UPDATE ON erp_history.purchase_order_line
  FOR EACH ROW EXECUTE FUNCTION erp_history.preserve_procurement_import_origin();
CREATE TRIGGER trg_history_consignment_preserve_origin BEFORE UPDATE ON erp_history.consignment_movement
  FOR EACH ROW EXECUTE FUNCTION erp_history.preserve_procurement_import_origin();

ALTER TABLE erp_history.purchase_order ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_history.purchase_order_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_history.consignment_movement ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON erp_history.purchase_order, erp_history.purchase_order_line, erp_history.consignment_movement FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON erp_history.purchase_order, erp_history.purchase_order_line, erp_history.consignment_movement TO service_role;

COMMIT;
