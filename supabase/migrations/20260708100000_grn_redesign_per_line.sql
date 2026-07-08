/*
 * File-ID: GRN-REDESIGN-1
 * File-Path: supabase/migrations/20260708100000_grn_redesign_per_line.sql
 * Gate: GRN-REDESIGN
 * Domain: PROCUREMENT
 * Purpose: Redesign GRN to 1-GE-line → 1-GRN. Add receipt, document, transporter,
 *          accounts, pack/shelf-life fields to goods_receipt header.
 *          Create material_vendor_doc_name mapping table.
 */

BEGIN;

-- ── 1. Drop old 1-GRN-per-GE unique constraint ──────────────────────────────
ALTER TABLE erp_procurement.goods_receipt
  DROP CONSTRAINT IF EXISTS goods_receipt_gate_entry_id_key;

-- ── 2. Add gate_entry_line_id to goods_receipt header ───────────────────────
ALTER TABLE erp_procurement.goods_receipt
  ADD COLUMN IF NOT EXISTS gate_entry_line_id uuid
    REFERENCES erp_procurement.gate_entry_line(id) ON DELETE RESTRICT;

-- One GRN per GE line (only enforced for new-style GRNs with gate_entry_line_id set)
CREATE UNIQUE INDEX IF NOT EXISTS ux_goods_receipt_gate_entry_line
  ON erp_procurement.goods_receipt(gate_entry_line_id)
  WHERE gate_entry_line_id IS NOT NULL;

-- ── 3. Receipt fields (moved from goods_receipt_line to header) ──────────────
ALTER TABLE erp_procurement.goods_receipt
  ADD COLUMN IF NOT EXISTS material_id             uuid,
  ADD COLUMN IF NOT EXISTS po_line_id              uuid
    REFERENCES erp_procurement.purchase_order_line(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS storage_location_id     uuid,
  ADD COLUMN IF NOT EXISTS ge_qty                  numeric(20,6),
  ADD COLUMN IF NOT EXISTS net_weight_from_weighbridge numeric(20,6),
  ADD COLUMN IF NOT EXISTS received_qty            numeric(20,6),
  ADD COLUMN IF NOT EXISTS uom_code                text,
  ADD COLUMN IF NOT EXISTS discrepancy_qty         numeric(20,6),
  ADD COLUMN IF NOT EXISTS discrepancy_remarks     text,
  ADD COLUMN IF NOT EXISTS target_stock_type       text
    CHECK (target_stock_type IN ('UNRESTRICTED', 'QA_STOCK', 'BLOCKED') OR target_stock_type IS NULL),
  ADD COLUMN IF NOT EXISTS batch_lot_number        text,
  ADD COLUMN IF NOT EXISTS expiry_type             text
    CHECK (expiry_type IN ('DATE', 'SPAN', 'N_A') OR expiry_type IS NULL),
  ADD COLUMN IF NOT EXISTS expiry_date             date,
  ADD COLUMN IF NOT EXISTS shelf_life_months       int,
  ADD COLUMN IF NOT EXISTS per_pack_qty            numeric(20,6);

-- ── 4. Document fields ───────────────────────────────────────────────────────
ALTER TABLE erp_procurement.goods_receipt
  ADD COLUMN IF NOT EXISTS invoice_number   text,
  ADD COLUMN IF NOT EXISTS invoice_date     date,
  ADD COLUMN IF NOT EXISTS bl_number        text,
  ADD COLUMN IF NOT EXISTS bl_date          date,
  ADD COLUMN IF NOT EXISTS boe_number       text,
  ADD COLUMN IF NOT EXISTS boe_date         date;

-- ── 5. Transporter fields ────────────────────────────────────────────────────
ALTER TABLE erp_procurement.goods_receipt
  ADD COLUMN IF NOT EXISTS transporter_id   uuid,
  ADD COLUMN IF NOT EXISTS lr_number        text,
  ADD COLUMN IF NOT EXISTS lr_date          date;

-- ── 6. Material / vendor name mapping ────────────────────────────────────────
ALTER TABLE erp_procurement.goods_receipt
  ADD COLUMN IF NOT EXISTS invoice_name     text;

-- ── 7. Accounts fields ───────────────────────────────────────────────────────
ALTER TABLE erp_procurement.goods_receipt
  ADD COLUMN IF NOT EXISTS po_rate          numeric(20,4),
  ADD COLUMN IF NOT EXISTS invoice_rate     numeric(20,4),
  ADD COLUMN IF NOT EXISTS rate_confirmed   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS gst_pct          numeric(8,2);

-- ── 8. Stock posting references (for new-style single-line GRNs) ─────────────
ALTER TABLE erp_procurement.goods_receipt
  ADD COLUMN IF NOT EXISTS grn_rate         numeric(20,4),
  ADD COLUMN IF NOT EXISTS stock_document_id uuid,
  ADD COLUMN IF NOT EXISTS stock_ledger_id   uuid;

-- ── 9. material_vendor_doc_name — invoice name mapping ──────────────────────
CREATE TABLE IF NOT EXISTS erp_master.material_vendor_doc_name (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id uuid NOT NULL,
  vendor_id   uuid NOT NULL,
  doc_name    text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (material_id, vendor_id, doc_name)
);

COMMENT ON TABLE erp_master.material_vendor_doc_name IS
'Maps material+vendor pairs to known invoice/document names. Populated when Stores enters an invoice name on GRN. Used for suggestive dropdown on next GRN for the same material+vendor.';

-- ── 10. Make inward_qa_document.grn_line_id nullable ────────────────────────
-- New-style GRNs (1 GE line → 1 GRN) have no goods_receipt_line rows.
-- QA document is still created, linked by grn_id alone.
ALTER TABLE erp_procurement.inward_qa_document
  ALTER COLUMN grn_line_id DROP NOT NULL;

COMMENT ON TABLE erp_procurement.goods_receipt IS
'GRN header. New design: 1 GE line → 1 GRN. All receipt, document, transporter, accounts and shelf-life fields stored on header. Old-style GRNs (1 GE → 1 GRN) use goods_receipt_line for line data (backward compat).';

COMMIT;
