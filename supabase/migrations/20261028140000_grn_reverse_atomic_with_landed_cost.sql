-- ============================================================================
-- GRN Reverse — atomic, and it takes the GRN's landed cost with it
-- (business owner, 2026-10-28; CLAUDE.md §8D)
--
-- Before: reverseGRNHandler wrote ~8 separate commits from TypeScript (P102,
-- PO line, GE line, QA delete, CSN, GRN header, GE header) and never touched
-- landed cost. Two concrete problems with that:
--   1. A crash mid-way left half a reversal (e.g. stock out, GRN still POSTED).
--      Every write's error was also ignored, so a failed step was silent --
--      the QA delete always failed silently once QA had test lines (FK RESTRICT).
--   2. AC01 landed cost stayed on a REVERSED GRN, and its revaluation
--      (save_ac01_grn_cost -> recalculate_valuation_at_row on the GRN's P101
--      row) stayed inside the material's WAR: P102 removes stock at the
--      blended rate, so the landed-cost uplift was left on the remaining stock.
--
-- After: one post_document() call. The P102 movement and every business write
-- run in one transaction (complete_grn_reverse below); any failure = full
-- rollback. Landed cost goes too:
--   * its headers/lines/deduction lines are deleted (snapshot kept on the GRN
--     in reversal_landed_cost_snapshot for audit), invoice verification cleared;
--   * if AC01 ever revalued this receipt, the receipt is re-valued back to its
--     own posted rate, so the material's WAR is what it would have been had the
--     landed cost never been entered.
--
-- New hard blocks (previously the handler went ahead and corrupted data):
--   QA usage decision taken (stock has already left QI -- use RTV instead),
--   live RTV, invoice verification line, live settlement invoice, exchange
--   replacement. Legacy multi-line GRNs (goods_receipt_line) are no longer
--   reversible here -- prod has none (2026-10-28).
-- ============================================================================

ALTER TABLE erp_procurement.goods_receipt
  ADD COLUMN IF NOT EXISTS reversal_landed_cost_snapshot jsonb;

COMMENT ON COLUMN erp_procurement.goods_receipt.reversal_landed_cost_snapshot IS
  'Landed cost (headers + lines + deduction lines) deleted by GRN reverse, kept here for audit.';


