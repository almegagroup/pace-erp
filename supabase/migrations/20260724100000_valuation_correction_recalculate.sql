-- ============================================================================
-- Opening Rate Correction — "Recalculate" mechanism, Phase 1 (feasibility §109)
--
-- Business trigger: Commercial team can't supply the real WAR (Weighted
-- Average Rate) in time for go-live; RM/PM Opening Rate starts as a
-- provisional number and gets corrected ONCE when the real rate (target:
-- 31 July's closing WAR) arrives.
--
-- Locked mechanism (§109.2, business owner a/b/c): full replay of every
-- stock_ledger row for that (company, material, storage_location,
-- stock_type) since Opening, in chronological order — NOT a shortcut
-- stock_snapshot overwrite. `stock_ledger` is append-only (§8C) so "replay"
-- means simulating the corrected chronological walk and applying only the
-- FINAL corrected state to stock_snapshot, with an audit row recording the
-- correction (same idiom as every other reversal/correction in this system
-- — history is never edited, only appended over).
--
-- Phase 1 scope (§109.5): corrects the ROOT material's (RM/PM) own
-- valuation_rate only. It also computes and logs which OUT-direction ledger
-- rows had a "value removed" that changes under the corrected rate — this
-- impacted-rows list is the input Phase 2 (SFG cascade) and Phase 3 (FG
-- cascade) will consume, recursively calling this same function. Phase 1
-- does NOT itself cascade — that is intentionally deferred and must not be
-- assumed to happen automatically until Phase 2/3 land.
-- ============================================================================

CREATE TABLE IF NOT EXISTS erp_inventory.valuation_correction_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  material_id uuid NOT NULL,
  storage_location_id uuid NOT NULL,
  stock_type_code text NOT NULL,
  old_rate numeric NOT NULL,
  new_rate numeric NOT NULL,
  quantity_on_hand numeric NOT NULL,
  impacted_rows jsonb NOT NULL DEFAULT '[]'::jsonb,
  reason text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE erp_inventory.valuation_correction_log IS
  'Audit trail for erp_inventory.recalculate_valuation() — every Opening Rate correction, never edited/deleted. feasibility §109.';

CREATE INDEX IF NOT EXISTS idx_valuation_correction_log_material
  ON erp_inventory.valuation_correction_log (company_id, material_id, storage_location_id, stock_type_code);

-- ============================================================================
-- recalculate_valuation — Phase 1 (single material, no cascade)
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

  -- Walk every ledger row for this exact stock position, chronologically.
  -- The FIRST row is the opening entry — seed the simulation with the
  -- CORRECTED rate instead of its originally recorded one. Every row after
  -- that is replayed in original order: IN blends (GRN's own rate is a fact
  -- and stays as-is — only the resulting blended average changes), OUT
  -- consumes at whatever the simulated rate is at that point (unchanged by
  -- the OUT itself, per the engine's own WAR rule) and its "value removed"
  -- is compared against what was originally recorded.
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

  -- Append-only ledger sum should always tie out to the live snapshot qty —
  -- if it doesn't, something upstream is already inconsistent and this
  -- correction must not proceed on top of an unknown discrepancy.
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
  'Phase 1 of the Opening Rate "Recalculate" mechanism (feasibility §109) — corrects one material''s own stock_snapshot.valuation_rate by replaying its full stock_ledger history in chronological order from a corrected opening rate. Logs impacted OUT rows for Phase 2/3 cascade (SFG/FG), does not cascade itself.';

REVOKE ALL ON FUNCTION erp_inventory.recalculate_valuation(uuid, uuid, uuid, text, numeric, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_inventory.recalculate_valuation(uuid, uuid, uuid, text, numeric, uuid, text) TO service_role;
