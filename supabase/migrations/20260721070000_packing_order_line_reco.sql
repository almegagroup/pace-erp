-- Packing PO PM-line AP Reco (§83.4.1 addendum, 2026-07-21).
--
-- Packing PO Final/COR6 never captured an "AP Approved" distinction on PM lines
-- (only actual_qty was stored) — so a PM-level deviation (alternate material
-- used, or an extra line added at Final) had no way to feed Reco/AP billing,
-- unlike Process PO's RM/INT lines (approved_status/ap_approved_qty/
-- variance_qty on process_order_line, committed into process_order_line_reco
-- at Verify). This mirrors that mechanism for Packing PO's PM lines only —
-- SFG and FG(Output) lines never deviate in a way requiring approval (output
-- is always accepted as actual), so these columns stay unused on those rows.

ALTER TABLE erp_production.packing_order_line
  ADD COLUMN approved_status text NULL,
  ADD COLUMN ap_approved_qty numeric NULL,
  ADD COLUMN variance_qty numeric NULL;

COMMENT ON COLUMN erp_production.packing_order_line.approved_status IS
  'YES/NO/PARTIAL — PM lines only, mirrors process_order_line.approved_status. NULL on SFG/FG rows.';
COMMENT ON COLUMN erp_production.packing_order_line.ap_approved_qty IS
  'PM lines only — recognized-for-billing qty per the Approved toggle. NULL on SFG/FG rows.';
COMMENT ON COLUMN erp_production.packing_order_line.variance_qty IS
  'PM lines only — actual_qty minus ap_approved_qty. NULL on SFG/FG rows.';

-- Append-only Reco/Costing layer for Packing PO PM lines, symmetric to
-- process_order_line_reco. Consumption is always SUM()-based across every
-- non-voided row for a packing_order_id — Final writes source_txn_type=
-- 'PRODUCTION' rows once; COR6 corrections append their own DELTA-sized row
-- (source_txn_type='COR6_CORRECTION') rather than editing/voiding history,
-- matching the already-locked PR19 credit-row pattern (§106 Phase 3).
CREATE TABLE erp_production.packing_order_line_reco (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  po_number text NOT NULL,
  sku_material_id uuid NOT NULL,
  batch_number text NULL,
  po_type text NOT NULL,
  finalized_at timestamptz NULL,
  packing_order_id uuid NOT NULL,
  packing_order_line_id uuid NOT NULL,
  material_id uuid NOT NULL,
  formulation_material_id uuid NULL,
  standard_qty numeric NULL,
  actual_qty numeric NOT NULL,
  approved_status text NOT NULL,
  ap_approved_qty numeric NOT NULL,
  variance_qty numeric NOT NULL,
  is_voided boolean NOT NULL DEFAULT false,
  voided_at timestamptz NULL,
  last_updated_at timestamptz NOT NULL DEFAULT now(),
  last_updated_by uuid NULL,
  reco_document_number text NULL,
  reco_document_year text NOT NULL DEFAULT '',
  source_txn_type text NOT NULL DEFAULT 'PRODUCTION'
    CHECK (source_txn_type IN ('PRODUCTION', 'COR6_CORRECTION')),
  reference_document_number text NULL,
  reference_document_type text NULL DEFAULT 'PACK_PO'
);

CREATE INDEX idx_packing_order_line_reco_po ON erp_production.packing_order_line_reco (packing_order_id);
CREATE INDEX idx_packing_order_line_reco_line ON erp_production.packing_order_line_reco (packing_order_line_id);
CREATE INDEX idx_packing_order_line_reco_company ON erp_production.packing_order_line_reco (company_id, po_number);

COMMENT ON TABLE erp_production.packing_order_line_reco IS
  'AP Reco/Costing layer for Packing PO PM lines (§83.4.1 addendum, 2026-07-21) — mirrors process_order_line_reco, PM-only, append-only, SUM()-reconciled.';
