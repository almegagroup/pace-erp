/*
 * File-ID: 11.11
 * File-Path: supabase/migrations/20260509110000_gate11_11_11_create_stock_document.sql
 * Gate: 11
 * Phase: 11
 * Domain: INVENTORY
 * Purpose: Create the stock_document header table for stock movement transactions.
 * Authority: Backend
 */

BEGIN;

CREATE TABLE IF NOT EXISTS erp_inventory.stock_document (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- System-generated using number_series
  document_number             text NOT NULL UNIQUE,
  document_date               date NOT NULL DEFAULT current_date,
  posting_date                date NOT NULL DEFAULT current_date,

  -- Movement type code (e.g. P101, P261)
  movement_type_code          text NOT NULL
    REFERENCES erp_inventory.movement_type_master(code)
    ON DELETE RESTRICT,

  -- Scope
  company_id                  uuid NOT NULL,
  plant_id                    uuid NOT NULL,

  -- Locations (NULL if not applicable for the movement type)
  source_location_id          uuid NULL
    REFERENCES erp_inventory.storage_location_master(id),
  target_location_id          uuid NULL
    REFERENCES erp_inventory.storage_location_master(id),

  source_stock_type           text NULL,
  target_stock_type           text NULL,

  -- Material
  material_id                 uuid NOT NULL,

  -- Quantity in base UOM
  quantity                    numeric(20, 6) NOT NULL CHECK (quantity > 0),
  base_uom_code               text NOT NULL,

  -- Value = quantity × valuation_rate
  value                       numeric(20, 4) NOT NULL DEFAULT 0,
  valuation_rate              numeric(20, 6) NOT NULL DEFAULT 0,

  -- Reference document (mandatory for movements that require it)
  reference_document_type     text NULL,
  reference_document_id       uuid NULL,
  reference_document_number   text NULL,

  -- Batch / lot (if batch tracking enabled for material)
  batch_id                    uuid NULL,

  -- Account assignment
  account_assignment_type     text NULL,
  account_assignment_id       uuid NULL,

  -- Audit
  posted_by                   uuid NOT NULL,
  posted_at                   timestamptz NULL,

  -- Approval
  approval_required           boolean NOT NULL DEFAULT false,
  approved_by                 uuid NULL,
  approved_at                 timestamptz NULL,

  -- Status lifecycle
  -- DRAFT -> PENDING_APPROVAL -> POSTED -> REVERSED / CANCELLED
  status                      text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'POSTED', 'REVERSED', 'CANCELLED')),

  -- If this document was reversed, link to the reversal document
  reversal_document_id        uuid NULL
    REFERENCES erp_inventory.stock_document(id),

  remarks                     text NULL,

  created_at                  timestamptz NOT NULL DEFAULT now(),
  created_by                  uuid NOT NULL
);

COMMENT ON TABLE erp_inventory.stock_document IS
'Every stock movement creates a stock document. Header level. Line level is stock_ledger.';

COMMENT ON COLUMN erp_inventory.stock_document.status IS
'DRAFT = saved not posted. PENDING_APPROVAL = waiting for approver. POSTED = ledger updated. REVERSED = reversal posted. CANCELLED = voided before posting.';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_sd_company_plant ON erp_inventory.stock_document (company_id, plant_id);
CREATE INDEX IF NOT EXISTS idx_sd_material ON erp_inventory.stock_document (material_id);
CREATE INDEX IF NOT EXISTS idx_sd_movement_type ON erp_inventory.stock_document (movement_type_code);
CREATE INDEX IF NOT EXISTS idx_sd_status ON erp_inventory.stock_document (status);
CREATE INDEX IF NOT EXISTS idx_sd_ref_doc ON erp_inventory.stock_document (reference_document_type, reference_document_id);
CREATE INDEX IF NOT EXISTS idx_sd_posting_date ON erp_inventory.stock_document (posting_date);

COMMIT;
