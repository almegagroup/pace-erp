-- AC01 GST correction: Stores may enter the wrong GST % at GRN.  Accounts
-- may correct it in AC01, with every change retained as an explicit audit
-- event.  GST remains outside landed-cost/WAR; the AC01 payable and tax
-- calculations use the corrected goods_receipt.gst_pct.

CREATE TABLE erp_procurement.ac01_gst_correction_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grn_id uuid NOT NULL REFERENCES erp_procurement.goods_receipt(id) ON DELETE RESTRICT,
  from_gst_pct numeric,
  to_gst_pct numeric NOT NULL CHECK (to_gst_pct >= 0 AND to_gst_pct <= 100),
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  corrected_by uuid NOT NULL,
  corrected_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ac01_gst_correction_audit_grn_corrected_at_idx
  ON erp_procurement.ac01_gst_correction_audit (grn_id, corrected_at DESC);

COMMENT ON TABLE erp_procurement.ac01_gst_correction_audit IS
  'Append-only Accounts audit trail for GST % corrections made in AC01. Each row records the GRN value before and after the correction, the required business reason, actor and timestamp.';

REVOKE ALL ON TABLE erp_procurement.ac01_gst_correction_audit FROM PUBLIC;
GRANT SELECT ON TABLE erp_procurement.ac01_gst_correction_audit TO service_role;

-- The signature changes by one final optional argument.  Drop the old
-- 23-argument wrapper first so PostgreSQL cannot retain an ambiguous
-- overload when callers omit the new argument.
DROP FUNCTION IF EXISTS erp_procurement.save_ac01_grn_cost_with_verification(
  uuid, uuid, numeric, uuid, text, date, numeric, jsonb, jsonb, text, date,
  numeric, numeric, numeric, numeric, boolean, boolean, boolean, boolean,
  boolean, numeric, boolean, boolean
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
  p_gst_correction_reason text DEFAULT NULL
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
BEGIN
  -- Lock and validate before calling the established atomic save.  This makes
  -- the audit insertion and the GST update one transaction even if a client
  -- bypasses the AC01 UI.
  SELECT gst_pct INTO v_previous_gst_pct
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
  boolean, numeric, boolean, boolean, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_procurement.save_ac01_grn_cost_with_verification(
  uuid, uuid, numeric, uuid, text, date, numeric, jsonb, jsonb, text, date,
  numeric, numeric, numeric, numeric, boolean, boolean, boolean, boolean,
  boolean, numeric, boolean, boolean, text
) TO service_role;

NOTIFY pgrst, 'reload schema';
