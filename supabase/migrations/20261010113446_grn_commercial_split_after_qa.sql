-- GRN invoice split after QA / stock movement.
--
-- A Bulk GRN's P101 is the physical receipt. Invoices may arrive only after
-- QA moved that stock to another bucket, so replacing the P101 with P102+N
-- P101 rows is both unnecessary and unsafe. This migration makes a split a
-- commercial operation: N child GRNs hold invoice and AC01 data, while the
-- source keeps its one physical ledger and is revalued from the children.

CREATE OR REPLACE FUNCTION erp_procurement.recalculate_commercial_split_valuation(
  p_source_grn_id uuid,
  p_actor uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = erp_procurement, erp_inventory, public
AS $function$
DECLARE
  v_source RECORD;
  v_source_qty_base numeric;
  v_total_value numeric;
  v_valuation_rate numeric;
  v_recalc_result jsonb;
BEGIN
  SELECT id, stock_ledger_id, received_qty, per_pack_qty
  INTO v_source
  FROM erp_procurement.goods_receipt
  WHERE id = p_source_grn_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'GRN_SPLIT_SOURCE_NOT_FOUND';
  END IF;
  IF v_source.stock_ledger_id IS NULL THEN
    RAISE EXCEPTION 'GRN_SPLIT_SOURCE_LEDGER_NOT_FOUND';
  END IF;

  v_source_qty_base := COALESCE(v_source.received_qty, 0)
    * CASE WHEN COALESCE(v_source.per_pack_qty, 0) > 0 THEN v_source.per_pack_qty ELSE 1 END;
  IF v_source_qty_base <= 0 THEN
    RAISE EXCEPTION 'GRN_SPLIT_SOURCE_QTY_INVALID';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM erp_procurement.goods_receipt c
    WHERE c.split_source_grn_id = p_source_grn_id
      AND c.status = 'POSTED'
      AND COALESCE(c.considered_qty, c.received_qty, 0) <= 0
  ) THEN
    RAISE EXCEPTION 'GRN_SPLIT_CONSIDERED_QTY_INVALID';
  END IF;

  SELECT COALESCE(SUM(
    (COALESCE(c.received_qty, 0)
      * CASE WHEN COALESCE(c.per_pack_qty, 0) > 0 THEN c.per_pack_qty ELSE 1 END)
    * (
      COALESCE(c.confirmed_rate, c.invoice_rate, c.grn_rate, 0)
        / CASE WHEN COALESCE(c.per_pack_qty, 0) > 0 THEN c.per_pack_qty ELSE 1 END
      + COALESCE(costs.net_landed_cost, 0)
        / NULLIF(
          COALESCE(c.considered_qty, c.received_qty, 0)
            * CASE WHEN COALESCE(c.per_pack_qty, 0) > 0 THEN c.per_pack_qty ELSE 1 END,
          0
        )
    )
  ), 0)
  INTO v_total_value
  FROM erp_procurement.goods_receipt c
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(
      CASE
        WHEN l.entry_mode = 'PER_UOM' THEN l.amount
          * (COALESCE(c.considered_qty, c.received_qty, 0)
             * CASE WHEN COALESCE(c.per_pack_qty, 0) > 0 THEN c.per_pack_qty ELSE 1 END)
        ELSE l.amount
      END
      * CASE
          WHEN l.cost_type = 'ADDITIONAL_DUTY_IGST' THEN 0
          WHEN COALESCE(l.has_gst, false)
            AND l.gst_treatment = 'INCLUSIVE'
            AND COALESCE(l.gst_rate, 0) > 0
            THEN 1 / (1 + l.gst_rate / 100)
          ELSE 1
        END
    ), 0)
    + COALESCE((
      SELECT SUM(COALESCE(d.amount, 0) + COALESCE(d.round_off, 0))
      FROM erp_procurement.landed_cost lc_d
      JOIN erp_procurement.landed_cost_deduction_line d ON d.lc_id = lc_d.id
      WHERE lc_d.id = (
        SELECT latest_lc.id
        FROM erp_procurement.landed_cost latest_lc
        WHERE latest_lc.grn_id = c.id
        ORDER BY latest_lc.created_at DESC
        LIMIT 1
      )
        AND d.in_landed = true
    ), 0) AS net_landed_cost
    FROM erp_procurement.landed_cost lc
    JOIN erp_procurement.landed_cost_line l ON l.lc_id = lc.id
    WHERE lc.id = (
      SELECT latest_lc.id
      FROM erp_procurement.landed_cost latest_lc
      WHERE latest_lc.grn_id = c.id
      ORDER BY latest_lc.created_at DESC
      LIMIT 1
    )
  ) costs ON true
  WHERE c.split_source_grn_id = p_source_grn_id
    AND c.status = 'POSTED';

  v_valuation_rate := round(v_total_value / v_source_qty_base, 6);
  v_recalc_result := erp_inventory.recalculate_valuation_at_row(
    v_source.stock_ledger_id, v_valuation_rate, p_actor, p_reason
  );

  RETURN jsonb_build_object(
    'source_grn_id', p_source_grn_id,
    'source_stock_ledger_id', v_source.stock_ledger_id,
    'valuation_rate', v_valuation_rate,
    'recalc_result', v_recalc_result
  );
