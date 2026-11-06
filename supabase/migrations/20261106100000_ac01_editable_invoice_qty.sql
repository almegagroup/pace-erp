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
  p_gst_correction_reason text DEFAULT NULL, p_invoice_qty numeric DEFAULT NULL
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
  boolean, numeric, boolean, boolean, text, numeric
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_procurement.save_ac01_grn_cost_with_verification(
  uuid, uuid, numeric, uuid, text, date, numeric, jsonb, jsonb, text, date,
  numeric, numeric, numeric, numeric, boolean, boolean, boolean, boolean,
  boolean, numeric, boolean, boolean, text, numeric
) TO service_role;

NOTIFY pgrst, 'reload schema';
