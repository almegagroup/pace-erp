-- Found live 2026-11-19 (CMP003 Fine Sand): Unrestricted WAR was 2.04/KG while a replay with each Inward QA release leg at its
-- GRN's real rate gives ~2.95. Old valuation corrections were logged WITHOUT the per-leg rate ("memory"), so every later bucket
-- replay silently dropped them, and split parents' release legs were never corrected at all.
--
-- These two functions are READ-ONLY helpers for the AC01 "GRN stock-value correction" tool (leg_sync mode):
--   erp_procurement.grn_net_landed_cost(grn)       -- same net landed cost as recalculate_commercial_split_valuation()
--   erp_procurement.derive_grn_leg_rates(grn_ids)  -- the base-UoM rate a GRN's stock should carry (commercial rate / base
--                                                     factor + landed cost per base unit); split parents = their children
--   erp_inventory.simulate_valuation_at_rows(corr) -- recalculate_valuation_at_rows() without any write: what the bucket WAR
--                                                     would become, so the dry run can show "now -> after".

CREATE OR REPLACE FUNCTION erp_procurement.grn_net_landed_cost(p_grn_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'erp_procurement', 'public'
AS $function$
  WITH c AS (SELECT * FROM erp_procurement.goods_receipt WHERE id = p_grn_id),
  lc AS (SELECT id FROM erp_procurement.landed_cost WHERE grn_id = p_grn_id ORDER BY created_at DESC LIMIT 1)
  SELECT COALESCE((
    SELECT SUM(
      CASE
        WHEN l.entry_mode = 'PER_UOM' THEN l.amount
          * (COALESCE(c.considered_qty, c.received_qty, 0)
             * CASE WHEN COALESCE(c.per_pack_qty, 0) > 0 THEN c.per_pack_qty ELSE 1 END)
        ELSE l.amount
      END
      * CASE
          WHEN l.cost_type = 'ADDITIONAL_DUTY_IGST' THEN 0
          WHEN COALESCE(l.has_gst, false) AND l.gst_treatment = 'INCLUSIVE' AND COALESCE(l.gst_rate, 0) > 0
            THEN 1 / (1 + l.gst_rate / 100)
          ELSE 1
        END)
    FROM erp_procurement.landed_cost_line l JOIN lc ON l.lc_id = lc.id CROSS JOIN c
  ), 0)
  + COALESCE((
    SELECT SUM(COALESCE(d.amount, 0) + COALESCE(d.round_off, 0))
    FROM erp_procurement.landed_cost_deduction_line d JOIN lc ON d.lc_id = lc.id
    WHERE d.in_landed = true
  ), 0);
$function$;

CREATE OR REPLACE FUNCTION erp_procurement.derive_grn_leg_rates(p_grn_ids uuid[])
 RETURNS TABLE(grn_id uuid, leg_rate numeric, basis text)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'erp_procurement', 'erp_inventory', 'public'
AS $function$
  -- Plain (POSTED) GRN: its commercial rate per base unit + its own landed cost per base unit. NULL while the rate is unknown
  -- (invoice-later GRN still waiting for its invoice) - such a leg must be left alone.
  SELECT g.id,
         CASE WHEN COALESCE(g.confirmed_rate, CASE WHEN g.rate_confirmed IS TRUE THEN g.invoice_rate END, g.grn_rate, 0) > 0
                   AND l.quantity > 0 AND g.received_qty > 0
              THEN round(
                COALESCE(g.confirmed_rate, CASE WHEN g.rate_confirmed IS TRUE THEN g.invoice_rate END, g.grn_rate)
                  / (l.quantity / g.received_qty)
                + erp_procurement.grn_net_landed_cost(g.id)
                  / NULLIF(COALESCE(g.considered_qty, g.received_qty, 0)
                           * CASE WHEN COALESCE(g.per_pack_qty, 0) > 0 THEN g.per_pack_qty ELSE 1 END, 0), 6)
         END,
         'GRN'::text
  FROM erp_procurement.goods_receipt g
  JOIN erp_inventory.stock_ledger l ON l.id = g.stock_ledger_id
  WHERE g.id = ANY (p_grn_ids) AND g.status = 'POSTED'
  UNION ALL
  -- Split parent: the one physical receipt is valued from ALL its child invoices (same math as
  -- recalculate_commercial_split_valuation). NULL if any child has no rate yet.
  SELECT g.id,
         CASE WHEN ch.n > 0 AND ch.unknown = 0 AND ch.value IS NOT NULL
              THEN round(ch.value / NULLIF(g.received_qty * CASE WHEN COALESCE(g.per_pack_qty, 0) > 0 THEN g.per_pack_qty ELSE 1 END, 0), 6)
         END,
         'SPLIT'::text
  FROM erp_procurement.goods_receipt g
  CROSS JOIN LATERAL (
    SELECT count(*) AS n,
           count(*) FILTER (WHERE COALESCE(c.confirmed_rate, c.invoice_rate, c.grn_rate, 0) <= 0) AS unknown,
           SUM(
             (COALESCE(c.received_qty, 0) * CASE WHEN COALESCE(c.per_pack_qty, 0) > 0 THEN c.per_pack_qty ELSE 1 END)
             * (COALESCE(c.confirmed_rate, c.invoice_rate, c.grn_rate, 0)
                  / CASE WHEN COALESCE(c.per_pack_qty, 0) > 0 THEN c.per_pack_qty ELSE 1 END
                + erp_procurement.grn_net_landed_cost(c.id)
                  / NULLIF(COALESCE(c.considered_qty, c.received_qty, 0)
                           * CASE WHEN COALESCE(c.per_pack_qty, 0) > 0 THEN c.per_pack_qty ELSE 1 END, 0))
           ) AS value
    FROM erp_procurement.goods_receipt c
    WHERE c.split_source_grn_id = g.id AND c.status = 'POSTED'
  ) ch
  WHERE g.id = ANY (p_grn_ids) AND g.status = 'SPLIT';
$function$;

CREATE OR REPLACE FUNCTION erp_inventory.simulate_valuation_at_rows(p_corrections jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'erp_inventory', 'public'
AS $function$
DECLARE
  v_bucket RECORD;
  v_snapshot RECORD;
  v_row RECORD;
  v_sim_qty numeric := 0;
  v_sim_rate numeric := 0;
  v_row_rate numeric;
  v_reversal_rate numeric;
  v_seen_first boolean := false;
  v_target_rates jsonb;
  v_memory jsonb := '{}'::jsonb;
  v_out_rates jsonb := '{}'::jsonb;
BEGIN
  IF jsonb_typeof(p_corrections) <> 'array' OR jsonb_array_length(p_corrections) = 0 THEN
    RAISE EXCEPTION 'VALUATION_SIMULATE_CORRECTIONS_REQUIRED';
  END IF;
  SELECT jsonb_object_agg(e->>'stock_ledger_id', (e->>'new_rate')::numeric)
  INTO v_target_rates FROM jsonb_array_elements(p_corrections) e;

  SELECT sl.company_id, sl.material_id, sl.storage_location_id, sl.stock_type_code
  INTO v_bucket FROM erp_inventory.stock_ledger sl
  WHERE sl.id = ((p_corrections -> 0) ->> 'stock_ledger_id')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'VALUATION_SIMULATE_TARGET_NOT_FOUND'; END IF;

  SELECT * INTO v_snapshot FROM erp_inventory.stock_snapshot
  WHERE company_id = v_bucket.company_id AND material_id = v_bucket.material_id
    AND storage_location_id = v_bucket.storage_location_id AND stock_type_code = v_bucket.stock_type_code AND batch_id IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'VALUATION_SIMULATE_SNAPSHOT_NOT_FOUND'; END IF;

  SELECT COALESCE(jsonb_object_agg(x.target_ledger_id::text, x.target_leg_rate), '{}'::jsonb) INTO v_memory
  FROM (SELECT DISTINCT ON (v.target_ledger_id) v.target_ledger_id, v.target_leg_rate
        FROM erp_inventory.valuation_correction_log v
        WHERE v.company_id = v_bucket.company_id AND v.material_id = v_bucket.material_id
          AND v.storage_location_id = v_bucket.storage_location_id AND v.stock_type_code = v_bucket.stock_type_code
          AND v.target_leg_rate IS NOT NULL
        ORDER BY v.target_ledger_id, v.created_at DESC) x;

  FOR v_row IN
    SELECT sl.id, sl.stock_document_id, sl.direction, sl.quantity, sl.valuation_rate, sd.reversal_document_id
    FROM erp_inventory.stock_ledger sl LEFT JOIN erp_inventory.stock_document sd ON sd.id = sl.stock_document_id
    WHERE sl.company_id = v_bucket.company_id AND sl.material_id = v_bucket.material_id
      AND sl.storage_location_id = v_bucket.storage_location_id AND sl.stock_type_code = v_bucket.stock_type_code
    ORDER BY sl.posting_date, sl.created_at, sl.ledger_seq
  LOOP
    IF NOT v_seen_first THEN
      v_seen_first := true;
      v_sim_qty := v_row.quantity;
      v_sim_rate := COALESCE((v_target_rates ->> v_row.id::text)::numeric, (v_memory ->> v_row.id::text)::numeric, v_row.valuation_rate);
      IF v_row.direction = 'OUT' THEN v_out_rates := v_out_rates || jsonb_build_object(v_row.stock_document_id::text, v_sim_rate); END IF;
      CONTINUE;
    END IF;
    IF v_row.direction = 'OUT' THEN
      v_out_rates := v_out_rates || jsonb_build_object(v_row.stock_document_id::text, v_sim_rate);
      v_sim_qty := v_sim_qty - v_row.quantity;
    ELSE
      v_row_rate := COALESCE((v_target_rates ->> v_row.id::text)::numeric, (v_memory ->> v_row.id::text)::numeric, v_row.valuation_rate);
      IF v_row.reversal_document_id IS NOT NULL THEN
        v_reversal_rate := (v_out_rates ->> v_row.reversal_document_id::text)::numeric;
        IF v_reversal_rate IS NOT NULL THEN v_row_rate := v_reversal_rate; END IF;
      END IF;
      v_sim_rate := (v_sim_qty * v_sim_rate + v_row.quantity * v_row_rate) / NULLIF(v_sim_qty + v_row.quantity, 0);
      v_sim_qty := v_sim_qty + v_row.quantity;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'company_id', v_bucket.company_id, 'material_id', v_bucket.material_id,
    'storage_location_id', v_bucket.storage_location_id, 'stock_type_code', v_bucket.stock_type_code,
    'old_rate', v_snapshot.valuation_rate, 'new_rate', v_sim_rate,
    'quantity_on_hand', v_sim_qty, 'snapshot_quantity', v_snapshot.quantity
  );
END;
$function$;

REVOKE ALL ON FUNCTION erp_procurement.grn_net_landed_cost(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION erp_procurement.derive_grn_leg_rates(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION erp_inventory.simulate_valuation_at_rows(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_procurement.grn_net_landed_cost(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION erp_procurement.derive_grn_leg_rates(uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION erp_inventory.simulate_valuation_at_rows(jsonb) TO service_role;
