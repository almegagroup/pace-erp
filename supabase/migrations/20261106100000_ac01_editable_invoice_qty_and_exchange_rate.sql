-- AC01: Invoice Qty (goods_receipt.ge_qty, copied from the Gate Entry line at
-- GRN creation) was read-only, so a wrong Invoice Qty could never be fixed by
-- Accounts. AC01 WRITE holders may now correct it. Every change is audited,
-- discrepancy_qty (= ge_qty - received_qty, same formula as GRN create) is kept
-- consistent, and the GRN's own ge_qty is the only field touched -- received_qty
-- (physical stock), the Gate Entry line and PO availability are never changed.

CREATE TABLE IF NOT EXISTS erp_procurement.ac01_invoice_qty_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grn_id uuid NOT NULL REFERENCES erp_procurement.goods_receipt(id) ON DELETE RESTRICT,
  from_invoice_qty numeric,
  to_invoice_qty numeric NOT NULL CHECK (to_invoice_qty > 0),
  changed_by uuid NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ac01_invoice_qty_audit_grn_idx
  ON erp_procurement.ac01_invoice_qty_audit (grn_id, changed_at DESC);
REVOKE ALL ON TABLE erp_procurement.ac01_invoice_qty_audit FROM PUBLIC;
GRANT SELECT ON TABLE erp_procurement.ac01_invoice_qty_audit TO service_role;

-- Foreign-currency POs (USD): rates on the PO / GRN are in the PO currency.
-- AC01 now captures the BOE exchange rate (INR per 1 unit of PO currency) per
-- GRN and converts the effective rate to INR before every cost/payable/WAR
-- calculation, so Landed Cost and valuation are always INR.
ALTER TABLE erp_procurement.goods_receipt
  ADD COLUMN IF NOT EXISTS po_currency_code text NOT NULL DEFAULT 'INR',
  ADD COLUMN IF NOT EXISTS exchange_rate numeric CHECK (exchange_rate IS NULL OR exchange_rate > 0);
COMMENT ON COLUMN erp_procurement.goods_receipt.po_currency_code IS
  'Currency of the PO/STO line this GRN was received against (rates on this row are in this currency).';
COMMENT ON COLUMN erp_procurement.goods_receipt.exchange_rate IS
  'AC01: BOE exchange rate, INR per 1 unit of po_currency_code. Required to save AC01 when po_currency_code <> INR.';

UPDATE erp_procurement.goods_receipt g
SET po_currency_code = pol.currency_code
FROM erp_procurement.purchase_order_line pol
WHERE g.po_line_id = pol.id AND pol.currency_code IS NOT NULL AND g.po_currency_code IS DISTINCT FROM pol.currency_code;

UPDATE erp_procurement.goods_receipt g
SET po_currency_code = sl.currency_code
FROM erp_procurement.stock_transfer_order_line sl
WHERE g.sto_line_id = sl.id AND g.po_line_id IS NULL AND sl.currency_code IS NOT NULL AND g.po_currency_code IS DISTINCT FROM sl.currency_code;

-- The signature changes by one final optional argument.  Drop the old
-- 24-argument wrapper first so PostgreSQL cannot retain an ambiguous
-- overload when callers omit the new argument.
DROP FUNCTION IF EXISTS erp_procurement.save_ac01_grn_cost_with_verification(
  uuid, uuid, numeric, uuid, text, date, numeric, jsonb, jsonb, text, date,
  numeric, numeric, numeric, numeric, boolean, boolean, boolean, boolean,
  boolean, numeric, boolean, boolean, text
);

