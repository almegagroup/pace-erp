-- AC01 GRN Landed Cost Hub — save_ac01_grn_cost() extended for:
--
-- 1. Gross (GST-inclusive) Suggested Payable, real bug found live 2026-08-22
--    (business owner caught it): Suggested Payable (migration 20260821150000)
--    was computed net-of-GST -- the exact same figure used for the Landed
--    Cost/WAR total. That's correct for Landed Cost (GST is creditable ITC,
--    never a real inventory cost), but WRONG for Payable -- the actual
--    amount PACE must pay each party is GST-INCLUSIVE (GST is still owed to
--    the party on the invoice, only later claimed back from the government
--    via ITC, a separate ledger entry entirely). The vendor's own base
--    material cost (rate x qty) had no GST added at all -- goods_receipt.
--    gst_pct existed and was already shown to the user (buildListRow's
--    "GST %" column) but was never applied to the payable figure.
--    Indian TDS-vs-GST rule (CBDT Circular 23/2017): the *rate basis* for
--    calculating a TDS amount excludes GST when GST is shown separately --
--    but that only governs how the deduction AMOUNT itself gets computed (an
--    Accounts-side judgment call already captured by whatever the user types
--    into the deduction line). The actual CASH PAID to a party is always
--    Gross Invoice (incl. GST) minus the TDS amount -- so deductions stay
--    untouched and subtract from the gross total, not a re-netted one.
--
-- 2. CHA as a 4th trackable party (migration 20260822110000 widened the
--    party_type CHECK) -- CHA is paid separately from the material vendor.
--
-- 3. 'NONE' party for costs PACE pays directly to nobody in this GRN's own
--    four tracked parties (Duty is the concrete example -- paid straight to
--    the government, not through the vendor/transporter/CHA/last-mile). A
--    NONE-party line still adds to Landed Cost (the cost genuinely
--    happened) but must NOT flow into any of the four Suggested Payable
--    figures, since nothing is owed to any of them for it.
--
-- Landed Cost/WAR math (v_total_charges/v_landed_cost_total/
-- v_landed_cost_per_unit) is unchanged by any of this -- still net-of-GST,
-- and NONE-party lines still count toward it exactly like any other line.
--
-- Found live 2026-08-22 while verifying this migration: CREATE OR REPLACE
-- does NOT replace a function whose parameter list differs in count/order --
-- Postgres treats it as a separate overload. Both 20260821100000's original
-- 10-param signature and 20260821150000's 18-param signature were still
-- sitting alongside this file's 19-param one, and calling with a partial
-- named-argument set (any call that doesn't supply every optional param)
-- was ambiguous -- "is not unique" -- since Postgres couldn't tell which
-- overload's defaults to use. Dropping the two stale overloads explicitly
-- so exactly one signature exists going forward.
DROP FUNCTION IF EXISTS erp_procurement.save_ac01_grn_cost(
  uuid, uuid, numeric, uuid, text, date, numeric, jsonb, jsonb, text
);
DROP FUNCTION IF EXISTS erp_procurement.save_ac01_grn_cost(
  uuid, uuid, numeric, uuid, text, date, numeric, jsonb, jsonb, text,
  date, numeric, numeric, numeric, boolean, boolean, boolean, boolean
);

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

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_cost_lines)
  LOOP
    v_line_number := v_line_number + 1;
    v_net_amount := (v_line->>'amount')::numeric;
    v_gross_amount := (v_line->>'amount')::numeric;
    v_line_gst_rate := NULLIF(v_line->>'gst_rate', '')::numeric;

    IF COALESCE((v_line->>'has_gst')::boolean, false) AND v_line_gst_rate IS NOT NULL AND v_line_gst_rate > 0 THEN
      IF v_line->>'gst_treatment' = 'INCLUSIVE' THEN
        -- Amount already carries GST -- back it out for the net (Landed
        -- Cost) figure; the gross (Payable) figure needs no change.
        v_net_amount := v_net_amount / (1 + v_line_gst_rate / 100);
      ELSIF v_line->>'gst_treatment' = 'EXCLUSIVE' THEN
        -- Amount is the pure base -- net (Landed Cost) figure needs no
        -- change; the gross (Payable) figure needs GST added on top.
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
      NULL; -- adds to Landed Cost (above) only; owed to nobody in this GRN's four parties
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

    -- Payable-reduction is independent of in_landed -- a deduction reduces
    -- what's actually owed to that party regardless of whether it also
    -- feeds the landed-cost/WAR total. Deduction amounts themselves are not
    -- grossed/netted here -- whatever the user entered (already the correct
    -- TDS/etc rupee figure per the applicable basis) is subtracted straight
    -- from the gross (GST-inclusive) payable, matching how the actual
    -- payment is made in practice.
    IF (v_line->>'amount') IS NOT NULL THEN
      v_deduction_amount := (v_line->>'amount')::numeric + COALESCE((v_line->>'round_off')::numeric, 0);
      IF v_party = 'TRANSPORTER' THEN
        v_transporter_deductions := v_transporter_deductions + v_deduction_amount;
      ELSIF v_party = 'LAST_MILE_TRANSPORTER' THEN
        v_last_mile_deductions := v_last_mile_deductions + v_deduction_amount;
      ELSIF v_party = 'CHA' THEN
        v_cha_deductions := v_cha_deductions + v_deduction_amount;
      ELSIF v_party = 'NONE' THEN
        NULL; -- still feeds v_total_deductions above if in_landed; owed to nobody
      ELSE
        v_vendor_deductions := v_vendor_deductions + v_deduction_amount;
      END IF;
    END IF;
  END LOOP;

  v_landed_cost_total := v_total_charges + v_total_deductions;
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
