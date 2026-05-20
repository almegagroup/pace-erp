/*
 * File-ID: 19.1.2
 * File-Path: supabase/migrations/20260512200100_gate19_19_1_2_create_opening_stock_tables.sql
 * Gate: 19
 * Phase: 19
 * Domain: PROCUREMENT
 * Purpose: Create opening stock migration document/line tables and seed OS document numbering.
 * Authority: Database
 */

BEGIN;

CREATE TABLE IF NOT EXISTS erp_procurement.opening_stock_document (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_number   text NOT NULL UNIQUE,
  company_id        uuid NOT NULL,
  plant_id          uuid NOT NULL,
  cut_off_date      date NOT NULL,
  status            text NOT NULL DEFAULT 'DRAFT'
                      CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'POSTED')),
  notes             text NULL,
  created_by        uuid NOT NULL,
  submitted_by      uuid NULL,
  submitted_at      timestamptz NULL,
  approved_by       uuid NULL,
  approved_at       timestamptz NULL,
  posted_by         uuid NULL,
  posted_at         timestamptz NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),

  UNIQUE (company_id, plant_id, cut_off_date)
);

COMMENT ON TABLE erp_procurement.opening_stock_document IS
'One-time opening stock migration document per company+plant+cut_off_date.';

CREATE TABLE IF NOT EXISTS erp_procurement.opening_stock_line (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id               uuid NOT NULL
    REFERENCES erp_procurement.opening_stock_document(id) ON DELETE RESTRICT,
  line_number               int NOT NULL,
  material_id               uuid NOT NULL,
  storage_location_id       uuid NOT NULL,
  stock_type                text NOT NULL
                              CHECK (stock_type IN ('UNRESTRICTED', 'QUALITY_INSPECTION', 'BLOCKED')),
  quantity                  numeric(18,4) NOT NULL CHECK (quantity > 0),
  rate_per_unit             numeric(18,4) NOT NULL CHECK (rate_per_unit >= 0),
  total_value               numeric(18,4) GENERATED ALWAYS AS (quantity * rate_per_unit) STORED,
  movement_type_code        text NOT NULL,
  posted_stock_document_id  uuid NULL,
  created_at                timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE erp_procurement.opening_stock_line IS
'Lines for opening stock document. Each line posts one stock movement.';

CREATE INDEX IF NOT EXISTS idx_osd_company_status
  ON erp_procurement.opening_stock_document (company_id, status);

CREATE INDEX IF NOT EXISTS idx_osl_document_id
  ON erp_procurement.opening_stock_line (document_id);

GRANT ALL ON erp_procurement.opening_stock_document TO service_role;
GRANT ALL ON erp_procurement.opening_stock_line TO service_role;

INSERT INTO erp_procurement.document_number_series (doc_type, pad_width, starting_number)
VALUES ('OS', 6, 1)
ON CONFLICT (doc_type) DO NOTHING;

COMMIT;
