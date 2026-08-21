-- AC01 GRN Landed Cost Hub — real live bug found 2026-08-22 (business owner,
-- while reviewing GRN 2000000030's actual saved data): `entry_mode` on a
-- cost line can be "AD_HOC" (amount = already the total) or "PER_UOM"
-- (amount = a rate per unit of the GRN's received qty), and AC01Page.jsx
-- lets the user pick either -- but save_ac01_grn_cost() never once read
-- entry_mode in its math. A PER_UOM line's `amount` was always treated as
-- the final total, identical to AD_HOC. The one real prod GRN that ever
-- used PER_UOM (2000000030, UNLOADING, amount=10, received_qty=200) landed
-- with `landed_cost_total=10` instead of the intended 10 x 200 = 2000 --
-- Landed Cost/WAR silently understated by the full multiplier, with zero
-- error or warning anywhere.
--
-- Fix: PER_UOM lines now multiply both the net (Landed Cost) and gross
-- (Payable) figures by the GRN's Base-UoM received quantity (same
-- v_received_qty_base already used for landed_cost_per_unit -- "Landed Cost
-- is always computed on Base UoM", locked 2026-08-21). The stored
-- `landed_cost_line.amount` column is left UNCHANGED (still the raw rate
-- the user typed, e.g. 10) -- only the in-memory sums used for Landed
-- Cost/Payable get the qty multiplication. This means re-opening a saved
-- PER_UOM line always shows back the rate the user actually typed, not an
-- already-multiplied total (avoids a double-multiply trap on re-save) --
-- the frontend is responsible for showing the computed total as a
-- read-only hint next to the rate field, not for changing what's stored.
--
-- v_received_qty_base (and v_base_uom_rate) are now computed once, before
-- the cost-line loop, since the loop needs them -- the later duplicate
-- computation right before landed_cost_per_unit is removed, both spots now
-- reuse the same one.

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
  p_clear_cha_payable_override boolean DEFAULT false
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
  v_base_uom_rate      numeric;
  v_received_qty_base  numeric;
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
         received_qty, per_pack_qty, grn_rate, confirmed_rate, gst_pct, stock_ledger_id, status
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
  v_purchase_cost := v_effective_rate * COALESCE(v_grn.received_qty, 0);
  v_material_gst_pct := COALESCE(p_gst_pct, v_grn.gst_pct, 0);
  v_purchase_cost_gross := v_purchase_cost * (1 + v_material_gst_pct / 100);

  -- Base-UoM qty/rate -- computed once, up front, since the cost-line loop
  -- now needs v_received_qty_base for PER_UOM lines too (previously this
  -- was only computed after the loop, purely for landed_cost_per_unit).
  v_base_uom_rate := CASE
    WHEN v_grn.per_pack_qty IS NOT NULL AND v_grn.per_pack_qty > 0
      THEN round(v_effective_rate / v_grn.per_pack_qty, 6)
    ELSE v_effective_rate
  END;
  v_received_qty_base := CASE
    WHEN v_grn.per_pack_qty IS NOT NULL AND v_grn.per_pack_qty > 0
      THEN v_grn.received_qty * v_grn.per_pack_qty
    ELSE v_grn.received_qty
  END;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_cost_lines)
  LOOP
    v_line_number := v_line_number + 1;
    v_net_amount := (v_line->>'amount')::numeric;
    v_gross_amount := (v_line->>'amount')::numeric;
    v_line_gst_rate := NULLIF(v_line->>'gst_rate', '')::numeric;

    -- PER_UOM: the entered amount is a RATE per Base-UoM unit, not the
    -- total -- multiply both the net and gross figures by the GRN's own
    -- Base-UoM received qty. The stored landed_cost_line.amount column
    -- (below) stays the raw rate, unmultiplied.
    IF v_line->>'entry_mode' = 'PER_UOM' THEN
      v_net_amount := v_net_amount * v_received_qty_base;
      v_gross_amount := v_gross_amount * v_received_qty_base;
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
  v_landed_cost_per_unit := v_base_uom_rate + (v_landed_cost_total / NULLIF(v_received_qty_base, 0));

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
