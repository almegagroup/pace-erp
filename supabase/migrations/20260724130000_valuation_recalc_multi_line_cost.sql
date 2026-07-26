-- ============================================================================
-- Opening Rate "Recalculate" — multi-line-aware cost recompute (feasibility
-- §109). Real gap found while building the cascade orchestrator: a single
-- Process PO/Packing PO commonly has MULTIPLE RM/PM/SFG lines, and a business
-- owner correcting several RM/PM opening rates "in one sitting" (the exact
-- trigger this feature exists for) will often correct more than one line
-- that feeds the SAME downstream PO.
--
-- The single-pair versions of recompute_sfg_cost_for_line/
-- recompute_fg_cost_for_line (migration 20260724120000) would silently drop
-- this: if RM-A and RM-B both feed the same Process PO and are corrected in
-- the same batch, whichever cascade reaches that PO SECOND finds it already
-- corrected (one-time-use) and never re-applies with BOTH lines' corrected
-- rates — the PO's SFG ends up costed on only ONE of the two corrections,
-- silently wrong. Replacing the single-pair signature with a jsonb array of
-- {stock_ledger_id, corrected_rate} lets the TS orchestrator group every
-- correction touching the same PO before computing its downstream cost once.
-- ============================================================================

DROP FUNCTION IF EXISTS erp_production.recompute_sfg_cost_for_line(uuid, uuid, numeric);
DROP FUNCTION IF EXISTS erp_production.recompute_fg_cost_for_line(uuid, uuid, numeric);

CREATE OR REPLACE FUNCTION erp_production.recompute_sfg_cost(
  p_process_order_id uuid,
  p_corrections      jsonb  -- [{"stock_ledger_id": "...", "corrected_rate": 12.34}, ...]
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
  v_override         numeric;
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
    SELECT (c->>'corrected_rate')::numeric INTO v_override
    FROM jsonb_array_elements(p_corrections) AS c
    WHERE (c->>'stock_ledger_id')::uuid = v_row.stock_ledger_id
    LIMIT 1;

    v_total_rm_value := v_total_rm_value + v_row.quantity * COALESCE(v_override, v_row.valuation_rate);
  END LOOP;

  v_conversion_rate := COALESCE(
    erp_production.resolve_conversion_rate(v_po.company_id, v_po.segment_code, v_po.material_id, v_po.verified_at::date),
    0
  );

  RETURN (v_total_rm_value / v_po.actual_qty) + v_conversion_rate;
END;
$fn$;

COMMENT ON FUNCTION erp_production.recompute_sfg_cost(uuid, jsonb) IS
  'Cascade step for §109 Recalculate — recomputes a Process PO''s SFG cost (mirrors §104-2''s sfgCostPerKg formula) with every corrected RM/PM/INT line supplied in p_corrections substituted in at once (not just one at a time — multiple lines of the same PO commonly get corrected together).';

REVOKE ALL ON FUNCTION erp_production.recompute_sfg_cost(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_production.recompute_sfg_cost(uuid, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION erp_production.recompute_fg_cost(
  p_packing_order_id uuid,
  p_corrections      jsonb  -- [{"stock_ledger_id": "...", "corrected_rate": 12.34}, ...]
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = erp_production, erp_inventory, public
AS $fn$
DECLARE
  v_fg_qty      numeric;
  v_total_input numeric := 0;
  v_row         RECORD;
  v_override    numeric;
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
    SELECT (c->>'corrected_rate')::numeric INTO v_override
    FROM jsonb_array_elements(p_corrections) AS c
    WHERE (c->>'stock_ledger_id')::uuid = v_row.stock_ledger_id
    LIMIT 1;

    v_total_input := v_total_input + v_row.quantity * COALESCE(v_override, v_row.valuation_rate);
  END LOOP;

  RETURN v_total_input / v_fg_qty;
END;
$fn$;

COMMENT ON FUNCTION erp_production.recompute_fg_cost(uuid, jsonb) IS
  'Cascade step for §109 Recalculate — recomputes a Packing PO''s FG cost (mirrors §104-3''s fgCostPerKg formula) with every corrected SFG/PM line supplied in p_corrections substituted in at once.';

REVOKE ALL ON FUNCTION erp_production.recompute_fg_cost(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_production.recompute_fg_cost(uuid, jsonb) TO service_role;
