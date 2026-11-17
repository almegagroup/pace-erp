-- Leg-rate memory for the valuation replay (recalculate_valuation_at_row / _at_rows).
-- stock_ledger is append-only, so a leg an earlier correction fixed still carries its original wrong rate there; every later
-- replay of the same bucket that did not list that leg as a target silently re-applied the wrong rate. Each correction now
-- records the corrected leg rate (valuation_correction_log.target_leg_rate) and replays prefer the latest recorded one.
-- Corrections made before this migration have no recorded leg rate (NULL), so they behave exactly as before.
ALTER TABLE erp_inventory.valuation_correction_log ADD COLUMN IF NOT EXISTS target_leg_rate numeric;

CREATE OR REPLACE FUNCTION erp_inventory.recalculate_valuation_at_rows(p_corrections jsonb, p_actor uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'erp_inventory', 'public'
AS $function$
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
  v_memory jsonb := '{}'::jsonb;
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

  SELECT jsonb_object_agg(stock_ledger_id::text, new_rate)
  INTO v_target_rates
  FROM _valuation_recalc_targets;

  -- Leg-rate memory: the ledger is append-only, so a leg that an earlier correction fixed still shows its ORIGINAL (wrong) rate
  -- there. Replaying the bucket from the ledger alone would silently undo those earlier corrections for every leg that is not a
  -- target of THIS call. The latest recorded corrected leg rate per ledger row is used instead (a target of this call still wins).
  SELECT COALESCE(jsonb_object_agg(x.target_ledger_id::text, x.target_leg_rate), '{}'::jsonb)
  INTO v_memory
  FROM (
    SELECT DISTINCT ON (v.target_ledger_id) v.target_ledger_id, v.target_leg_rate
    FROM erp_inventory.valuation_correction_log v
    WHERE v.company_id = v_bucket.company_id
      AND v.material_id = v_bucket.material_id
      AND v.storage_location_id = v_bucket.storage_location_id
      AND v.stock_type_code = v_bucket.stock_type_code
      AND v.target_leg_rate IS NOT NULL
    ORDER BY v.target_ledger_id, v.created_at DESC
  ) x;
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
      v_sim_rate := COALESCE((v_target_rates ->> v_row.id::text)::numeric, (v_memory ->> v_row.id::text)::numeric, v_row.valuation_rate);
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
      v_row_rate := COALESCE((v_target_rates ->> v_row.id::text)::numeric, (v_memory ->> v_row.id::text)::numeric, v_row.valuation_rate);
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
    old_rate, new_rate, quantity_on_hand, impacted_rows, reason, created_by, target_ledger_id, target_leg_rate
  )
  SELECT v_bucket.company_id, v_bucket.material_id, v_bucket.storage_location_id, v_bucket.stock_type_code,
         v_old_rate, v_sim_rate, v_sim_qty, v_impacted, p_reason, p_actor, t.stock_ledger_id, t.new_rate
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
$function$;


CREATE OR REPLACE FUNCTION erp_inventory.recalculate_valuation_at_row(p_target_ledger_id uuid, p_new_rate numeric, p_actor uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'erp_inventory', 'public'
AS $function$
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
  v_memory          jsonb := '{}'::jsonb;
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

  -- 2026-08-21: one-time-use guard removed here so a GRN's landed cost/rate can be corrected repeatedly.

  -- Leg-rate memory (see recalculate_valuation_at_rows): earlier corrections of other legs in this bucket are kept.
  SELECT COALESCE(jsonb_object_agg(x.target_ledger_id::text, x.target_leg_rate), '{}'::jsonb)
  INTO v_memory
  FROM (
    SELECT DISTINCT ON (v.target_ledger_id) v.target_ledger_id, v.target_leg_rate
    FROM erp_inventory.valuation_correction_log v
    WHERE v.company_id = v_target.company_id
      AND v.material_id = v_target.material_id
      AND v.storage_location_id = v_target.storage_location_id
      AND v.stock_type_code = v_target.stock_type_code
      AND v.target_leg_rate IS NOT NULL
    ORDER BY v.target_ledger_id, v.created_at DESC
  ) x;

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
      v_sim_rate := CASE WHEN v_row.id = p_target_ledger_id THEN p_new_rate
                         ELSE COALESCE((v_memory ->> v_row.id::text)::numeric, v_row.valuation_rate) END;
      CONTINUE;
    END IF;

    IF v_row.direction = 'IN' THEN
      v_row_rate := CASE WHEN v_row.id = p_target_ledger_id THEN p_new_rate
                         ELSE COALESCE((v_memory ->> v_row.id::text)::numeric, v_row.valuation_rate) END;
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
    old_rate, new_rate, quantity_on_hand, impacted_rows, reason, created_by, target_ledger_id, target_leg_rate
  ) VALUES (
    v_target.company_id, v_target.material_id, v_target.storage_location_id, v_target.stock_type_code,
    v_old_rate, v_sim_rate, v_sim_qty, v_impacted, p_reason, p_actor, p_target_ledger_id, p_new_rate
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
$function$;

NOTIFY pgrst, 'reload schema';
