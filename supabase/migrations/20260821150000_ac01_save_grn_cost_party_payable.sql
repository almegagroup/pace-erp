-- AC01 GRN Landed Cost Hub — save_ac01_grn_cost() extended for the
-- per-party (Vendor / Transporter / Last Mile Transporter) payable
-- breakdown + revised_payment_date, both added in the companion schema
-- migration (20260821140000). CREATE OR REPLACE, not a new function --
-- every existing line stays, only the additions below are new.
--
-- Per-party suggested payable, computed strictly from THIS GRN's own
-- landed_cost_line/landed_cost_deduction_line rows (never aggregated across
-- other GRNs for the same vendor/transporter -- that cross-document running
-- balance is AC02's Vendor Ledger, a different layer entirely):
--   Vendor payable       = (confirmed/GRN rate x received qty)
--                           + sum(net cost lines, party=VENDOR)
--                           - sum(deductions, party=VENDOR)
--   Transporter payable  = sum(net cost lines, party=TRANSPORTER)
--                           - sum(deductions, party=TRANSPORTER)
--   Last Mile payable    = sum(net cost lines, party=LAST_MILE_TRANSPORTER)
--                           - sum(deductions, party=LAST_MILE_TRANSPORTER)
-- "net cost line" = GST backed out the same way the existing landed-cost
-- total already does (has_gst + Inclusive -> amount/(1+rate/100)).
-- Deductions reduce a party's payable regardless of `in_landed` -- in_landed
-- only controls whether a deduction feeds the landed-cost/WAR total, not
-- whether it reduces what's actually owed to that party.

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
  p_clear_revised_payment_date boolean DEFAULT false,
  p_clear_vendor_payable_override boolean DEFAULT false,
  p_clear_transporter_payable_override boolean DEFAULT false,
  p_clear_last_mile_payable_override boolean DEFAULT false
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
  v_net_amount         numeric;
  v_party              text;
  v_total_charges      numeric := 0;
  v_total_deductions   numeric := 0;
  v_landed_cost_total  numeric;
  v_landed_cost_per_unit numeric;
  v_recalc_result      jsonb := NULL;
  v_vendor_charges     numeric := 0;
  v_transporter_charges numeric := 0;
  v_last_mile_charges  numeric := 0;
  v_vendor_deductions  numeric := 0;
  v_transporter_deductions numeric := 0;
  v_last_mile_deductions numeric := 0;
  v_vendor_suggested   numeric;
  v_transporter_suggested numeric;
  v_last_mile_suggested numeric;
  v_deduction_amount   numeric;
BEGIN
  SELECT id, company_id, vendor_id, material_id, storage_location_id, target_stock_type,
         received_qty, per_pack_qty, grn_rate, confirmed_rate, stock_ledger_id, status
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

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_cost_lines)
  LOOP
    v_line_number := v_line_number + 1;
    v_net_amount := (v_line->>'amount')::numeric;
    IF COALESCE((v_line->>'has_gst')::boolean, false) AND v_line->>'gst_treatment' = 'INCLUSIVE'
       AND (v_line->>'gst_rate') IS NOT NULL AND (v_line->>'gst_rate')::numeric > 0 THEN
      v_net_amount := v_net_amount / (1 + (v_line->>'gst_rate')::numeric / 100);
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
      NULLIF(v_line->>'gst_rate', '')::numeric,
      v_party
    );

    v_total_charges := v_total_charges + v_net_amount;
    IF v_party = 'TRANSPORTER' THEN
      v_transporter_charges := v_transporter_charges + v_net_amount;
    ELSIF v_party = 'LAST_MILE_TRANSPORTER' THEN
      v_last_mile_charges := v_last_mile_charges + v_net_amount;
    ELSE
      v_vendor_charges := v_vendor_charges + v_net_amount;
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
    -- feeds the landed-cost/WAR total.
    IF (v_line->>'amount') IS NOT NULL THEN
      v_deduction_amount := (v_line->>'amount')::numeric + COALESCE((v_line->>'round_off')::numeric, 0);
      IF v_party = 'TRANSPORTER' THEN
        v_transporter_deductions := v_transporter_deductions + v_deduction_amount;
      ELSIF v_party = 'LAST_MILE_TRANSPORTER' THEN
        v_last_mile_deductions := v_last_mile_deductions + v_deduction_amount;
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

  v_vendor_suggested := v_purchase_cost + v_vendor_charges - v_vendor_deductions;
  v_transporter_suggested := v_transporter_charges - v_transporter_deductions;
  v_last_mile_suggested := v_last_mile_charges - v_last_mile_deductions;

  RETURN jsonb_build_object(
    'grn_id', p_grn_id,
    'lc_id', v_lc_id,
    'landed_cost_total', v_landed_cost_total,
    'landed_cost_per_unit', v_landed_cost_per_unit,
    'recalculated', v_recalc_result IS NOT NULL,
    'recalc_result', v_recalc_result,
    'vendor_suggested_payable', round(v_vendor_suggested, 4),
    'transporter_suggested_payable', round(v_transporter_suggested, 4),
    'last_mile_suggested_payable', round(v_last_mile_suggested, 4)
  );
END;
$function$;