CREATE OR REPLACE FUNCTION erp_procurement.complete_grn_reverse(
  p_reference_document_id uuid,
  p_postings jsonb,
  p_context jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = erp_procurement, erp_inventory, public
AS $function$
DECLARE
  v_actor       uuid := NULLIF(p_context->>'actor', '')::uuid;
  v_reason      text := NULLIF(btrim(p_context->>'reversal_reason'), '');
  v_grn         erp_procurement.goods_receipt%ROWTYPE;
  v_base_rate   numeric;
  v_lc_snapshot jsonb;
  v_csn_id      uuid;
BEGIN
  -- No EXCEPTION handler, same as post_document: any failure rolls back the
  -- P102 movement too. That is the whole point of this function.

  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'GRN_REVERSAL_REASON_REQUIRED';
  END IF;

  -- Row lock: a second concurrent reverse waits here, then sees REVERSED and
  -- rolls back its own (already posted) P102.
  SELECT * INTO v_grn
  FROM erp_procurement.goods_receipt
  WHERE id = p_reference_document_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'GRN_NOT_FOUND';
  END IF;
  IF v_grn.status = 'SPLIT' THEN
    RAISE EXCEPTION 'GRN_SPLIT_CANNOT_REVERSE';
  END IF;
  IF v_grn.status <> 'POSTED' THEN
    RAISE EXCEPTION 'GRN_NOT_POSTED';
  END IF;
  IF v_grn.split_source_grn_id IS NOT NULL THEN
    RAISE EXCEPTION 'GRN_SPLIT_CHILD_CANNOT_REVERSE';
  END IF;
  IF v_grn.gate_entry_line_id IS NULL OR v_grn.stock_ledger_id IS NULL THEN
    RAISE EXCEPTION 'GRN_LEGACY_REVERSE_UNSUPPORTED';
  END IF;
  IF v_grn.settlement_invoice_id IS NOT NULL THEN
    RAISE EXCEPTION 'GRN_REVERSE_SETTLEMENT_EXISTS';
  END IF;
  IF EXISTS (
    SELECT 1 FROM erp_procurement.inward_qa_decision_line dl
    JOIN erp_procurement.inward_qa_document q ON q.id = dl.qa_document_id
    WHERE q.grn_id = v_grn.id
  ) THEN
    RAISE EXCEPTION 'GRN_REVERSE_QA_DECIDED';
  END IF;
  IF EXISTS (
    SELECT 1 FROM erp_procurement.return_to_vendor
    WHERE grn_id = v_grn.id AND status <> 'CANCELLED'
  ) THEN
    RAISE EXCEPTION 'GRN_REVERSE_RTV_EXISTS';
  END IF;
  IF EXISTS (SELECT 1 FROM erp_procurement.invoice_verification_line WHERE grn_id = v_grn.id) THEN
    RAISE EXCEPTION 'GRN_REVERSE_INVOICE_VERIFICATION_EXISTS';
  END IF;
  IF EXISTS (SELECT 1 FROM erp_procurement.exchange_reference WHERE replacement_grn_id = v_grn.id) THEN
    RAISE EXCEPTION 'GRN_REVERSE_EXCHANGE_EXISTS';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_postings) p WHERE p->>'line_ref' = 'GRN_REVERSAL') THEN
    RAISE EXCEPTION 'GRN_REVERSE_POSTING_NOT_FOUND';
  END IF;

  -- ── Landed cost out of WAR ───────────────────────────────────────────────
  -- AC01 revalues the receipt's own P101 row (snapshot only; stock_ledger is
  -- append-only, so that row still carries its originally posted rate).
  -- Replaying with that original rate puts the WAR back to "no landed cost".
  -- Runs after the P102 above, which the replay simply includes.
  IF EXISTS (
    SELECT 1 FROM erp_inventory.valuation_correction_log
    WHERE target_ledger_id = v_grn.stock_ledger_id
  ) THEN
    SELECT valuation_rate INTO v_base_rate
    FROM erp_inventory.stock_ledger WHERE id = v_grn.stock_ledger_id;

    PERFORM erp_inventory.recalculate_valuation_at_row(
      v_grn.stock_ledger_id, v_base_rate, v_actor,
      'GRN ' || v_grn.grn_number || ' reversed: landed cost removed from valuation'
    );
  END IF;

  -- ── Landed cost records ──────────────────────────────────────────────────
  SELECT jsonb_agg(jsonb_build_object(
           'header', to_jsonb(lc),
           'lines', COALESCE((SELECT jsonb_agg(to_jsonb(l)) FROM erp_procurement.landed_cost_line l WHERE l.lc_id = lc.id), '[]'::jsonb),
           'deduction_lines', COALESCE((SELECT jsonb_agg(to_jsonb(d)) FROM erp_procurement.landed_cost_deduction_line d WHERE d.lc_id = lc.id), '[]'::jsonb)
         ))
    INTO v_lc_snapshot
  FROM erp_procurement.landed_cost lc
  WHERE lc.grn_id = v_grn.id;

  DELETE FROM erp_procurement.landed_cost_deduction_line
  WHERE lc_id IN (SELECT id FROM erp_procurement.landed_cost WHERE grn_id = v_grn.id);
  DELETE FROM erp_procurement.landed_cost_line
  WHERE lc_id IN (SELECT id FROM erp_procurement.landed_cost WHERE grn_id = v_grn.id);
  DELETE FROM erp_procurement.landed_cost WHERE grn_id = v_grn.id;

  -- ── Source document receipt balance ──────────────────────────────────────
  IF v_grn.po_line_id IS NOT NULL THEN
    UPDATE erp_procurement.purchase_order_line
    SET open_qty = LEAST(ordered_qty, open_qty + v_grn.received_qty),
        line_status = CASE
          WHEN LEAST(ordered_qty, open_qty + v_grn.received_qty) >= ordered_qty THEN 'OPEN'
          WHEN LEAST(ordered_qty, open_qty + v_grn.received_qty) > 0 THEN 'PARTIALLY_RECEIVED'
          ELSE 'FULLY_RECEIVED'
        END,
        last_updated_at = now()
    WHERE id = v_grn.po_line_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'PO_LINE_NOT_FOUND';
    END IF;
  END IF;

  IF v_grn.sto_line_id IS NOT NULL THEN
    UPDATE erp_procurement.stock_transfer_order_line
    SET received_qty = GREATEST(0, COALESCE(received_qty, 0) - v_grn.received_qty),
        balance_qty = quantity - GREATEST(0, COALESCE(received_qty, 0) - v_grn.received_qty),
        line_status = CASE
          WHEN quantity - GREATEST(0, COALESCE(received_qty, 0) - v_grn.received_qty) <= 0 THEN 'RECEIVED'
          ELSE 'OPEN'
        END,
        last_updated_at = now()
    WHERE id = v_grn.sto_line_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'STO_LINE_NOT_FOUND';
    END IF;
  END IF;

  -- ── QA document (no decision taken -- checked above) ─────────────────────
  DELETE FROM erp_procurement.inward_qa_test_line
  WHERE qa_document_id IN (SELECT id FROM erp_procurement.inward_qa_document WHERE grn_id = v_grn.id);
  DELETE FROM erp_procurement.inward_qa_document WHERE grn_id = v_grn.id;

  -- ── Gate entry line + CSN back to "arrived, not received" ────────────────
  UPDATE erp_procurement.gate_entry_line
  SET grn_posted = false
  WHERE id = v_grn.gate_entry_line_id
  RETURNING csn_id INTO v_csn_id;

  IF v_csn_id IS NOT NULL THEN
    UPDATE erp_procurement.consignment_note
    SET status = 'GED', grn_id = NULL, grn_date = NULL, received_qty = NULL, last_updated_at = now()
    WHERE id = v_csn_id;
  END IF;

  -- ── GRN header ───────────────────────────────────────────────────────────
  UPDATE erp_procurement.goods_receipt
  SET status = 'REVERSED',
      movement_type_code = 'P102',
      reversal_grn_id = id,
      reversal_approved_by = v_actor,
      reversal_approved_at = now(),
      reversal_reason = v_reason,
      reversal_landed_cost_snapshot = v_lc_snapshot,
      invoice_verified_by = NULL,
      invoice_verified_at = NULL,
      last_updated_at = now()
  WHERE id = v_grn.id;

  -- GE reopens only when none of its lines still carries a posted GRN.
  UPDATE erp_procurement.gate_entry
  SET status = 'OPEN', last_updated_at = now()
  WHERE id = v_grn.gate_entry_id
    AND NOT EXISTS (
      SELECT 1 FROM erp_procurement.gate_entry_line
      WHERE gate_entry_id = v_grn.gate_entry_id AND grn_posted
    );
END;
$function$;

REVOKE ALL ON FUNCTION erp_procurement.complete_grn_reverse(uuid, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_procurement.complete_grn_reverse(uuid, jsonb, jsonb) TO service_role;


-- One reference_document_type has one completion function (post_document),
-- so GRN gets a dispatcher -- same approach as SALES_INVOICE's create/reverse.
-- complete_grn_split is the pre-20261010 split path; kept as the default.
CREATE OR REPLACE FUNCTION erp_procurement.complete_grn_action(
  p_reference_document_id uuid,
  p_postings jsonb,
  p_context jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = erp_procurement, public
AS $function$
BEGIN
  IF p_context->>'action' = 'REVERSE' THEN
    PERFORM erp_procurement.complete_grn_reverse(p_reference_document_id, p_postings, p_context);
  ELSE
    PERFORM erp_procurement.complete_grn_split(p_reference_document_id, p_postings, p_context);
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION erp_procurement.complete_grn_action(uuid, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_procurement.complete_grn_action(uuid, jsonb, jsonb) TO service_role;

UPDATE erp_inventory.posting_source_registry
SET completion_schema = 'erp_procurement',
    completion_function = 'complete_grn_action'
WHERE reference_document_type = 'GRN';
