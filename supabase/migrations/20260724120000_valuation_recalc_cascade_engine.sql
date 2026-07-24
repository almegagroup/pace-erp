-- ============================================================================
-- Opening Rate "Recalculate" — cascade engine (feasibility §109, business
-- owner 2026-07-24: "recalculate must be fully automatic — one click, system
-- overwrites everything down the chain, nothing manual afterwards").
--
-- §109 Phase 1 (recalculate_valuation, migration 20260724100000/110000) only
-- knew how to correct a material's own OPENING (first) ledger row. Making
-- this cascade automatically into SFG and then FG needs a strictly more
-- general primitive: correct WHICHEVER ledger row we're told to, wherever it
-- sits in that material's timeline — the opening row is just the special
-- case where that row happens to be first. Everything before the target row
-- is left as-is (already correct, or already corrected by an earlier step of
-- the same cascade); everything at/after it is replayed forward exactly like
-- Phase 1 did.
--
-- One-time-use scope changes accordingly: Phase 1 locked per (company,
-- material, storage_location, stock_type) because a material only ever has
-- one opening row. That's no longer true once we can target ANY row — an
-- SFG material receives many production batches over time, each its own
-- correctable event. The lock now keys on the specific target_ledger_id.
-- ============================================================================

ALTER TABLE erp_inventory.valuation_correction_log
  ADD COLUMN IF NOT EXISTS target_ledger_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS ux_valuation_correction_log_target
  ON erp_inventory.valuation_correction_log (target_ledger_id)
  WHERE target_ledger_id IS NOT NULL;

DROP FUNCTION IF EXISTS erp_inventory.recalculate_valuation(uuid, uuid, uuid, text, numeric, uuid, text);

CREATE OR REPLACE FUNCTION erp_inventory.recalculate_valuation_at_row(
  p_target_ledger_id uuid,
  p_new_rate         numeric,
  p_actor            uuid,
  p_reason           text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = erp_inventory, public
AS $fn$
DECLARE
  v_target          RECORD;
  v_snapshot        RECORD;
  v_old_rate        numeric;
  v_sim_qty         numeric := 0;
  v_sim_rate        numeric := 0;
  v_row             RECORD;
  v_seen_first      boolean := false;
  v_seen_target     boolean := false;
  v_impacted        jsonb := '[]'::jsonb;
  v_value_corrected numeric;
  v_value_original  numeric;
  v_row_rate        numeric;
BEGIN
  IF p_new_rate IS NULL OR p_new_rate < 0 THEN
    RAISE EXCEPTION 'VALUATION_RECALC_RATE_INVALID';
  END IF;

  SELECT company_id, material_id, storage_location_id, stock_type_code, direction
  INTO v_target
  FROM erp_inventory.stock_ledger
  WHERE id = p_target_ledger_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'VALUATION_RECALC_TARGET_NOT_FOUND';
  END IF;
  IF v_target.direction <> 'IN' THEN
    RAISE EXCEPTION 'VALUATION_RECALC_TARGET_NOT_IN';
  END IF;

  -- Row lock BEFORE the one-time-use check, so two concurrent calls truly
  -- serialize on the same snapshot rather than both passing the guard.
  SELECT * INTO v_snapshot
  FROM erp_inventory.stock_snapshot
  WHERE company_id = v_target.company_id
    AND material_id = v_target.material_id
    AND storage_location_id = v_target.storage_location_id
    AND stock_type_code = v_target.stock_type_code
    AND batch_id IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'VALUATION_RECALC_SNAPSHOT_NOT_FOUND';
  END IF;

  IF EXISTS (SELECT 1 FROM erp_inventory.valuation_correction_log WHERE target_ledger_id = p_target_ledger_id) THEN
    RAISE EXCEPTION 'VALUATION_RECALC_ALREADY_DONE';
  END IF;

  v_old_rate := v_snapshot.valuation_rate;

  FOR v_row IN
    SELECT sl.id, sl.direction, sl.quantity, sl.valuation_rate,
           sd.reference_document_type, sd.reference_document_id, sd.document_number
    FROM erp_inventory.stock_ledger sl
    LEFT JOIN erp_inventory.stock_document sd ON sd.id = sl.stock_document_id
    WHERE sl.company_id = v_target.company_id
      AND sl.material_id = v_target.material_id
      AND sl.storage_location_id = v_target.storage_location_id
      AND sl.stock_type_code = v_target.stock_type_code
    ORDER BY sl.posting_date, sl.created_at, sl.ledger_seq
  LOOP
    IF v_row.id = p_target_ledger_id THEN
      v_seen_target := true;
    END IF;

    IF NOT v_seen_first THEN
      v_seen_first := true;
      v_sim_qty := v_row.quantity;
      v_sim_rate := CASE WHEN v_row.id = p_target_ledger_id THEN p_new_rate ELSE v_row.valuation_rate END;
      CONTINUE;
    END IF;

    IF v_row.direction = 'IN' THEN
      v_row_rate := CASE WHEN v_row.id = p_target_ledger_id THEN p_new_rate ELSE v_row.valuation_rate END;
      v_sim_rate := (v_sim_qty * v_sim_rate + v_row.quantity * v_row_rate) / (v_sim_qty + v_row.quantity);
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

  IF NOT v_seen_target THEN
    RAISE EXCEPTION 'VALUATION_RECALC_TARGET_NOT_IN_LEDGER_SET';
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
    old_rate, new_rate, quantity_on_hand, impacted_rows, reason, created_by, target_ledger_id
  ) VALUES (
    v_target.company_id, v_target.material_id, v_target.storage_location_id, v_target.stock_type_code,
    v_old_rate, v_sim_rate, v_sim_qty, v_impacted, p_reason, p_actor, p_target_ledger_id
  );

  RETURN jsonb_build_object(
    'company_id', v_target.company_id,
    'material_id', v_target.material_id,
    'storage_location_id', v_target.storage_location_id,
    'stock_type_code', v_target.stock_type_code,
    'old_rate', v_old_rate,
    'new_rate', v_sim_rate,
    'quantity_on_hand', v_sim_qty,
    'impacted_rows', v_impacted
  );
END;
$fn$;

COMMENT ON FUNCTION erp_inventory.recalculate_valuation_at_row(uuid, numeric, uuid, text) IS
  'Opening Rate "Recalculate" cascade engine, generalized (feasibility §109). Corrects the material/location/stock-type that p_target_ledger_id belongs to by replaying its full ledger history from that row forward with p_new_rate substituted for it. One-time-use per target_ledger_id. Callers (the TS cascade orchestrator) walk impacted_rows into process_order_line/packing_order_line to find downstream SFG/FG receipts and recurse.';

REVOKE ALL ON FUNCTION erp_inventory.recalculate_valuation_at_row(uuid, numeric, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_inventory.recalculate_valuation_at_row(uuid, numeric, uuid, text) TO service_role;

-- ============================================================================
-- Cascade step helpers — recompute what a downstream SFG/FG's cost SHOULD be
-- once one of its inputs' rate has been corrected. Mirror §104-2/§104-3's own
-- formulas exactly (process_order.handlers.ts/packing_order.handlers.ts),
-- using each already-issued line's own stock_ledger row (definitive record
-- of what was actually posted) instead of re-deriving current rates.
-- ============================================================================

CREATE OR REPLACE FUNCTION erp_production.recompute_sfg_cost_for_line(
  p_process_order_id      uuid,
  p_corrected_line_ledger_id uuid,
  p_corrected_rate        numeric
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = erp_production, erp_inventory, public
AS $fn$
DECLARE
  v_po               RECORD;
  v_total_rm_value   numeric := 0;
  v_conversion_rate  numeric;
  v_row              RECORD;
BEGIN
  SELECT actual_qty, company_id, segment_code, material_id, verified_at
  INTO v_po
  FROM erp_production.process_order
  WHERE id = p_process_order_id;

  IF NOT FOUND OR v_po.actual_qty IS NULL OR v_po.actual_qty <= 0 THEN
    RAISE EXCEPTION 'VALUATION_RECALC_PROCESS_ORDER_INVALID';
  END IF;

  FOR v_row IN
    SELECT pol.stock_ledger_id, sl.quantity, sl.valuation_rate
    FROM erp_production.process_order_line pol
    JOIN erp_inventory.stock_ledger sl ON sl.id = pol.stock_ledger_id
    WHERE pol.process_order_id = p_process_order_id
  LOOP
    IF v_row.stock_ledger_id = p_corrected_line_ledger_id THEN
      v_total_rm_value := v_total_rm_value + v_row.quantity * p_corrected_rate;
    ELSE
      v_total_rm_value := v_total_rm_value + v_row.quantity * v_row.valuation_rate;
    END IF;
  END LOOP;

  v_conversion_rate := COALESCE(
    erp_production.resolve_conversion_rate(v_po.company_id, v_po.segment_code, v_po.material_id, v_po.verified_at::date),
    0
  );

  RETURN (v_total_rm_value / v_po.actual_qty) + v_conversion_rate;
END;
$fn$;

COMMENT ON FUNCTION erp_production.recompute_sfg_cost_for_line(uuid, uuid, numeric) IS
  'Cascade step for §109 Recalculate — recomputes a Process PO''s SFG cost (mirrors §104-2''s sfgCostPerKg formula) with one RM/PM/INT line''s corrected rate substituted in.';

REVOKE ALL ON FUNCTION erp_production.recompute_sfg_cost_for_line(uuid, uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_production.recompute_sfg_cost_for_line(uuid, uuid, numeric) TO service_role;

CREATE OR REPLACE FUNCTION erp_production.recompute_fg_cost_for_line(
  p_packing_order_id      uuid,
  p_corrected_line_ledger_id uuid,
  p_corrected_rate        numeric
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = erp_production, erp_inventory, public
AS $fn$
DECLARE
  v_fg_qty        numeric;
  v_total_input   numeric := 0;
  v_row           RECORD;
BEGIN
  SELECT COALESCE(actual_qty, total_qty) INTO v_fg_qty
  FROM erp_production.packing_order_line
  WHERE packing_order_id = p_packing_order_id AND line_type = 'FG';

  IF v_fg_qty IS NULL OR v_fg_qty <= 0 THEN
    RAISE EXCEPTION 'VALUATION_RECALC_PACKING_ORDER_INVALID';
  END IF;

  FOR v_row IN
    SELECT pkl.stock_ledger_id, sl.quantity, sl.valuation_rate
    FROM erp_production.packing_order_line pkl
    JOIN erp_inventory.stock_ledger sl ON sl.id = pkl.stock_ledger_id
    WHERE pkl.packing_order_id = p_packing_order_id
      AND pkl.line_type <> 'FG'
  LOOP
    IF v_row.stock_ledger_id = p_corrected_line_ledger_id THEN
      v_total_input := v_total_input + v_row.quantity * p_corrected_rate;
    ELSE
      v_total_input := v_total_input + v_row.quantity * v_row.valuation_rate;
    END IF;
  END LOOP;

  RETURN v_total_input / v_fg_qty;
END;
$fn$;

COMMENT ON FUNCTION erp_production.recompute_fg_cost_for_line(uuid, uuid, numeric) IS
  'Cascade step for §109 Recalculate — recomputes a Packing PO''s FG cost (mirrors §104-3''s fgCostPerKg formula) with one SFG/PM line''s corrected rate substituted in.';

REVOKE ALL ON FUNCTION erp_production.recompute_fg_cost_for_line(uuid, uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_production.recompute_fg_cost_for_line(uuid, uuid, numeric) TO service_role;
