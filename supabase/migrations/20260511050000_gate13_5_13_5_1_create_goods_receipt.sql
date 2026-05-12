/*
 * File-ID: 13.5.1
 * File-Path: supabase/migrations/20260511050000_gate13_5_13_5_1_create_goods_receipt.sql
 * Gate: 13.5
 * Phase: 13
 * Domain: PROCUREMENT
 * Purpose: GRN header + lines - one per Gate Entry, lines auto-loaded from GE, stock posting.
 * Authority: Backend
 */

BEGIN;

-- GRN Header
CREATE TABLE IF NOT EXISTS erp_procurement.goods_receipt (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Auto: global pure numeric
  grn_number            text NOT NULL UNIQUE,

  -- User date (backdating allowed)
  grn_date              date NOT NULL,
  -- Financial posting date (defaults to grn_date; overridable)
  posting_date          date NOT NULL,
  system_created_at     timestamptz NOT NULL DEFAULT now(),

  -- Cross-schema - plain uuid, NO FK
  company_id            uuid NOT NULL,
  vendor_id             uuid NULL,   -- NULL for STO GRN (no vendor)

  -- Intra-schema FKs
  gate_entry_id         uuid NOT NULL
    REFERENCES erp_procurement.gate_entry(id)
    ON DELETE RESTRICT,

  -- One GRN per GE (Section 93.1)
  -- UNIQUE enforced below

  po_id                 uuid NULL
    REFERENCES erp_procurement.purchase_order(id)
    ON DELETE RESTRICT,

  -- STO reference - plain uuid (STO table in Gate-13.7)
  sto_id                uuid NULL,   -- -> erp_procurement.stock_transfer_order

  -- P101 | STO_RECEIPT | P102 (reversal)
  movement_type_code    text NOT NULL
    CHECK (movement_type_code IN ('P101', 'STO_RECEIPT', 'P102')),

  -- DRAFT -> POSTED | REVERSED
  status                text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'POSTED', 'REVERSED')),

  posted_by             uuid NULL,
  posted_at             timestamptz NULL,

  -- Reversal fields
  -- P102 reversal: requires approval
  reversal_grn_id       uuid NULL
    REFERENCES erp_procurement.goods_receipt(id),

  reversal_approved_by  uuid NULL,
  reversal_approved_at  timestamptz NULL,
  reversal_reason       text NULL,

  remarks               text NULL,
  created_by            uuid NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  last_updated_at       timestamptz NULL,

  -- One GRN per GE
  UNIQUE (gate_entry_id)
);

COMMENT ON TABLE erp_procurement.goods_receipt IS
'GRN header. One per GE - cannot span multiple GEs. Lines auto-loaded from GE. Post-GRN: stock ledger + snapshot + PO balance + CSN status all auto-updated by handler. Reversal (P102) requires approval.';

-- GRN Lines
CREATE TABLE IF NOT EXISTS erp_procurement.goods_receipt_line (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Intra-schema FK
  grn_id                  uuid NOT NULL
    REFERENCES erp_procurement.goods_receipt(id)
    ON DELETE RESTRICT,

  line_number             int NOT NULL,

  -- Reference to GE line (intra-schema)
  gate_entry_line_id      uuid NOT NULL
    REFERENCES erp_procurement.gate_entry_line(id)
    ON DELETE RESTRICT,

  -- PO / STO line reference (intra-schema)
  po_line_id              uuid NULL
    REFERENCES erp_procurement.purchase_order_line(id)
    ON DELETE RESTRICT,

  -- STO line - plain uuid (STO table in Gate-13.7)
  sto_line_id             uuid NULL,

  -- Cross-schema - plain uuid, NO FK
  material_id             uuid NOT NULL,
  -- Receiving storage location - cross-schema to erp_inventory
  storage_location_id     uuid NULL,   -- -> erp_inventory.storage_location_master

  -- Quantities
  -- GE qty: read-only reference from gate_entry_line
  ge_qty                  numeric(20, 6) NOT NULL,
  -- Net weight from weighbridge (BULK/TANKER): read-only, from GE Gross - Gate Exit Tare
  net_weight_from_weighbridge numeric(20, 6) NULL,
  -- Stores enters actual received qty
  -- BULK/TANKER defaults to net_weight_from_weighbridge (overridable)
  received_qty            numeric(20, 6) NOT NULL CHECK (received_qty >= 0),
  uom_code                text NOT NULL,

  -- Discrepancy = GE qty - Received qty (computed by handler, stored for reporting)
  discrepancy_qty         numeric(20, 6) NULL,

  -- Stock Type (auto from Material Master QA flag)
  -- UNRESTRICTED: QA not required
  -- QA_STOCK: QA required -> GRN posts to QA_STOCK, QA document auto-created
  target_stock_type       text NOT NULL
    CHECK (target_stock_type IN ('UNRESTRICTED', 'QA_STOCK', 'BLOCKED')),

  -- Batch/Lot - mandatory only if material.batch_tracking_required = true
  batch_lot_number        text NULL,
  -- Expiry - mandatory only if material.fifo_tracking_enabled + expiry_tracking_enabled = true
  expiry_date             date NULL,

  -- Invoice number (for import STO: Stores enters; for direct PO: auto from GE)
  invoice_number          text NULL,

  -- Rate at which this GRN is valued (from PO line unit_rate)
  grn_rate                numeric(20, 4) NULL,

  -- erp_inventory cross-schema references (plain uuid - no FK)
  stock_document_id       uuid NULL,   -- -> erp_inventory.stock_document (set after posting)
  stock_ledger_id         uuid NULL,   -- -> erp_inventory.stock_ledger (set after posting)

  created_at              timestamptz NOT NULL DEFAULT now(),

  UNIQUE (grn_id, line_number)
);

COMMENT ON TABLE erp_procurement.goods_receipt_line IS
'GRN line. Lines loaded from GE - Stores cannot add/delete, only edit received_qty and storage fields. target_stock_type auto from Material Master QA flag. batch_lot_number mandatory only if batch_tracking_required = true on material.';

COMMENT ON COLUMN erp_procurement.goods_receipt_line.target_stock_type IS
'UNRESTRICTED: QA not required -> directly usable stock. QA_STOCK: QA required -> stock held pending QA decision. BLOCKED: exceptional cases only.';

COMMIT;