CREATE FUNCTION erp_procurement.save_ac01_grn_cost_with_verification(
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
  p_invoice_verified boolean DEFAULT false, p_clear_invoice_verification boolean DEFAULT false,
  p_gst_correction_reason text DEFAULT NULL, p_invoice_qty numeric DEFAULT NULL, p_exchange_rate numeric DEFAULT NULL
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
  v_previous_gst_pct numeric;
  v_gst_changed boolean := false;
  v_previous_invoice_qty numeric;
  v_received_qty numeric;
BEGIN
  -- Lock and validate before calling the established atomic save.  This makes
  -- the audit insertion and the GST update one transaction even if a client
  -- bypasses the AC01 UI.
  SELECT gst_pct, ge_qty, received_qty INTO v_previous_gst_pct, v_previous_invoice_qty, v_received_qty
  FROM erp_procurement.goods_receipt
  WHERE id = p_grn_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AC01_GRN_NOT_FOUND';
  END IF;

  IF p_gst_pct IS NOT NULL THEN
    IF p_gst_pct < 0 OR p_gst_pct > 100 THEN
      RAISE EXCEPTION 'AC01_GST_PCT_INVALID';
    END IF;
    v_gst_changed := v_previous_gst_pct IS DISTINCT FROM p_gst_pct;
    IF v_gst_changed AND NULLIF(btrim(p_gst_correction_reason), '') IS NULL THEN
      RAISE EXCEPTION 'AC01_GST_CORRECTION_REASON_REQUIRED';
    END IF;
  END IF;

  IF p_exchange_rate IS NOT NULL THEN
    IF p_exchange_rate <= 0 THEN
      RAISE EXCEPTION 'AC01_EXCHANGE_RATE_INVALID';
    END IF;
    UPDATE erp_procurement.goods_receipt SET exchange_rate = p_exchange_rate WHERE id = p_grn_id;
  END IF;

  IF p_invoice_qty IS NOT NULL THEN
    IF p_invoice_qty <= 0 THEN
      RAISE EXCEPTION 'AC01_INVOICE_QTY_INVALID';
    END IF;
    IF v_previous_invoice_qty IS DISTINCT FROM p_invoice_qty THEN
      UPDATE erp_procurement.goods_receipt
      SET ge_qty = p_invoice_qty,
          discrepancy_qty = p_invoice_qty - COALESCE(v_received_qty, 0)
      WHERE id = p_grn_id;
      INSERT INTO erp_procurement.ac01_invoice_qty_audit (grn_id, from_invoice_qty, to_invoice_qty, changed_by)
      VALUES (p_grn_id, v_previous_invoice_qty, p_invoice_qty, p_actor);
    END IF;
  END IF;

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

  IF v_gst_changed THEN
    INSERT INTO erp_procurement.ac01_gst_correction_audit (
      grn_id, from_gst_pct, to_gst_pct, reason, corrected_by
    ) VALUES (
      p_grn_id, v_previous_gst_pct, p_gst_pct, btrim(p_gst_correction_reason), p_actor
    );
  END IF;

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

  RETURN v_result || jsonb_build_object(
    'gst_corrected', v_gst_changed,
    'previous_gst_pct', CASE WHEN v_gst_changed THEN v_previous_gst_pct ELSE NULL END,
    'current_gst_pct', CASE WHEN p_gst_pct IS NOT NULL THEN p_gst_pct ELSE v_previous_gst_pct END
  );
END;
$function$;

REVOKE ALL ON FUNCTION erp_procurement.save_ac01_grn_cost_with_verification(
  uuid, uuid, numeric, uuid, text, date, numeric, jsonb, jsonb, text, date,
  numeric, numeric, numeric, numeric, boolean, boolean, boolean, boolean,
  boolean, numeric, boolean, boolean, text, numeric, numeric
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_procurement.save_ac01_grn_cost_with_verification(
  uuid, uuid, numeric, uuid, text, date, numeric, jsonb, jsonb, text, date,
  numeric, numeric, numeric, numeric, boolean, boolean, boolean, boolean,
  boolean, numeric, boolean, boolean, text, numeric, numeric
) TO service_role;

NOTIFY pgrst, 'reload schema';

-- Inner calculation: same function as 20260826100000, plus INR conversion.
CREATE OR REPLACE FUNCTION erp_procurement.save_ac01_grn_cost(
  p_grn_id uuid,
  p_actor uuid,
  p_confirmed_rate numeric DEFAULT NULL,
  p_last_mile_transporter_id uuid DEFAULT NULL,
  p_invoice_number text DEFAULT NULL,
  p_invoice_date date DEFAULT NULL,
  p_gst_pct numeric DEFAULT NULL,
  p_cost_lines jsonb DEFAULT '[]'::jsonb,
  p_deduction_lines jsonb DEFAULT '[]'::jsonb,
  p_reason text DEFAULT 'AC01 landed cost save',
  p_revised_payment_date date DEFAULT NULL,
  p_vendor_payable_override numeric DEFAULT NULL,
  p_transporter_payable_override numeric DEFAULT NULL,
  p_last_mile_payable_override numeric DEFAULT NULL,
  p_cha_payable_override numeric DEFAULT NULL,
  p_clear_revised_payment_date boolean DEFAULT false,
  p_clear_vendor_payable_override boolean DEFAULT false,
  p_clear_transporter_payable_override boolean DEFAULT false,
  p_clear_last_mile_payable_override boolean DEFAULT false,
  p_clear_cha_payable_override boolean DEFAULT false,
  p_considered_qty numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = erp_procurement, erp_inventory, public
AS $function$
DECLARE
  v_grn                RECORD;
  v_lc_id              uuid;
  v_lc_number          text;
  v_line               jsonb;
  v_line_number        integer := 0;
  v_effective_rate     numeric;
  v_fx_rate            numeric;
  v_base_uom_rate      numeric;
  v_considered_qty     numeric;
  v_considered_qty_base numeric;
  v_purchase_cost      numeric;
  v_purchase_cost_gross numeric;
  v_material_gst_pct   numeric;
  v_net_amount         numeric;
  v_gross_amount       numeric;
  v_line_gst_rate      numeric;
  v_party              text;
  v_total_charges      numeric := 0;
  v_total_deductions   numeric := 0;
  v_landed_cost_total  numeric;
  v_landed_cost_per_unit numeric;
  v_recalc_result      jsonb := NULL;
  v_vendor_charges_gross numeric := 0;
  v_transporter_charges_gross numeric := 0;
  v_last_mile_charges_gross numeric := 0;
  v_cha_charges_gross  numeric := 0;
  v_vendor_deductions  numeric := 0;
  v_transporter_deductions numeric := 0;
  v_last_mile_deductions numeric := 0;
  v_cha_deductions     numeric := 0;
  v_vendor_suggested   numeric;
  v_transporter_suggested numeric;
  v_last_mile_suggested numeric;
  v_cha_suggested      numeric;
  v_deduction_amount   numeric;
BEGIN
  SELECT id, company_id, vendor_id, material_id, storage_location_id, target_stock_type,
         received_qty, considered_qty, per_pack_qty, grn_rate, confirmed_rate, gst_pct, stock_ledger_id, status,
         po_currency_code, exchange_rate
  INTO v_grn
  FROM erp_procurement.goods_receipt
  WHERE id = p_grn_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'AC01_GRN_NOT_FOUND';
  END IF;

  UPDATE erp_procurement.goods_receipt
  SET confirmed_rate = COALESCE(p_confirmed_rate, confirmed_rate),
      confirmed_rate_by = CASE WHEN p_confirmed_rate IS NOT NULL THEN p_actor ELSE confirmed_rate_by END,
      confirmed_rate_at = CASE WHEN p_confirmed_rate IS NOT NULL THEN now() ELSE confirmed_rate_at END,
      rate_confirmed = CASE WHEN p_confirmed_rate IS NOT NULL THEN true ELSE rate_confirmed END,
      last_mile_transporter_id = COALESCE(p_last_mile_transporter_id, last_mile_transporter_id),
      invoice_number = COALESCE(p_invoice_number, invoice_number),
      invoice_date = COALESCE(p_invoice_date, invoice_date),
      gst_pct = COALESCE(p_gst_pct, gst_pct),
      considered_qty = COALESCE(p_considered_qty, considered_qty),
      revised_payment_date = CASE
        WHEN p_clear_revised_payment_date THEN NULL
        ELSE COALESCE(p_revised_payment_date, revised_payment_date)
      END,
      vendor_payable_override = CASE
        WHEN p_clear_vendor_payable_override THEN NULL
        ELSE COALESCE(p_vendor_payable_override, vendor_payable_override)
      END,
      transporter_payable_override = CASE
        WHEN p_clear_transporter_payable_override THEN NULL
        ELSE COALESCE(p_transporter_payable_override, transporter_payable_override)
      END,
      last_mile_payable_override = CASE
        WHEN p_clear_last_mile_payable_override THEN NULL
        ELSE COALESCE(p_last_mile_payable_override, last_mile_payable_override)
      END,
      cha_payable_override = CASE
        WHEN p_clear_cha_payable_override THEN NULL
        ELSE COALESCE(p_cha_payable_override, cha_payable_override)
      END
  WHERE id = p_grn_id;

  SELECT id INTO v_lc_id
  FROM erp_procurement.landed_cost
  WHERE grn_id = p_grn_id
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_lc_id IS NULL THEN
    SELECT erp_procurement.generate_doc_number('LC') INTO v_lc_number;
    INSERT INTO erp_procurement.landed_cost (lc_number, lc_date, company_id, vendor_id, grn_id, status, created_by)
    VALUES (v_lc_number, CURRENT_DATE, v_grn.company_id, v_grn.vendor_id, p_grn_id, 'DRAFT', p_actor)
    RETURNING id INTO v_lc_id;
  END IF;

  DELETE FROM erp_procurement.landed_cost_line WHERE lc_id = v_lc_id;

  v_effective_rate := COALESCE(p_confirmed_rate, v_grn.confirmed_rate, v_grn.grn_rate, 0);
  -- Foreign-currency PO: convert to INR with the BOE exchange rate before any
  -- cost / payable / valuation math (re-read after the UPDATE above, so it is
  -- the rate just saved). Everything below is INR.
  IF COALESCE(v_grn.po_currency_code, 'INR') = 'INR' THEN
    v_fx_rate := 1;
  ELSE
    SELECT exchange_rate INTO v_fx_rate FROM erp_procurement.goods_receipt WHERE id = p_grn_id;
    IF v_fx_rate IS NULL OR v_fx_rate <= 0 THEN
      RAISE EXCEPTION 'AC01_EXCHANGE_RATE_REQUIRED';
    END IF;
  END IF;
  v_effective_rate := v_effective_rate * v_fx_rate;
  -- Considered Qty basis (business owner, 2026-08-26) -- effective value is
  -- whatever this same save just persisted above, falling back to the
  -- already-stored considered_qty, then received_qty for any pre-backfill
  -- edge case (should never happen post-migration, kept defensive).
  v_considered_qty := COALESCE(p_considered_qty, v_grn.considered_qty, v_grn.received_qty, 0);
  v_purchase_cost := v_effective_rate * v_considered_qty;
  v_material_gst_pct := COALESCE(p_gst_pct, v_grn.gst_pct, 0);
  v_purchase_cost_gross := v_purchase_cost * (1 + v_material_gst_pct / 100);

  -- Base-UoM qty/rate -- computed once, up front, since the cost-line loop
  -- needs v_considered_qty_base for PER_UOM lines too (previously this was
  -- only computed after the loop, purely for landed_cost_per_unit).
  v_base_uom_rate := CASE
    WHEN v_grn.per_pack_qty IS NOT NULL AND v_grn.per_pack_qty > 0
      THEN round(v_effective_rate / v_grn.per_pack_qty, 6)
    ELSE v_effective_rate
  END;
  v_considered_qty_base := CASE
    WHEN v_grn.per_pack_qty IS NOT NULL AND v_grn.per_pack_qty > 0
      THEN v_considered_qty * v_grn.per_pack_qty
    ELSE v_considered_qty
  END;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_cost_lines)
  LOOP
    v_line_number := v_line_number + 1;
    v_net_amount := (v_line->>'amount')::numeric;
    v_gross_amount := (v_line->>'amount')::numeric;
    v_line_gst_rate := NULLIF(v_line->>'gst_rate', '')::numeric;

    -- PER_UOM: the entered amount is a RATE per Base-UoM unit, not the
    -- total -- multiply both the net and gross figures by the GRN's own
    -- Base-UoM Considered Qty. The stored landed_cost_line.amount column
    -- (below) stays the raw rate, unmultiplied.
    IF v_line->>'entry_mode' = 'PER_UOM' THEN
      v_net_amount := v_net_amount * v_considered_qty_base;
      v_gross_amount := v_gross_amount * v_considered_qty_base;
    END IF;

    IF v_line->>'cost_type' = 'ADDITIONAL_DUTY_IGST' THEN
      v_net_amount := 0;
    END IF;

    IF COALESCE((v_line->>'has_gst')::boolean, false) AND v_line_gst_rate IS NOT NULL AND v_line_gst_rate > 0 THEN
      IF v_line->>'gst_treatment' = 'INCLUSIVE' THEN
        v_net_amount := v_net_amount / (1 + v_line_gst_rate / 100);
      ELSIF v_line->>'gst_treatment' = 'EXCLUSIVE' THEN
        v_gross_amount := v_gross_amount * (1 + v_line_gst_rate / 100);
      END IF;
    END IF;

    v_party := COALESCE(NULLIF(v_line->>'party_type', ''), 'VENDOR');

    INSERT INTO erp_procurement.landed_cost_line (
      lc_id, line_number, cost_type, cha_id, bill_reference, bill_date, description, amount,
      entry_mode, percentage, has_gst, gst_treatment, gst_rate, party_type
    ) VALUES (
      v_lc_id, v_line_number, v_line->>'cost_type',
      NULLIF(v_line->>'cha_id', '')::uuid,
      COALESCE(NULLIF(v_line->>'bill_reference', ''), 'AC01-' || to_char(now(), 'YYYYMMDD')),
      COALESCE(NULLIF(v_line->>'bill_date', '')::date, CURRENT_DATE),
      NULLIF(v_line->>'description', ''),
      (v_line->>'amount')::numeric,
      NULLIF(v_line->>'entry_mode', ''),
      CASE WHEN v_purchase_cost > 0 AND (v_line->>'cost_type') IN
        ('IMPORT_DUTY', 'EXCISE_DUTY', 'CST', 'CUSTOMS_EDN_CESS', 'ADDITIONAL_DUTY_IGST', 'DUTY_SETOFF', 'ENTRY_TAX', 'CUSTOMS_DUTY')
        THEN round((v_line->>'amount')::numeric / v_purchase_cost * 100, 4)
        ELSE NULL
      END,
      COALESCE((v_line->>'has_gst')::boolean, false),
      NULLIF(v_line->>'gst_treatment', ''),
      v_line_gst_rate,
      v_party
    );

    v_total_charges := v_total_charges + v_net_amount;
    IF v_party = 'TRANSPORTER' THEN
      v_transporter_charges_gross := v_transporter_charges_gross + v_gross_amount;
    ELSIF v_party = 'LAST_MILE_TRANSPORTER' THEN
      v_last_mile_charges_gross := v_last_mile_charges_gross + v_gross_amount;
    ELSIF v_party = 'CHA' THEN
      v_cha_charges_gross := v_cha_charges_gross + v_gross_amount;
    ELSIF v_party = 'NONE' THEN
      NULL;
    ELSE
      v_vendor_charges_gross := v_vendor_charges_gross + v_gross_amount;
    END IF;
  END LOOP;

  DELETE FROM erp_procurement.landed_cost_deduction_line WHERE lc_id = v_lc_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_deduction_lines)
  LOOP
    v_party := COALESCE(NULLIF(v_line->>'party_type', ''), 'VENDOR');

    INSERT INTO erp_procurement.landed_cost_deduction_line (
      lc_id, deduction_type_id, amount, percentage, round_off, in_landed, created_by, party_type
    ) VALUES (
      v_lc_id,
      (v_line->>'deduction_type_id')::uuid,
      NULLIF(v_line->>'amount', '')::numeric,
      NULLIF(v_line->>'percentage', '')::numeric,
      NULLIF(v_line->>'round_off', '')::numeric,
      COALESCE((v_line->>'in_landed')::boolean, false),
      p_actor,
      v_party
    );

    IF COALESCE((v_line->>'in_landed')::boolean, false) AND (v_line->>'amount') IS NOT NULL THEN
      v_total_deductions := v_total_deductions + (v_line->>'amount')::numeric + COALESCE((v_line->>'round_off')::numeric, 0);
    END IF;

    IF (v_line->>'amount') IS NOT NULL THEN
      v_deduction_amount := (v_line->>'amount')::numeric + COALESCE((v_line->>'round_off')::numeric, 0);
      IF v_party = 'TRANSPORTER' THEN
        v_transporter_deductions := v_transporter_deductions + v_deduction_amount;
      ELSIF v_party = 'LAST_MILE_TRANSPORTER' THEN
        v_last_mile_deductions := v_last_mile_deductions + v_deduction_amount;
      ELSIF v_party = 'CHA' THEN
        v_cha_deductions := v_cha_deductions + v_deduction_amount;
      ELSIF v_party = 'NONE' THEN
        NULL;
      ELSE
        v_vendor_deductions := v_vendor_deductions + v_deduction_amount;
      END IF;
    END IF;
  END LOOP;

  v_landed_cost_total := v_total_charges + v_total_deductions;
  v_landed_cost_per_unit := v_base_uom_rate + (v_landed_cost_total / NULLIF(v_considered_qty_base, 0));

  UPDATE erp_procurement.landed_cost
  SET total_cost = v_landed_cost_total,
      last_updated_at = now()
  WHERE id = v_lc_id;

  IF v_grn.stock_ledger_id IS NOT NULL AND v_landed_cost_per_unit IS NOT NULL THEN
    v_recalc_result := erp_inventory.recalculate_valuation_at_row(
      v_grn.stock_ledger_id, v_landed_cost_per_unit, p_actor, p_reason
    );
    UPDATE erp_procurement.landed_cost
    SET status = 'POSTED', posted_by = p_actor, posted_at = now()
    WHERE id = v_lc_id;
  END IF;

  v_vendor_suggested := v_purchase_cost_gross + v_vendor_charges_gross - v_vendor_deductions;
  v_transporter_suggested := v_transporter_charges_gross - v_transporter_deductions;
  v_last_mile_suggested := v_last_mile_charges_gross - v_last_mile_deductions;
  v_cha_suggested := v_cha_charges_gross - v_cha_deductions;

  RETURN jsonb_build_object(
    'grn_id', p_grn_id,
    'lc_id', v_lc_id,
    'landed_cost_total', v_landed_cost_total,
    'landed_cost_per_unit', v_landed_cost_per_unit,
    'recalculated', v_recalc_result IS NOT NULL,
    'recalc_result', v_recalc_result,
    'vendor_suggested_payable', round(v_vendor_suggested, 4),
    'transporter_suggested_payable', round(v_transporter_suggested, 4),
    'last_mile_suggested_payable', round(v_last_mile_suggested, 4),
    'cha_suggested_payable', round(v_cha_suggested, 4)
  );
END;
$function$;

NOTIFY pgrst, 'reload schema';
