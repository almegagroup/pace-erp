-- Correct more than one historical receipt in the same inventory bucket in
-- one replay. Calling recalculate_valuation_at_row once per root is not safe:
-- each call starts from immutable ledger rates and therefore discards the
-- earlier root's substituted rate. This companion is deliberately additive;
-- the established one-row function remains available to existing callers.
--
-- Reversal note: stock_ledger is immutable. A later P262/P102 IN reversal is
-- valued using its original P261/P101 OUT row. During a replay that OUT value
-- may have changed, so the reversal must restore the simulated OUT rate, not
-- its immutable stored rate.

CREATE OR REPLACE FUNCTION erp_inventory.recalculate_valuation_at_rows(
  p_corrections jsonb, -- [{"stock_ledger_id":"...","new_rate":12.34}, ...]
  p_actor uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = erp_inventory, public
AS $fn$
DECLARE
  v_target RECORD;
  v_bucket RECORD;
  v_snapshot RECORD;
  v_row RECORD;
  v_correction_count integer;
  v_sim_qty numeric := 0;
  v_sim_rate numeric := 0;
  v_row_rate numeric;
  v_old_rate numeric;
  v_value_corrected numeric;
  v_value_original numeric;
  v_impacted jsonb := '[]'::jsonb;
  v_out_rates jsonb := '{}'::jsonb;
  v_target_rates jsonb := '{}'::jsonb;
  v_reversal_rate numeric;
  v_seen_first boolean := false;
BEGIN
  IF jsonb_typeof(p_corrections) <> 'array' OR jsonb_array_length(p_corrections) = 0 THEN
    RAISE EXCEPTION 'VALUATION_RECALC_CORRECTIONS_REQUIRED';
  END IF;

  CREATE TEMP TABLE _valuation_recalc_targets (
    stock_ledger_id uuid PRIMARY KEY,
    new_rate numeric NOT NULL
  ) ON COMMIT DROP;

  INSERT INTO _valuation_recalc_targets (stock_ledger_id, new_rate)
  SELECT (entry->>'stock_ledger_id')::uuid, (entry->>'new_rate')::numeric
  FROM jsonb_array_elements(p_corrections) entry;

  SELECT count(*) INTO v_correction_count FROM _valuation_recalc_targets;
  IF v_correction_count <> jsonb_array_length(p_corrections) THEN
    RAISE EXCEPTION 'VALUATION_RECALC_DUPLICATE_TARGET';
  END IF;
  IF EXISTS (SELECT 1 FROM _valuation_recalc_targets WHERE new_rate < 0 OR new_rate IS NULL) THEN
    RAISE EXCEPTION 'VALUATION_RECALC_RATE_INVALID';
  END IF;

  SELECT sl.company_id, sl.material_id, sl.storage_location_id, sl.stock_type_code
  INTO v_bucket
  FROM erp_inventory.stock_ledger sl
  JOIN _valuation_recalc_targets t ON t.stock_ledger_id = sl.id
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'VALUATION_RECALC_TARGET_NOT_FOUND';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM _valuation_recalc_targets t
    LEFT JOIN erp_inventory.stock_ledger sl ON sl.id = t.stock_ledger_id
    WHERE sl.id IS NULL
       OR sl.direction <> 'IN'
       OR sl.company_id <> v_bucket.company_id
       OR sl.material_id <> v_bucket.material_id
       OR sl.storage_location_id <> v_bucket.storage_location_id
       OR sl.stock_type_code <> v_bucket.stock_type_code
  ) THEN
    RAISE EXCEPTION 'VALUATION_RECALC_TARGET_BUCKET_INVALID';
  END IF;

  SELECT * INTO v_snapshot
  FROM erp_inventory.stock_snapshot
  WHERE company_id = v_bucket.company_id
    AND material_id = v_bucket.material_id
    AND storage_location_id = v_bucket.storage_location_id
    AND stock_type_code = v_bucket.stock_type_code
    AND batch_id IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'VALUATION_RECALC_SNAPSHOT_NOT_FOUND';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM erp_inventory.valuation_correction_log log
    JOIN _valuation_recalc_targets t ON t.stock_ledger_id = log.target_ledger_id
  ) THEN
    RAISE EXCEPTION 'VALUATION_RECALC_ALREADY_DONE';
  END IF;

  SELECT jsonb_object_agg(stock_ledger_id::text, new_rate)
  INTO v_target_rates
  FROM _valuation_recalc_targets;
  v_old_rate := v_snapshot.valuation_rate;

  FOR v_row IN
    SELECT sl.id, sl.stock_document_id, sl.direction, sl.quantity, sl.valuation_rate,
           sd.reversal_document_id, sd.reference_document_type,
           sd.reference_document_id, sd.document_number
    FROM erp_inventory.stock_ledger sl
    LEFT JOIN erp_inventory.stock_document sd ON sd.id = sl.stock_document_id
    WHERE sl.company_id = v_bucket.company_id
      AND sl.material_id = v_bucket.material_id
      AND sl.storage_location_id = v_bucket.storage_location_id
      AND sl.stock_type_code = v_bucket.stock_type_code
    ORDER BY sl.posting_date, sl.created_at, sl.ledger_seq
  LOOP
    IF NOT v_seen_first THEN
      v_seen_first := true;
      v_sim_qty := v_row.quantity;
      v_sim_rate := COALESCE((v_target_rates ->> v_row.id::text)::numeric, v_row.valuation_rate);
      IF v_row.direction = 'OUT' THEN
        v_out_rates := v_out_rates || jsonb_build_object(v_row.stock_document_id::text, v_sim_rate);
      END IF;
      CONTINUE;
    END IF;

    IF v_row.direction = 'OUT' THEN
      v_out_rates := v_out_rates || jsonb_build_object(v_row.stock_document_id::text, v_sim_rate);
      v_value_corrected := v_row.quantity * v_sim_rate;
      v_value_original := v_row.quantity * v_row.valuation_rate;
      v_sim_qty := v_sim_qty - v_row.quantity;
      IF abs(v_value_corrected - v_value_original) > 0.0001 THEN
        v_impacted := v_impacted || jsonb_build_object(
          'stock_ledger_id', v_row.id,
          'stock_document_id', v_row.stock_document_id,
          'reference_document_type', v_row.reference_document_type,
          'reference_document_id', v_row.reference_document_id,
          'document_number', v_row.document_number,
          'quantity', v_row.quantity,
          'original_rate', v_row.valuation_rate,
          'corrected_rate', v_sim_rate,
          'value_delta', v_value_corrected - v_value_original
        );
      END IF;
    ELSE
      v_row_rate := COALESCE((v_target_rates ->> v_row.id::text)::numeric, v_row.valuation_rate);
      IF v_row.reversal_document_id IS NOT NULL THEN
        v_reversal_rate := (v_out_rates ->> v_row.reversal_document_id::text)::numeric;
        IF v_reversal_rate IS NOT NULL THEN
          v_row_rate := v_reversal_rate;
        END IF;
      END IF;
      v_sim_rate := (v_sim_qty * v_sim_rate + v_row.quantity * v_row_rate) / NULLIF(v_sim_qty + v_row.quantity, 0);
      v_sim_qty := v_sim_qty + v_row.quantity;
    END IF;
  END LOOP;

  IF abs(v_sim_qty - v_snapshot.quantity) > 0.001 THEN
    RAISE EXCEPTION 'VALUATION_RECALC_QTY_MISMATCH: simulated % vs snapshot %', v_sim_qty, v_snapshot.quantity;
  END IF;

  UPDATE erp_inventory.stock_snapshot
  SET valuation_rate = v_sim_rate,
      value = v_sim_qty * v_sim_rate,
      last_updated_at = now()
  WHERE id = v_snapshot.id;

  INSERT INTO erp_inventory.valuation_correction_log (
    company_id, material_id, storage_location_id, stock_type_code,
    old_rate, new_rate, quantity_on_hand, impacted_rows, reason, created_by, target_ledger_id
  )
  SELECT v_bucket.company_id, v_bucket.material_id, v_bucket.storage_location_id, v_bucket.stock_type_code,
         v_old_rate, v_sim_rate, v_sim_qty, v_impacted, p_reason, p_actor, t.stock_ledger_id
  FROM _valuation_recalc_targets t;

  RETURN jsonb_build_object(
    'company_id', v_bucket.company_id,
    'material_id', v_bucket.material_id,
    'storage_location_id', v_bucket.storage_location_id,
    'stock_type_code', v_bucket.stock_type_code,
    'old_rate', v_old_rate,
    'new_rate', v_sim_rate,
    'quantity_on_hand', v_sim_qty,
    'target_ledger_ids', (SELECT jsonb_agg(stock_ledger_id) FROM _valuation_recalc_targets),
    'impacted_rows', v_impacted
  );
