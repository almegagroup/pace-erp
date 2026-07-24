-- ============================================================================
-- Opening Rate "Recalculate" — one-time-use guard (feasibility §109, business
-- owner follow-up 2026-07-24): each (company, material, storage_location,
-- stock_type) may only be recalculated ONCE. A second attempt must be
-- rejected until a future "reopen" mechanism (deliberately not designed yet)
-- explicitly allows it again.
--
-- erp_inventory.valuation_correction_log is already the append-only audit
-- trail for every correction — its own existence for a given key IS the
-- lock, no separate flag/column needed.
-- ============================================================================

CREATE OR REPLACE FUNCTION erp_inventory.recalculate_valuation(
  p_company_id          uuid,
  p_material_id         uuid,
  p_storage_location_id uuid,
  p_stock_type_code     text,
  p_new_opening_rate    numeric,
  p_actor               uuid,
  p_reason              text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = erp_inventory, public
AS $fn$
DECLARE
  v_snapshot        RECORD;
  v_old_rate        numeric;
  v_sim_qty         numeric := 0;
  v_sim_rate        numeric := 0;
  v_row             RECORD;
  v_opening_found   boolean := false;
  v_impacted        jsonb := '[]'::jsonb;
  v_value_corrected numeric;
  v_value_original  numeric;
BEGIN
  IF p_new_opening_rate IS NULL OR p_new_opening_rate < 0 THEN
    RAISE EXCEPTION 'VALUATION_RECALC_RATE_INVALID';
  END IF;

  -- One-time-use lock: a prior correction for this exact key already exists.
  IF EXISTS (
    SELECT 1 FROM erp_inventory.valuation_correction_log
    WHERE company_id = p_company_id
      AND material_id = p_material_id
      AND storage_location_id = p_storage_location_id
      AND stock_type_code = p_stock_type_code
  ) THEN
    RAISE EXCEPTION 'VALUATION_RECALC_ALREADY_DONE';
  END IF;

  -- Row lock first — same concurrency discipline as post_stock_movement().
  SELECT * INTO v_snapshot
  FROM erp_inventory.stock_snapshot
  WHERE company_id = p_company_id
    AND material_id = p_material_id
    AND storage_location_id = p_storage_location_id
    AND stock_type_code = p_stock_type_code
    AND batch_id IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'VALUATION_RECALC_SNAPSHOT_NOT_FOUND';
  END IF;

  v_old_rate := v_snapshot.valuation_rate;

  FOR v_row IN
    SELECT sl.id, sl.direction, sl.quantity, sl.valuation_rate,
           sd.reference_document_type, sd.reference_document_id, sd.document_number
    FROM erp_inventory.stock_ledger sl
    LEFT JOIN erp_inventory.stock_document sd ON sd.id = sl.stock_document_id
    WHERE sl.company_id = p_company_id
      AND sl.material_id = p_material_id
      AND sl.storage_location_id = p_storage_location_id
      AND sl.stock_type_code = p_stock_type_code
    ORDER BY sl.posting_date, sl.created_at, sl.ledger_seq
  LOOP
    IF NOT v_opening_found THEN
      v_sim_qty := v_row.quantity;
      v_sim_rate := p_new_opening_rate;
      v_opening_found := true;
      CONTINUE;
    END IF;

    IF v_row.direction = 'IN' THEN
      v_sim_rate := (v_sim_qty * v_sim_rate + v_row.quantity * v_row.valuation_rate) / (v_sim_qty + v_row.quantity);
      v_sim_qty := v_sim_qty + v_row.quantity;
    ELSE
      v_value_corrected := v_row.quantity * v_sim_rate;
      v_value_original := v_row.quantity * v_row.valuation_rate;
      v_sim_qty := v_sim_qty - v_row.quantity;
      IF abs(v_value_corrected - v_value_original) > 0.0001 THEN
        v_impacted := v_impacted || jsonb_build_object(
          'stock_ledger_id', v_row.id,
          'reference_document_type', v_row.reference_document_type,
          'reference_document_id', v_row.reference_document_id,
          'document_number', v_row.document_number,
          'quantity', v_row.quantity,
          'original_rate', v_row.valuation_rate,
          'corrected_rate', v_sim_rate,
          'value_delta', v_value_corrected - v_value_original
        );
      END IF;
    END IF;
  END LOOP;

  IF NOT v_opening_found THEN
    RAISE EXCEPTION 'VALUATION_RECALC_NO_LEDGER_ROWS';
  END IF;

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
    old_rate, new_rate, quantity_on_hand, impacted_rows, reason, created_by
  ) VALUES (
    p_company_id, p_material_id, p_storage_location_id, p_stock_type_code,
    v_old_rate, v_sim_rate, v_sim_qty, v_impacted, p_reason, p_actor
  );

  RETURN jsonb_build_object(
    'old_rate', v_old_rate,
    'new_rate', v_sim_rate,
    'quantity_on_hand', v_sim_qty,
    'impacted_rows', v_impacted
  );
END;
$fn$;

COMMENT ON FUNCTION erp_inventory.recalculate_valuation(uuid, uuid, uuid, text, numeric, uuid, text) IS
  'Phase 1 of the Opening Rate "Recalculate" mechanism (feasibility §109) — one-time-use per (company, material, storage_location, stock_type); a second call on the same key raises VALUATION_RECALC_ALREADY_DONE until a future "reopen" mechanism is designed. Corrects one material''s own stock_snapshot.valuation_rate by replaying its full stock_ledger history in chronological order from a corrected opening rate. Logs impacted OUT rows for Phase 2/3 cascade (SFG/FG), does not cascade itself.';
