-- PO12 (PTO) Phase C — Settlement (Leg 2 Invoice).
-- Design locked in docs/PROCUREMENT-DESIGN-DOC.md "Settlement (Leg 2
-- Invoice)" section, business-owner session 2026-10-04.
--
-- Zero stock_ledger movement (CRCP's Leg 2 is a pure commercial invoice
-- between two PACE companies, not a physical transfer) -- so this is NOT
-- routed through erp_inventory.post_document()/posting_source_registry
-- (CLAUDE.md §8D), it is a single dedicated plpgsql function doing a pure
-- business-table write: create the Settlement Invoice header and flip every
-- selected GRN's Settlement Status to Settled, atomically (one function =
-- one implicit transaction, same principle as every other atomic RPC in
-- this codebase, e.g. erp_procurement.generate_doc_number).
--
-- Bill-To / Actual-Receiver are never separate header fields entered by the
-- user -- always derived from the checked GRN rows themselves, and the
-- create function enforces that every checked GRN shares the same pair (a
-- Settlement Invoice cannot mix GRNs from different Bill-To/Actual-Receiver
-- combinations -- each such pair gets its own Settlement Invoice).

BEGIN;

CREATE TABLE erp_procurement.settlement_invoice (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Internal system document number -- SETTLEMENT series (9900000001+).
  -- This is a backend reference only (same role as every other
  -- document_number_series entry, e.g. PO/STO numbers) -- never the primary
  -- user-facing identifier; see tally_invoice_number below for that.
  settlement_number         text NOT NULL UNIQUE,

  -- Primary user-facing identifier -- the real, externally-issued invoice.
  -- This is what AC01's own "Settlement Invoice" column shows, and what the
  -- "Settled" tab's reversal lookup is keyed on.
  tally_invoice_number       text NOT NULL,
  tally_invoice_date         date NOT NULL,

  -- Tied to/against the Tally Invoice Date, not independently entered.
  posting_date               date NOT NULL,

  -- Cross-schema -- plain uuid, NO FK, same convention as every other
  -- erp_procurement company_id column. Derived from the checked GRN rows
  -- at create time, never a separate header field a user fills in.
  bill_to_company_id         uuid NOT NULL,
  actual_receiver_company_id uuid NOT NULL,

  invoice_quantity           numeric(20, 6) NOT NULL CHECK (invoice_quantity > 0),
  rate_per_uom                numeric(20, 4) NOT NULL,
  currency_code               text NOT NULL DEFAULT 'INR',

  freight_term                text NULL
    CHECK (freight_term IS NULL OR freight_term IN ('FOR', 'FREIGHT_SEPARATE', 'FREIGHT_AT_ACTUALS', 'EX_TRANSPORTER_GODOWN')),
  payment_term_id             uuid NULL,

  gst_rate                    numeric(8, 2) NULL,
  gst_treatment                text NULL
    CHECK (gst_treatment IS NULL OR gst_treatment IN ('INCLUSIVE', 'EXCLUSIVE')),
  gst_type                     text NULL
    CHECK (gst_type IS NULL OR gst_type IN ('CGST_SGST', 'IGST')),
  gst_amount                   numeric(20, 4) NULL,

  -- Header-level (unlike STO, which has these per-line) -- Settlement has
  -- no independently-editable line items of its own, only already-posted
  -- GRN rows being referenced/checked.
  sending_cost_center_id       uuid NULL,
  receiving_cost_center_id     uuid NULL,
  has_rebate                   boolean NOT NULL DEFAULT false,
  rebate_rate                  numeric NULL,
  rebate_rate_uom_basis        text NULL,
  rebate_remarks                text NULL,

  -- POSTED -> REVERSED (whole-invoice only, never a specific row -- see
  -- design doc's "whole-invoice only reversal" rationale).
  status                       text NOT NULL DEFAULT 'POSTED'
    CHECK (status IN ('POSTED', 'REVERSED')),
  reversed_by                  uuid NULL,
  reversed_at                  timestamptz NULL,
  reversal_reason              text NULL,

  remarks                      text NULL,
  created_by                   uuid NOT NULL,
  created_at                   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE erp_procurement.settlement_invoice IS
'CRCP Leg 2 invoice -- Company A (Bill-To) invoices Company C (Actual Receiver) directly for material it never physically received but legally directed delivery of (§16(2)(b) deeming Explanation). No stock_ledger movement. No approval workflow anywhere (create or reverse). Whole-invoice-only reversal -- see reverse_settlement_invoice().';

-- goods_receipt.settlement_invoice_id -- nullable FK, Settlement Status is
-- derived from this (NULL = Pending, set + invoice status=POSTED = Settled;
-- reversing the invoice resets it back to NULL).
ALTER TABLE erp_procurement.goods_receipt
  ADD COLUMN settlement_invoice_id uuid NULL
    REFERENCES erp_procurement.settlement_invoice(id)
    ON DELETE RESTRICT;

COMMENT ON COLUMN erp_procurement.goods_receipt.settlement_invoice_id IS
'CRCP Leg 2 -- which Settlement Invoice (if any) has recognized this GRN''s cross-company discrepancy. NULL = Settlement Status Pending (shown in PO12 Tab 1''s Pending list). Set by erp_procurement.create_settlement_invoice(), cleared back to NULL by erp_procurement.reverse_settlement_invoice() -- pure status-flip, no stock to unwind.';

CREATE INDEX idx_goods_receipt_settlement_invoice_id
  ON erp_procurement.goods_receipt (settlement_invoice_id)
  WHERE settlement_invoice_id IS NOT NULL;

-- create_settlement_invoice() — atomic: validates every checked GRN is
-- unsettled and shares one Bill-To/Actual-Receiver pair, validates the
-- match rule (Invoice Quantity = sum of the checked GRNs' own received_qty
-- -- Tab 1's locked "Quantity" column), then creates the header and flips
-- every GRN's settlement_invoice_id in one transaction.
CREATE OR REPLACE FUNCTION erp_procurement.create_settlement_invoice(
  p_grn_ids uuid[],
  p_tally_invoice_number text,
  p_tally_invoice_date date,
  p_posting_date date,
  p_invoice_quantity numeric,
  p_rate_per_uom numeric,
  p_currency_code text,
  p_freight_term text,
  p_payment_term_id uuid,
  p_gst_rate numeric,
  p_gst_treatment text,
  p_gst_type text,
  p_gst_amount numeric,
  p_sending_cost_center_id uuid,
  p_receiving_cost_center_id uuid,
  p_has_rebate boolean,
  p_rebate_rate numeric,
  p_rebate_rate_uom_basis text,
  p_rebate_remarks text,
  p_remarks text,
  p_actor uuid
)
RETURNS erp_procurement.settlement_invoice
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_bill_to_company_id uuid;
  v_actual_receiver_company_id uuid;
  v_running_total numeric;
  v_settlement_number text;
  v_row erp_procurement.settlement_invoice%ROWTYPE;
BEGIN
  IF p_grn_ids IS NULL OR array_length(p_grn_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'SETTLEMENT_NO_GRN_SELECTED';
  END IF;

  -- Lock the checked GRN rows for the duration of this transaction --
  -- serializes concurrent Settlement creates against the same GRN set, the
  -- same discipline every other atomic posting function in this codebase
  -- uses (CLAUDE.md §8B's doc-number UPDATE...RETURNING pattern).
  PERFORM 1 FROM erp_procurement.goods_receipt
  WHERE id = ANY(p_grn_ids)
  FOR UPDATE;

  -- Derive Bill-To / Actual-Receiver from the checked GRNs themselves --
  -- never a separate header field. Every checked GRN must agree on both
  -- (validated explicitly below); these two scalars are simply one of them.
  -- uuid has no built-in max()/min() aggregate in Postgres -- array_agg(...)[1]
  -- picks an arbitrary one, which is fine since the checks just below require
  -- every row to already agree on a single value.
  SELECT (array_agg(COALESCE(po.company_id, sto.receiving_company_id)))[1],
         (array_agg(gr.company_id))[1],
         sum(gr.received_qty)
  INTO v_bill_to_company_id, v_actual_receiver_company_id, v_running_total
  FROM erp_procurement.goods_receipt gr
  LEFT JOIN erp_procurement.purchase_order po ON po.id = gr.po_id
  LEFT JOIN erp_procurement.stock_transfer_order sto ON sto.id = gr.sto_id
  WHERE gr.id = ANY(p_grn_ids);

  IF EXISTS (
    SELECT 1 FROM erp_procurement.goods_receipt WHERE id = ANY(p_grn_ids) AND settlement_invoice_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'SETTLEMENT_GRN_ALREADY_SETTLED';
  END IF;

  IF (
    SELECT count(DISTINCT COALESCE(po.company_id, sto.receiving_company_id))
    FROM erp_procurement.goods_receipt gr
    LEFT JOIN erp_procurement.purchase_order po ON po.id = gr.po_id
    LEFT JOIN erp_procurement.stock_transfer_order sto ON sto.id = gr.sto_id
    WHERE gr.id = ANY(p_grn_ids)
  ) <> 1 THEN
    RAISE EXCEPTION 'SETTLEMENT_MIXED_BILL_TO_COMPANY';
  END IF;

  IF (SELECT count(DISTINCT gr.company_id) FROM erp_procurement.goods_receipt gr WHERE gr.id = ANY(p_grn_ids)) <> 1 THEN
    RAISE EXCEPTION 'SETTLEMENT_MIXED_ACTUAL_RECEIVER_COMPANY';
  END IF;

  IF v_bill_to_company_id IS NULL OR v_actual_receiver_company_id IS NULL THEN
    RAISE EXCEPTION 'SETTLEMENT_COMPANY_RESOLUTION_FAILED';
  END IF;

  IF v_bill_to_company_id = v_actual_receiver_company_id THEN
    RAISE EXCEPTION 'SETTLEMENT_NOT_A_DISCREPANCY';
  END IF;

  -- Match rule, hard gate: Invoice Quantity must exactly equal the running
  -- total of the checked rows' own Quantity (received_qty). Rounded to 6dp
  -- to tolerate float noise, same tolerance as the rest of this codebase's
  -- quantity comparisons.
  IF round(COALESCE(v_running_total, 0), 6) <> round(p_invoice_quantity, 6) THEN
    RAISE EXCEPTION 'SETTLEMENT_QUANTITY_MISMATCH';
  END IF;

  v_settlement_number := erp_procurement.generate_doc_number('SETTLEMENT');

  INSERT INTO erp_procurement.settlement_invoice (
    settlement_number, tally_invoice_number, tally_invoice_date, posting_date,
    bill_to_company_id, actual_receiver_company_id,
    invoice_quantity, rate_per_uom, currency_code,
    freight_term, payment_term_id,
    gst_rate, gst_treatment, gst_type, gst_amount,
    sending_cost_center_id, receiving_cost_center_id,
    has_rebate, rebate_rate, rebate_rate_uom_basis, rebate_remarks,
    remarks, created_by
  ) VALUES (
    v_settlement_number, p_tally_invoice_number, p_tally_invoice_date, p_posting_date,
    v_bill_to_company_id, v_actual_receiver_company_id,
    p_invoice_quantity, p_rate_per_uom, COALESCE(p_currency_code, 'INR'),
    p_freight_term, p_payment_term_id,
    p_gst_rate, p_gst_treatment, p_gst_type, p_gst_amount,
    p_sending_cost_center_id, p_receiving_cost_center_id,
    COALESCE(p_has_rebate, false), p_rebate_rate, p_rebate_rate_uom_basis, p_rebate_remarks,
    p_remarks, p_actor
  )
  RETURNING * INTO v_row;

  UPDATE erp_procurement.goods_receipt
  SET settlement_invoice_id = v_row.id
  WHERE id = ANY(p_grn_ids);

  RETURN v_row;
END;
$$;

COMMENT ON FUNCTION erp_procurement.create_settlement_invoice IS
'Atomic Settlement (Leg 2) create -- validates every checked GRN is unsettled and shares one Bill-To/Actual-Receiver pair, validates Invoice Quantity = sum(received_qty) of the checked rows, then creates the header and flips every checked GRN''s settlement_invoice_id, all in one transaction.';

-- reverse_settlement_invoice() — whole-invoice only, never a specific row.
-- Pure status-flip: no stock_ledger movement exists to unwind.
CREATE OR REPLACE FUNCTION erp_procurement.reverse_settlement_invoice(
  p_settlement_invoice_id uuid,
  p_actor uuid,
  p_reason text
)
RETURNS erp_procurement.settlement_invoice
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_row erp_procurement.settlement_invoice%ROWTYPE;
BEGIN
  SELECT * INTO v_row
  FROM erp_procurement.settlement_invoice
  WHERE id = p_settlement_invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SETTLEMENT_NOT_FOUND';
  END IF;

  IF v_row.status <> 'POSTED' THEN
    RAISE EXCEPTION 'SETTLEMENT_NOT_REVERSIBLE';
  END IF;

  UPDATE erp_procurement.settlement_invoice
  SET status = 'REVERSED',
      reversed_by = p_actor,
      reversed_at = now(),
      reversal_reason = p_reason
  WHERE id = p_settlement_invoice_id
  RETURNING * INTO v_row;

  UPDATE erp_procurement.goods_receipt
  SET settlement_invoice_id = NULL
  WHERE settlement_invoice_id = p_settlement_invoice_id;

  RETURN v_row;
END;
$$;

COMMENT ON FUNCTION erp_procurement.reverse_settlement_invoice IS
'Atomic Settlement (Leg 2) reverse -- whole-invoice only (no per-row reversal). Flips status to REVERSED and resets every GRN it covered back to settlement_invoice_id=NULL (reappears in PO12 Tab 1''s Pending list), all in one transaction. No approval gate here -- enforced at the handler/ACL layer, not in this function.';

COMMIT;
