-- AC01 invoice-verification acknowledgement: each GRN can be explicitly
-- verified by an Accounts user. The acknowledgement is separate from rate
-- confirmation and landed-cost posting.

ALTER TABLE erp_procurement.goods_receipt
  ADD COLUMN IF NOT EXISTS invoice_verified_by uuid,
  ADD COLUMN IF NOT EXISTS invoice_verified_at timestamptz;

COMMENT ON COLUMN erp_procurement.goods_receipt.invoice_verified_by IS
  'AC01 invoice verification acknowledgement: authenticated user who last ticked I Verify and saved this GRN.';
COMMENT ON COLUMN erp_procurement.goods_receipt.invoice_verified_at IS
  'AC01 invoice verification acknowledgement timestamp. Cleared whenever AC01 data is saved without a fresh I Verify acknowledgement.';

-- Keep the established save_ac01_grn_cost RPC untouched and wrap it so the
-- landed-cost save and the verification audit update are one database action.
CREATE OR REPLACE FUNCTION erp_procurement.save_ac01_grn_cost_with_verification(
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
  p_considered_qty numeric DEFAULT NULL,
  p_invoice_verified boolean DEFAULT false,
  p_clear_invoice_verification boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = erp_procurement, erp_inventory, public
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  v_result := erp_procurement.save_ac01_grn_cost(
    p_grn_id => p_grn_id,
    p_actor => p_actor,
    p_confirmed_rate => p_confirmed_rate,
    p_last_mile_transporter_id => p_last_mile_transporter_id,
    p_invoice_number => p_invoice_number,
    p_invoice_date => p_invoice_date,
    p_gst_pct => p_gst_pct,
    p_cost_lines => p_cost_lines,
    p_deduction_lines => p_deduction_lines,
    p_reason => p_reason,
    p_revised_payment_date => p_revised_payment_date,
    p_vendor_payable_override => p_vendor_payable_override,
    p_transporter_payable_override => p_transporter_payable_override,
    p_last_mile_payable_override => p_last_mile_payable_override,
    p_cha_payable_override => p_cha_payable_override,
    p_clear_revised_payment_date => p_clear_revised_payment_date,
    p_clear_vendor_payable_override => p_clear_vendor_payable_override,
    p_clear_transporter_payable_override => p_clear_transporter_payable_override,
    p_clear_last_mile_payable_override => p_clear_last_mile_payable_override,
    p_clear_cha_payable_override => p_clear_cha_payable_override,
    p_considered_qty => p_considered_qty
  );

  UPDATE erp_procurement.goods_receipt
  SET invoice_verified_by = CASE
        WHEN p_invoice_verified THEN p_actor
        WHEN p_clear_invoice_verification THEN NULL
        ELSE invoice_verified_by
      END,
      invoice_verified_at = CASE
        WHEN p_invoice_verified THEN now()
        WHEN p_clear_invoice_verification THEN NULL
        ELSE invoice_verified_at
      END
  WHERE id = p_grn_id;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION erp_procurement.save_ac01_grn_cost_with_verification(
  uuid, uuid, numeric, uuid, text, date, numeric, jsonb, jsonb, text, date,
  numeric, numeric, numeric, numeric, boolean, boolean, boolean, boolean,
  boolean, numeric, boolean, boolean
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_procurement.save_ac01_grn_cost_with_verification(
  uuid, uuid, numeric, uuid, text, date, numeric, jsonb, jsonb, text, date,
  numeric, numeric, numeric, numeric, boolean, boolean, boolean, boolean,
  boolean, numeric, boolean, boolean
) TO service_role;
