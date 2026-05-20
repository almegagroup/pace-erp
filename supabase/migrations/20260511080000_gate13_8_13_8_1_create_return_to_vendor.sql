/*
 * File-ID: 13.8.1
 * File-Path: supabase/migrations/20260511080000_gate13_8_13_8_1_create_return_to_vendor.sql
 * Gate: 13.8
 * Phase: 13
 * Domain: PROCUREMENT
 * Purpose: Return to Vendor header + lines - P122 movement from BLOCKED stock to vendor.
 * Authority: Backend
 */

BEGIN;

-- RTV Header
CREATE TABLE IF NOT EXISTS erp_procurement.return_to_vendor (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Auto: global pure numeric (RTV series)
  rtv_number            text NOT NULL UNIQUE,

  rtv_date              date NOT NULL,
  system_created_at     timestamptz NOT NULL DEFAULT now(),

  -- Cross-schema - plain uuid, NO FK
  company_id            uuid NOT NULL,
  vendor_id             uuid NOT NULL,

  -- Intra-schema FKs
  grn_id                uuid NOT NULL
    REFERENCES erp_procurement.goods_receipt(id)
    ON DELETE RESTRICT,

  po_id                 uuid NULL
    REFERENCES erp_procurement.purchase_order(id)
    ON DELETE RESTRICT,

  -- Return reason
  -- Section 98.1: QA_FAILURE / EXCESS_DELIVERY / WRONG_MATERIAL / DAMAGED / QUALITY_DEVIATION / OTHER
  reason_category       text NOT NULL
    CHECK (reason_category IN ('QA_FAILURE', 'EXCESS_DELIVERY', 'WRONG_MATERIAL', 'DAMAGED', 'QUALITY_DEVIATION', 'OTHER')),
  reason_text           text NULL,

  -- Settlement Mode (Section 98.5)
  settlement_mode       text NOT NULL
    CHECK (settlement_mode IN ('DEBIT_NOTE', 'NEXT_INVOICE_ADJUST', 'EXCHANGE')),

  -- Exchange reference number - auto-created by handler when settlement_mode = EXCHANGE
  exchange_ref_number   text NULL,

  -- Pending return credit (for NEXT_INVOICE_ADJUST mode)
  -- Populated by handler after Gate Exit (P122 posted). Amount = sum of line values.
  pending_credit_amount numeric(20, 4) NULL CHECK (pending_credit_amount >= 0),
  credit_adjusted_at    timestamptz NULL,

  -- CREATED -> DISPATCHED -> SETTLED
  status                text NOT NULL DEFAULT 'CREATED'
    CHECK (status IN ('CREATED', 'DISPATCHED', 'SETTLED', 'CANCELLED')),

  -- Gate Exit - plain uuid (gate_exit_outbound.rtv_id links back to this)
  gate_exit_id          uuid NULL,

  cancellation_reason   text NULL,
  cancelled_at          timestamptz NULL,
  cancelled_by          uuid NULL,

  remarks               text NULL,
  created_by            uuid NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  last_updated_at       timestamptz NULL,
  last_updated_by       uuid NULL
);

COMMENT ON TABLE erp_procurement.return_to_vendor IS
'RTV - return material from BLOCKED stock to vendor (P122). Three settlement modes: DEBIT_NOTE (formal DN raised), NEXT_INVOICE_ADJUST (credit tracked against next invoice), EXCHANGE (replacement GRN linked via exchange_reference). Import RTV: Gate Exit optional.';

COMMENT ON COLUMN erp_procurement.return_to_vendor.settlement_mode IS
'DEBIT_NOTE: debit_note record auto-created. NEXT_INVOICE_ADJUST: pending_credit_amount tracked. EXCHANGE: exchange_reference record auto-created; replacement GRN linked via exchange_ref_number.';

-- RTV Lines
CREATE TABLE IF NOT EXISTS erp_procurement.return_to_vendor_line (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  rtv_id                uuid NOT NULL
    REFERENCES erp_procurement.return_to_vendor(id)
    ON DELETE RESTRICT,

  line_number           int NOT NULL,

  -- Intra-schema FK
  grn_line_id           uuid NOT NULL
    REFERENCES erp_procurement.goods_receipt_line(id)
    ON DELETE RESTRICT,

  -- Cross-schema - plain uuid, NO FK
  material_id           uuid NOT NULL,
  -- From BLOCKED stock - cross-schema to erp_inventory
  storage_location_id   uuid NULL,

  original_grn_qty      numeric(20, 6) NOT NULL,
  return_qty            numeric(20, 6) NOT NULL CHECK (return_qty > 0),
  uom_code              text NOT NULL,

  -- Rate from original GRN (for debit note calculation)
  grn_rate              numeric(20, 4) NULL,

  -- Line value = return_qty × grn_rate
  line_value            numeric(20, 4) NULL,

  -- Movement type - always P122 for RTV
  movement_type_code    text NOT NULL DEFAULT 'P122'
    CHECK (movement_type_code = 'P122'),

  -- erp_inventory cross-schema references (plain uuid - no FK)
  stock_document_id     uuid NULL,
  stock_ledger_id       uuid NULL,

  created_at            timestamptz NOT NULL DEFAULT now(),

  UNIQUE (rtv_id, line_number)
);

COMMENT ON TABLE erp_procurement.return_to_vendor_line IS
'RTV line. Partial return allowed - return_qty can be less than original_grn_qty. Remaining qty stays in BLOCKED. P122 movement posts from BLOCKED -> out. stock_document_id + stock_ledger_id set after posting.';

COMMIT;
