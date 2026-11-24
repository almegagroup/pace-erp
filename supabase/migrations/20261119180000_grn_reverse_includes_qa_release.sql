-- GRN reverse now also undoes a QA RELEASE decision (owner 2026-11-19: a wrong GRN is wrong, QA pass does not make it right).
-- The handler posts, in ONE post_document call: for every RELEASE decision line P322 (Unrestricted -> QA, tagged
-- 'QA_RELEASE_REVERSAL'), then the usual P102 out of QI. This function checks every decision line is a RELEASE that got its
-- reversal posting, deletes the decision lines + QA document with the rest. BLOCK/REJECT/FOR_REPROCESS decisions still block.
-- If the released stock was already consumed, the P322 OUT fails INSUFFICIENT_STOCK and everything rolls back.
CREATE OR REPLACE FUNCTION erp_procurement.complete_grn_reverse(p_reference_document_id uuid, p_postings jsonb, p_context jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'erp_procurement', 'erp_inventory', 'public'
AS $function$
DECLARE
  v_actor       uuid := NULLIF(p_context->>'actor', '')::uuid;
  v_reason      text := NULLIF(btrim(p_context->>'reversal_reason'), '');
  v_grn         erp_procurement.goods_receipt%ROWTYPE;
  v_base_rate   numeric;
  v_lc_snapshot jsonb;
  v_csn_id      uuid;
  v_dec_lines   integer;
  v_release_lines integer;
  v_rev_postings integer;
BEGIN
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'GRN_REVERSAL_REASON_REQUIRED';
  END IF;

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

  -- QA decisions: only RELEASE can be undone, and only if the handler posted its reversal for every line.
  SELECT count(*), count(*) FILTER (WHERE dl.usage_decision = 'RELEASE')
    INTO v_dec_lines, v_release_lines
  FROM erp_procurement.inward_qa_decision_line dl
  JOIN erp_procurement.inward_qa_document q ON q.id = dl.qa_document_id
  WHERE q.grn_id = v_grn.id;
  IF v_dec_lines > 0 THEN
    SELECT count(*) INTO v_rev_postings
    FROM jsonb_array_elements(p_postings) p WHERE p->>'line_ref' LIKE 'QA_RELEASE_REVERSAL:%' AND p->>'line_ref' NOT LIKE '%:OUT';
    IF v_release_lines <> v_dec_lines OR v_rev_postings <> v_dec_lines THEN
      RAISE EXCEPTION 'GRN_REVERSE_QA_DECIDED';
    END IF;
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

  -- QA document: its (RELEASE) decision lines were reversed above in the same transaction.
  DELETE FROM erp_procurement.inward_qa_decision_line
  WHERE qa_document_id IN (SELECT id FROM erp_procurement.inward_qa_document WHERE grn_id = v_grn.id);
  DELETE FROM erp_procurement.inward_qa_test_line
  WHERE qa_document_id IN (SELECT id FROM erp_procurement.inward_qa_document WHERE grn_id = v_grn.id);
  DELETE FROM erp_procurement.inward_qa_document WHERE grn_id = v_grn.id;

  UPDATE erp_procurement.gate_entry_line
  SET grn_posted = false
  WHERE id = v_grn.gate_entry_line_id
  RETURNING csn_id INTO v_csn_id;

  IF v_csn_id IS NOT NULL THEN
    UPDATE erp_procurement.consignment_note
    SET status = 'GED', grn_id = NULL, grn_date = NULL, received_qty = NULL, last_updated_at = now()
    WHERE id = v_csn_id;
  END IF;

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

  UPDATE erp_procurement.gate_entry
  SET status = 'OPEN', last_updated_at = now()
  WHERE id = v_grn.gate_entry_id
    AND NOT EXISTS (
      SELECT 1 FROM erp_procurement.gate_entry_line
      WHERE gate_entry_id = v_grn.gate_entry_id AND grn_posted
    );
END;
$function$;