END;
$function$;

REVOKE ALL ON FUNCTION erp_procurement.recalculate_commercial_split_valuation(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_procurement.recalculate_commercial_split_valuation(uuid, uuid, text) TO service_role;

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

  -- REVERSED remains the established AC01 non-payable marker. It is a
  -- commercial supersession here only: deliberately do not touch
  -- movement_type_code, stock_document_id, stock_ledger_id, or stock rows.
  UPDATE erp_procurement.goods_receipt
  SET status = 'REVERSED',
      reversal_grn_id = id,
      reversal_approved_by = p_actor,
      reversal_approved_at = now(),
      reversal_reason = COALESCE(NULLIF(p_reason, ''), 'Commercial invoice split'),
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
        'reversal_reason', NULL
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

-- The base AC01 save already stores every invoice's own landed-cost and
-- payable data. Wrap it so a child GRN additionally revalues the one source
-- physical receipt, while ordinary GRNs retain exactly the existing path.
CREATE OR REPLACE FUNCTION erp_procurement.save_ac01_grn_cost_with_verification(
  p_grn_id uuid, p_actor uuid, p_confirmed_rate numeric DEFAULT NULL,
  p_last_mile_transporter_id uuid DEFAULT NULL, p_invoice_number text DEFAULT NULL,
  p_invoice_date date DEFAULT NULL, p_gst_pct numeric DEFAULT NULL,
  p_cost_lines jsonb DEFAULT '[]'::jsonb, p_deduction_lines jsonb DEFAULT '[]'::jsonb,
  p_reason text DEFAULT 'AC01 landed cost save', p_revised_payment_date date DEFAULT NULL,
  p_vendor_payable_override numeric DEFAULT NULL, p_transporter_payable_override numeric DEFAULT NULL,
  p_last_mile_payable_override numeric DEFAULT NULL, p_cha_payable_override numeric DEFAULT NULL,
  p_clear_revised_payment_date boolean DEFAULT false, p_clear_vendor_payable_override boolean DEFAULT false,
  p_clear_transporter_payable_override boolean DEFAULT false, p_clear_last_mile_payable_override boolean DEFAULT false,
  p_clear_cha_payable_override boolean DEFAULT false, p_considered_qty numeric DEFAULT NULL,
  p_invoice_verified boolean DEFAULT false, p_clear_invoice_verification boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = erp_procurement, erp_inventory, public
AS $function$
DECLARE
  v_result jsonb;
  v_split_source_grn_id uuid;
  v_split_valuation jsonb;
BEGIN
  v_result := erp_procurement.save_ac01_grn_cost(
    p_grn_id, p_actor, p_confirmed_rate, p_last_mile_transporter_id,
    p_invoice_number, p_invoice_date, p_gst_pct, p_cost_lines,
    p_deduction_lines, p_reason, p_revised_payment_date,
    p_vendor_payable_override, p_transporter_payable_override,
    p_last_mile_payable_override, p_cha_payable_override,
    p_clear_revised_payment_date, p_clear_vendor_payable_override,
    p_clear_transporter_payable_override, p_clear_last_mile_payable_override,
    p_clear_cha_payable_override, p_considered_qty
  );

  UPDATE erp_procurement.goods_receipt
  SET invoice_verified_by = CASE WHEN p_invoice_verified THEN p_actor WHEN p_clear_invoice_verification THEN NULL ELSE invoice_verified_by END,
      invoice_verified_at = CASE WHEN p_invoice_verified THEN now() WHEN p_clear_invoice_verification THEN NULL ELSE invoice_verified_at END
  WHERE id = p_grn_id
  RETURNING split_source_grn_id INTO v_split_source_grn_id;

  IF v_split_source_grn_id IS NOT NULL THEN
    UPDATE erp_procurement.landed_cost
    SET status = 'POSTED', posted_by = p_actor, posted_at = now()
    WHERE id = (
      SELECT latest_lc.id
      FROM erp_procurement.landed_cost latest_lc
      WHERE latest_lc.grn_id = p_grn_id
      ORDER BY latest_lc.created_at DESC
      LIMIT 1
    );
    v_split_valuation := erp_procurement.recalculate_commercial_split_valuation(
      v_split_source_grn_id, p_actor, COALESCE(NULLIF(p_reason, ''), 'AC01 commercial split valuation')
    );
    v_result := v_result || jsonb_build_object('split_source_valuation', v_split_valuation);
  END IF;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION erp_procurement.save_ac01_grn_cost_with_verification(
  uuid, uuid, numeric, uuid, text, date, numeric, jsonb, jsonb, text, date,
  numeric, numeric, numeric, numeric, boolean, boolean, boolean, boolean,
  boolean, numeric, boolean, boolean
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_procurement.save_ac01_grn_cost_with_verification(
  uuid, uuid, numeric, uuid, text, date, numeric, jsonb, jsonb, text, date,
  numeric, numeric, numeric, numeric, boolean, boolean, boolean, boolean,
  boolean, numeric, boolean, boolean
) TO service_role;