END;
$fn$;

REVOKE ALL ON FUNCTION erp_inventory.recalculate_valuation_at_rows(jsonb, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_inventory.recalculate_valuation_at_rows(jsonb, uuid, text) TO service_role;

COMMENT ON FUNCTION erp_inventory.recalculate_valuation_at_rows(jsonb, uuid, text) IS
  'Multi-root historical valuation replay for one stock snapshot bucket. Applies every requested IN receipt rate simultaneously and values later reversal IN rows using their simulated original OUT rate.';

-- MTS produces FG directly through one or more linked Packing POs; it has no
-- process_order.fg_stock_ledger_id. Its cost must be calculated from every
-- actual P261 issue across its batches, net of any P262 reversal, rather than
-- from the one batch anchor stored on process_order_line.
CREATE OR REPLACE FUNCTION erp_production.recompute_mts_fg_cost(
  p_process_order_id uuid,
  p_corrections jsonb -- [{"stock_ledger_id":"...","corrected_rate":12.34}, ...]
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = erp_production, erp_inventory, public
AS $fn$
DECLARE
  v_actual_qty numeric;
  v_total_value numeric;
BEGIN
  SELECT actual_qty INTO v_actual_qty
  FROM erp_production.process_order
  WHERE id = p_process_order_id AND po_type = 'MTS';

  IF NOT FOUND OR v_actual_qty IS NULL OR v_actual_qty <= 0 THEN
    RAISE EXCEPTION 'VALUATION_RECALC_MTS_PROCESS_ORDER_INVALID';
  END IF;

  WITH issue AS (
    SELECT sl.id AS stock_ledger_id, sd.id AS stock_document_id, sl.quantity,
           sl.valuation_rate
    FROM erp_inventory.stock_ledger sl
    JOIN erp_inventory.stock_document sd ON sd.id = sl.stock_document_id
    WHERE sd.reference_document_type = 'PROC_PO'
      AND sd.reference_document_id = p_process_order_id
      AND sl.movement_type_code = 'P261'
      AND sl.direction = 'OUT'
  ), reversal AS (
    SELECT sd.reversal_document_id AS original_document_id,
           sum(sl.quantity) AS quantity
    FROM erp_inventory.stock_document sd
    JOIN erp_inventory.stock_ledger sl ON sl.stock_document_id = sd.id
    WHERE sl.movement_type_code = 'P262'
      AND sl.direction = 'IN'
      AND sd.reversal_document_id IS NOT NULL
    GROUP BY sd.reversal_document_id
  ), correction AS (
    SELECT (entry->>'stock_ledger_id')::uuid AS stock_ledger_id,
           (entry->>'corrected_rate')::numeric AS corrected_rate
    FROM jsonb_array_elements(COALESCE(p_corrections, '[]'::jsonb)) entry
  )
  SELECT sum((issue.quantity - COALESCE(reversal.quantity, 0))
             * COALESCE(correction.corrected_rate, issue.valuation_rate))
  INTO v_total_value
  FROM issue
  LEFT JOIN reversal ON reversal.original_document_id = issue.stock_document_id
  LEFT JOIN correction ON correction.stock_ledger_id = issue.stock_ledger_id;

  IF v_total_value IS NULL THEN
    RAISE EXCEPTION 'VALUATION_RECALC_MTS_ISSUES_NOT_FOUND';
  END IF;

  RETURN v_total_value / v_actual_qty;
END;
$fn$;

REVOKE ALL ON FUNCTION erp_production.recompute_mts_fg_cost(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_production.recompute_mts_fg_cost(uuid, jsonb) TO service_role;

COMMENT ON FUNCTION erp_production.recompute_mts_fg_cost(uuid, jsonb) IS
  'Recomputes MTS direct-FG cost from every P261 issue across all batches, net of P262 reversals. Supports corrected historical issue rates supplied by the valuation cascade.';

