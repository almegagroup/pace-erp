-- §133.14 Part B -- Dispatch-Reco. Written once per material line, at PGI
-- time, in the SAME transaction as the P601 posting (§8D). Distinct from
-- process_order_line_reco/packing_order_line_reco (production-level,
-- per-batch, never touched by dispatch) -- this is the dispatch-level view
-- Asian Paints actually gets billed against, since one batch can split
-- across several Invoices (§133.13's IBN grouping).
--
-- Two write shapes (feasibility §133.14 Section C/F, both LOCKED):
--   1. MTO/HPS/MTEST dispatch (a specific Packing PO/batch behind the
--      line) -- one row per underlying RM/PM/INT material, values derived
--      via the 2-level ratio chain (packingPoRatio x invoiceRatio),
--      Standard/Actual/AP-Approved each carrying their own independently
--      computed ratio (§133.14 Section E's own note: these totals can
--      differ when a batch has an unapproved-then-approved deviation).
--   2. RPS dispatch (pure RM/PM/INT sale) where Bill-To is Asian Paints
--      (dispatch_type check, §133.18-locked) -- one row per dispatched
--      material, ap_approved_qty = dispatch qty directly, no ratio,
--      standard_qty/actual_qty left NULL (there's no batch to derive them
--      from -- this is a straight commercial pass-through for AP's own
--      books, not a production reconciliation).
-- STO dispatches and plain (non-Asian) RPS dispatches never get a row here
-- at all -- no AP billing relationship to reconcile.

CREATE TABLE erp_production.dispatch_reco (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,

  -- Document identifiers (Section F, denormalized/flat, repeated per line).
  invoice_id uuid NOT NULL REFERENCES erp_procurement.sales_invoice(id),
  invoice_number text NOT NULL,
  invoice_date date NOT NULL,
  tally_invoice_number text,
  tally_invoice_date date,
  inbound_number text,
  dc_id uuid,
  dc_number text,
  source_type text NOT NULL CHECK (source_type IN ('SALES_ORDER')),
  so_id uuid,
  so_number text,
  fo_id uuid,
  fo_number text,
  dispatch_category text CHECK (dispatch_category IN ('RPS','SRPS','FRPS','FSRPS')),

  -- Production-side traceability (MTO/HPS/MTEST rows only -- NULL for the
  -- simple RPS-Asian-billed shape, there's no batch behind that dispatch).
  process_order_id uuid,
  process_order_number text,
  batch_number text,
  packing_order_id uuid,
  packing_order_number text,
  po_type text,

  -- What's being dispatched.
  dispatch_qty_kg numeric NOT NULL,
  material_id uuid NOT NULL,
  line_material_type text NOT NULL CHECK (line_material_type IN ('RM','PM','INT')),

  -- The 3 independently-derived "as per Dispatch" values (§133.14 Section E
  -- -- never a single uniform ratio; Standard/Actual/AP-Approved use their
  -- own separately-summed totals as the ratio denominator).
  standard_qty numeric,
  actual_qty numeric,
  ap_approved_qty numeric,

  -- Append-on-reversal pattern (matches process_order_line_reco/
  -- packing_order_line_reco's own already-established convention, and
  -- PR19/COR6's system-wide "never delete, void" rule).
  is_voided boolean NOT NULL DEFAULT false,
  voided_at timestamptz,
  voided_by uuid,

  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL
);

CREATE INDEX ix_dispatch_reco_invoice ON erp_production.dispatch_reco (invoice_id);
CREATE INDEX ix_dispatch_reco_fo ON erp_production.dispatch_reco (fo_id) WHERE fo_id IS NOT NULL;
CREATE INDEX ix_dispatch_reco_packing_order ON erp_production.dispatch_reco (packing_order_id) WHERE packing_order_id IS NOT NULL;
CREATE INDEX ix_dispatch_reco_company_date ON erp_production.dispatch_reco (company_id, invoice_date);

ALTER TABLE erp_production.dispatch_reco ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE erp_production.dispatch_reco IS
  '§133.14 Part B -- dispatch-level RM/PM/INT reconciliation (Standard/Actual/AP-Approved as per Dispatch), written at PGI time in the same transaction as the P601 posting. Report/query UI still not built as of 2026-08-28 -- write-only for now.';

NOTIFY pgrst, 'reload schema';
