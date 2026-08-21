-- AC01 GRN Landed Cost Hub redesign — schema foundation.
-- Locked design: docs/Operation Management/PACE_ERP_Operation_Management_SAP_Style_Discovery_and_Feasibility.md
-- (Section 111 WAR-Landed-Cost gap, this session's AC01 redesign notes).
-- Claude direct-implemented (business owner directive 2026-08-21), not via Codex.

-- 1. landed_cost_line — extend cost_type enum + add entry_mode/percentage/gst fields.
--    entry_mode/gst_treatment/gst_rate are nullable: only meaningful for ad-hoc/per-UoM
--    charge lines, not for duty lines (which are amount-in/percentage-derived) or the
--    legacy pre-2026-08-21 rows.
ALTER TABLE erp_procurement.landed_cost_line
  ADD COLUMN entry_mode text CHECK (entry_mode IN ('PER_UOM', 'AD_HOC')),
  ADD COLUMN percentage numeric,
  ADD COLUMN gst_treatment text CHECK (gst_treatment IN ('INCLUSIVE', 'EXCLUSIVE')),
  ADD COLUMN gst_rate numeric;

ALTER TABLE erp_procurement.landed_cost_line DROP CONSTRAINT landed_cost_line_cost_type_check;
ALTER TABLE erp_procurement.landed_cost_line ADD CONSTRAINT landed_cost_line_cost_type_check
  CHECK (cost_type = ANY (ARRAY[
    -- Pre-existing (unchanged, still valid for historical rows and generic entry)
    'FREIGHT', 'INSURANCE', 'CUSTOMS_DUTY', 'CHA_CHARGES', 'LOADING', 'UNLOADING', 'PORT_CHARGES', 'OTHER',
    -- New 2026-08-21 — Import duty stack (amount entered, percentage derived from purchase cost)
    'IMPORT_DUTY', 'EXCISE_DUTY', 'CST', 'CUSTOMS_EDN_CESS', 'ADDITIONAL_DUTY_IGST', 'DUTY_SETOFF', 'ENTRY_TAX',
    -- New 2026-08-21 — Finance charges
    'LC_CHARGES', 'BANK_CHARGES',
    -- New 2026-08-21 — Transport, distinct from FREIGHT (the PO's own freight term) and from each other
    'LAST_MILE_TRANSPORT', 'TRANSPORTER_CHARGE_OTHER_THAN_BASIC'
  ]));

COMMENT ON COLUMN erp_procurement.landed_cost_line.entry_mode IS
  'PER_UOM or AD_HOC — only meaningful for charge-type lines (Freight/Unloading/Clearing/Last Mile Transport etc.), null for duty-type lines and legacy rows.';
COMMENT ON COLUMN erp_procurement.landed_cost_line.percentage IS
  'For duty-type lines: derived = amount / purchase_cost, display-only, computed by the handler on save, not user-entered.';
COMMENT ON COLUMN erp_procurement.landed_cost_line.gst_treatment IS
  'INCLUSIVE or EXCLUSIVE — GST is never part of Landed Cost/WAR. If INCLUSIVE, the handler backs GST out via amount/(1+gst_rate/100) before the line feeds Landed Cost.';

-- 2. goods_receipt — Confirmed Rate (AC01's own resolution of a rate_confirmed=false GRN,
--    kept separate from the original grn_rate/invoice_rate so the audit trail preserves both
--    "what was posted at GRN time" and "what Accounts later confirmed") + Last Mile Transporter.
ALTER TABLE erp_procurement.goods_receipt
  ADD COLUMN confirmed_rate numeric,
  ADD COLUMN confirmed_rate_by uuid,
  ADD COLUMN confirmed_rate_at timestamptz,
  ADD COLUMN last_mile_transporter_id uuid REFERENCES erp_master.transporter_master(id);

COMMENT ON COLUMN erp_procurement.goods_receipt.confirmed_rate IS
  'Set by AC01 when Accounts resolves a rate_confirmed=false GRN. Triggers erp_inventory.recalculate_valuation_at_row(new_rate=confirmed_rate) on save — never edits the original grn_rate/stock_ledger posting.';

-- 3. goods_receipt_line — HSN code captured at receive time (audit trail on the line itself;
--    the write-through target of record is erp_master.material_master.hsn_code, which this
--    column always mirrors at the moment of entry).
ALTER TABLE erp_procurement.goods_receipt_line
  ADD COLUMN hsn_code text;

-- 4. Deduction Type Master — reusable, company-scoped (matches the project's dominant master
--    pattern, e.g. erp_production.costing_group). Created inline from within AC01's UI, but is
--    a real standalone master, not a per-row freeform value.
CREATE TABLE erp_procurement.deduction_type_master (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES erp_master.companies(id),
  name text NOT NULL,
  category text,
  default_percentage numeric,
  default_in_landed boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);

COMMENT ON TABLE erp_procurement.deduction_type_master IS
  'Reusable deduction types (e.g. TDS 194Q) for AC01. default_in_landed is only a starting suggestion — landed_cost_deduction_line.in_landed is independently editable per GRN row, per business-owner lock 2026-08-20.';

-- 5. Per-GRN deduction entries, keyed off the landed_cost header (mirrors landed_cost_line's
--    own FK shape). Amount is the entered deduction value; percentage/round_off are captured
--    alongside it (business-owner lock 2026-08-21); in_landed toggles whether this specific
--    instance affects Landed Cost, independent of the type's own default_in_landed.
CREATE TABLE erp_procurement.landed_cost_deduction_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lc_id uuid NOT NULL REFERENCES erp_procurement.landed_cost(id) ON DELETE RESTRICT,
  deduction_type_id uuid NOT NULL REFERENCES erp_procurement.deduction_type_master(id),
  amount numeric,
  percentage numeric,
  round_off numeric,
  in_landed boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX landed_cost_deduction_line_lc_id_idx ON erp_procurement.landed_cost_deduction_line (lc_id);

-- 6. consignment_note (CSN Tracker) — Last Mile Transporter, mirroring the existing dual
--    transporter_id/domestic_transporter_id shape already on this table.
ALTER TABLE erp_procurement.consignment_note
  ADD COLUMN last_mile_transporter_id uuid REFERENCES erp_master.transporter_master(id),
  ADD COLUMN last_mile_transporter_freetext text;

-- 7. Repeatable valuation correction — remove the one-time-use lock so a GRN's rate can be
--    corrected more than once as bills for it arrive incrementally (business-owner-confirmed
--    real workflow, 2026-08-21; feasibility Section 111's own note that this needed to become
--    additive). No other logic changes: replay math, stock_snapshot-only write, and the
--    valuation_correction_log audit insert are all unchanged from the original 2026-07-24
--    definition — this migration removes exactly the IF EXISTS ... RAISE EXCEPTION block and
--    nothing else.
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

  -- 2026-08-21: one-time-use guard removed here (was:
  -- `IF EXISTS (SELECT 1 FROM valuation_correction_log WHERE target_ledger_id = p_target_ledger_id) THEN RAISE EXCEPTION 'VALUATION_RECALC_ALREADY_DONE'; END IF;`)
  -- so a GRN's landed cost/rate can be corrected repeatedly as bills for it arrive over time.

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
$function$;
