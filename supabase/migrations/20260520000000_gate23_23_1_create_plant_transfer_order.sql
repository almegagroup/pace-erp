/*
 * File-ID: 23.1
 * File-Path: supabase/migrations/20260520000000_gate23_23_1_create_plant_transfer_order.sql
 * Gate: 23
 * Phase: 23
 * Domain: PROCUREMENT
 * Purpose: Plant Transfer Order document - supports ONE_STEP and TWO_STEP inter-plant stock transfers.
 * Authority: Backend
 */

BEGIN;

CREATE TABLE IF NOT EXISTS erp_procurement.plant_transfer_order (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pto_number                  text NOT NULL UNIQUE,
  transfer_type               text NOT NULL
    CHECK (transfer_type IN ('ONE_STEP', 'TWO_STEP')),
  status                      text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'APPROVED', 'ISSUED', 'IN_TRANSIT', 'CLOSED', 'CANCELLED')),
  source_company_id           uuid NOT NULL,
  source_plant_id             uuid NOT NULL,
  source_sloc_id              uuid NOT NULL,
  target_company_id           uuid NOT NULL,
  target_plant_id             uuid NOT NULL,
  target_sloc_id              uuid NOT NULL,
  source_gstin                text NULL,
  target_gstin                text NULL,
  gst_applicable              boolean NOT NULL DEFAULT false,
  tax_document_required       boolean NOT NULL DEFAULT false,
  material_id                 uuid NOT NULL,
  transfer_qty                numeric(20,6) NOT NULL CHECK (transfer_qty > 0),
  uom_code                    text NOT NULL,
  valuation_rate              numeric(20,6) NULL,
  transfer_value              numeric(20,6) NULL,
  transfer_price_type         text NOT NULL DEFAULT 'AT_COST'
    CHECK (transfer_price_type IN ('AT_COST', 'AT_AGREED_PRICE')),
  transport_required          boolean NOT NULL DEFAULT false,
  vehicle_number              text NULL,
  transporter_name            text NULL,
  lr_number                   text NULL,
  expected_dispatch_date      date NULL,
  expected_receipt_date       date NULL,
  eway_bill_reference         text NULL,
  gst_invoice_reference       text NULL,
  approved_by                 uuid NULL,
  approved_at                 timestamptz NULL,
  issued_by                   uuid NULL,
  issued_at                   timestamptz NULL,
  received_by                 uuid NULL,
  received_at                 timestamptz NULL,
  actual_receipt_date         date NULL,
  issue_stock_document_id     uuid NULL,
  receipt_stock_document_id   uuid NULL,
  cancellation_reason         text NULL,
  remarks                     text NULL,
  created_by                  uuid NOT NULL,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  last_updated_by             uuid NULL,
  last_updated_at             timestamptz NULL
);

CREATE INDEX IF NOT EXISTS idx_pto_source_company
  ON erp_procurement.plant_transfer_order (source_company_id);

CREATE INDEX IF NOT EXISTS idx_pto_target_company
  ON erp_procurement.plant_transfer_order (target_company_id);

CREATE INDEX IF NOT EXISTS idx_pto_status
  ON erp_procurement.plant_transfer_order (status);

CREATE INDEX IF NOT EXISTS idx_pto_material
  ON erp_procurement.plant_transfer_order (material_id);

CREATE INDEX IF NOT EXISTS idx_pto_created_at
  ON erp_procurement.plant_transfer_order (created_at DESC);

GRANT SELECT, INSERT, UPDATE ON erp_procurement.plant_transfer_order TO service_role;

INSERT INTO erp_procurement.document_number_series (doc_type, pad_width, starting_number)
VALUES ('PT', 6, 1)
ON CONFLICT (doc_type) DO NOTHING;

COMMIT;
