-- GRN commercial invoice split: the original GRN becomes SPLIT, never REVERSED
-- (business owner, 2026-10-15).
--
-- A commercial split (20261010113446) leaves the original GRN's physical P101
-- untouched and moves the invoices to child GRNs. It used to mark the original
-- REVERSED only so AC01 would stop treating it as payable. But everything else
-- reads REVERSED as "the stock was reversed":
--   * Inward QA locked the QA document as "Reversed with GRN", so a truck split
--     before its usage decision stayed in QUALITY_INSPECTION with no way out;
--   * AC01 greyed the row out as a reversal and the physical chain
--     (GE / challan -> GRN -> invoices) was lost.
--
-- SPLIT says exactly what happened: the receipt still stands, its invoices are
-- the child GRNs. Like REVERSED it is not POSTED, so every quantity sum that
-- counts POSTED GRNs (PO received qty, lot balances, CSN) keeps counting the
-- child GRNs only -- no double count. The reversal_* columns stay for real
-- reversals; a split records split_at / split_by / split_reason instead.

ALTER TABLE erp_procurement.goods_receipt
  ADD COLUMN IF NOT EXISTS split_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS split_by uuid NULL,
  ADD COLUMN IF NOT EXISTS split_reason text NULL;

ALTER TABLE erp_procurement.goods_receipt
  DROP CONSTRAINT IF EXISTS goods_receipt_status_check;
ALTER TABLE erp_procurement.goods_receipt
  ADD CONSTRAINT goods_receipt_status_check
  CHECK (status = ANY (ARRAY['DRAFT'::text, 'POSTED'::text, 'REVERSED'::text, 'SPLIT'::text]));

CREATE OR REPLACE FUNCTION erp_procurement.complete_grn_commercial_split(
  p_original_grn_id uuid,
  p_splits jsonb,
  p_actor uuid,
  p_reason text DEFAULT 'Commercial invoice split'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = erp_procurement, erp_inventory, public
AS $function$
DECLARE
  v_source erp_procurement.goods_receipt%ROWTYPE;
  v_split jsonb;
  v_row erp_procurement.goods_receipt%ROWTYPE;
  v_total_qty numeric := 0;
  v_child_ids jsonb := '[]'::jsonb;
  v_valuation jsonb;
BEGIN
  IF p_splits IS NULL OR jsonb_typeof(p_splits) <> 'array' OR jsonb_array_length(p_splits) < 2 THEN
    RAISE EXCEPTION 'GRN_SPLIT_INVALID';
  END IF;

  SELECT * INTO v_source
  FROM erp_procurement.goods_receipt
  WHERE id = p_original_grn_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'GRN_SPLIT_ORIGINAL_NOT_FOUND: %', p_original_grn_id;
  END IF;
  IF v_source.status <> 'POSTED' THEN
    RAISE EXCEPTION 'GRN_SPLIT_ORIGINAL_NOT_POSTED';
  END IF;
  IF v_source.stock_ledger_id IS NULL THEN
    RAISE EXCEPTION 'GRN_SPLIT_SOURCE_LEDGER_NOT_FOUND';
  END IF;
  IF EXISTS (SELECT 1 FROM erp_procurement.goods_receipt WHERE split_source_grn_id = p_original_grn_id) THEN
    RAISE EXCEPTION 'GRN_SPLIT_ALREADY_COMPLETED';
  END IF;

  SELECT COALESCE(SUM(NULLIF(value->>'received_qty', '')::numeric), 0)
  INTO v_total_qty
  FROM jsonb_array_elements(p_splits);
  IF abs(v_total_qty - COALESCE(v_source.received_qty, 0)) > 0.0001 THEN
    RAISE EXCEPTION 'GRN_SPLIT_QTY_MISMATCH';
  END IF;

  -- SPLIT, not REVERSED: the physical receipt (movement_type_code,
  -- stock_document_id, stock_ledger_id, QA document) still stands; only its
  -- invoices moved to the child GRNs below.
  UPDATE erp_procurement.goods_receipt
  SET status = 'SPLIT',
      split_at = now(),
      split_by = p_actor,
      split_reason = COALESCE(NULLIF(p_reason, ''), 'Commercial invoice split'),
      last_updated_at = now()
  WHERE id = p_original_grn_id;

  FOR v_split IN SELECT value FROM jsonb_array_elements(p_splits)
  LOOP
    v_row := jsonb_populate_record(
      NULL::erp_procurement.goods_receipt,
      v_split || jsonb_build_object(
        'status', 'POSTED',
        'gate_entry_line_id', NULL,
        'source_gate_entry_line_id', v_source.gate_entry_line_id,
        'split_source_grn_id', p_original_grn_id,
        'stock_document_id', NULL,
        'stock_ledger_id', NULL,
        'movement_type_code', v_source.movement_type_code,
        'reversal_grn_id', NULL,
        'reversal_approved_by', NULL,
        'reversal_approved_at', NULL,
        'reversal_reason', NULL,
        'split_at', NULL,
        'split_by', NULL,
        'split_reason', NULL
      )
    );
    INSERT INTO erp_procurement.goods_receipt SELECT (v_row).*;
    v_child_ids := v_child_ids || jsonb_build_array(jsonb_build_object(
      'id', v_row.id, 'grn_number', v_row.grn_number, 'received_qty', v_row.received_qty,
      'invoice_number', v_row.invoice_number
    ));
  END LOOP;

  v_valuation := erp_procurement.recalculate_commercial_split_valuation(
    p_original_grn_id, p_actor, COALESCE(NULLIF(p_reason, ''), 'Commercial invoice split valuation')
  );

  RETURN jsonb_build_object(
    'original_grn_id', p_original_grn_id,
    'new_grns', v_child_ids,
    'split_source_valuation', v_valuation
  );
END;
$function$;

REVOKE ALL ON FUNCTION erp_procurement.complete_grn_commercial_split(uuid, jsonb, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_procurement.complete_grn_commercial_split(uuid, jsonb, uuid, text) TO service_role;

-- Backfill: commercial splits already marked REVERSED. A commercial split is
-- recognisable because its child GRNs carry no stock posting of their own.
-- The older split mechanism (before 20261010113446) really reversed the stock
-- (P102) and posted P101 on every child -- those originals stay REVERSED.
UPDATE erp_procurement.goods_receipt g
SET status = 'SPLIT',
    split_at = g.reversal_approved_at,
    split_by = g.reversal_approved_by,
    split_reason = g.reversal_reason,
    reversal_grn_id = NULL,
    reversal_approved_by = NULL,
    reversal_approved_at = NULL,
    reversal_reason = NULL
WHERE g.status = 'REVERSED'
  AND g.stock_ledger_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM erp_procurement.goods_receipt ch WHERE ch.split_source_grn_id = g.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM erp_procurement.goods_receipt ch
    WHERE ch.split_source_grn_id = g.id AND ch.stock_ledger_id IS NOT NULL
  );

NOTIFY pgrst, 'reload schema';
