-- §136 (2026-09-03, business owner "professional standard" follow-up) --
-- post-PGI "Amend Dispatch Details" only ever covered Transporter/Vehicle/LR
-- Number/LR Date -- Driver Number, Driver Contact Number, Remarks, and Gross
-- Weight are the same class of low-risk logistics field (never touch stock
-- or invoice value) but had no correction path at all once a DO reached
-- DISPATCHED. Extends the same audit-trailed amendment mechanism to cover
-- all four, instead of leaving them permanently uncorrectable post-PGI.

ALTER TABLE erp_procurement.delivery_challan_dispatch_amendment
  ADD COLUMN IF NOT EXISTS old_driver_number text NULL,
  ADD COLUMN IF NOT EXISTS new_driver_number text NULL,
  ADD COLUMN IF NOT EXISTS old_driver_contact_number text NULL,
  ADD COLUMN IF NOT EXISTS new_driver_contact_number text NULL,
  ADD COLUMN IF NOT EXISTS old_remarks text NULL,
  ADD COLUMN IF NOT EXISTS new_remarks text NULL,
  ADD COLUMN IF NOT EXISTS old_gross_weight numeric NULL,
  ADD COLUMN IF NOT EXISTS new_gross_weight numeric NULL;

DO $outer$
BEGIN
  -- Old 7-param signature is superseded -- drop before recreating with the
  -- wider parameter list (CREATE OR REPLACE cannot add parameters).
  DROP FUNCTION IF EXISTS erp_procurement.amend_delivery_challan_dispatch_details(uuid, uuid, text, text, date, text, uuid);

  EXECUTE $sql$
    CREATE OR REPLACE FUNCTION erp_procurement.amend_delivery_challan_dispatch_details(
      p_dc_id uuid, p_transporter_id uuid, p_vehicle_number text, p_lr_number text, p_lr_date date,
      p_driver_number text, p_driver_contact_number text, p_remarks text, p_gross_weight numeric,
      p_reason text, p_amended_by uuid
    )
    RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = erp_procurement, public AS $fn$
    DECLARE v_dc erp_procurement.delivery_challan%ROWTYPE;
    BEGIN
      SELECT * INTO v_dc FROM erp_procurement.delivery_challan WHERE id = p_dc_id FOR UPDATE;
      IF NOT FOUND OR v_dc.status <> 'DISPATCHED' THEN RAISE EXCEPTION 'DISPATCH_AMENDMENT_BLOCKED'; END IF;
      INSERT INTO erp_procurement.delivery_challan_dispatch_amendment (
        dc_id, amendment_reason,
        old_transporter_id, new_transporter_id,
        old_vehicle_number, new_vehicle_number,
        old_lr_number, new_lr_number,
        old_lr_date, new_lr_date,
        old_driver_number, new_driver_number,
        old_driver_contact_number, new_driver_contact_number,
        old_remarks, new_remarks,
        old_gross_weight, new_gross_weight,
        amended_by
      )
      VALUES (
        p_dc_id, p_reason,
        v_dc.transporter_id, p_transporter_id,
        v_dc.vehicle_number, p_vehicle_number,
        v_dc.lr_number, p_lr_number,
        v_dc.lr_date, p_lr_date,
        v_dc.driver_number, p_driver_number,
        v_dc.driver_contact_number, p_driver_contact_number,
        v_dc.remarks, p_remarks,
        v_dc.gross_weight, p_gross_weight,
        p_amended_by
      );
      UPDATE erp_procurement.delivery_challan SET
        transporter_id = p_transporter_id,
        vehicle_number = p_vehicle_number,
        lr_number = p_lr_number,
        lr_date = p_lr_date,
        driver_number = p_driver_number,
        driver_contact_number = p_driver_contact_number,
        remarks = p_remarks,
        gross_weight = p_gross_weight
      WHERE id = p_dc_id;
    END;
    $fn$;
  $sql$;
  REVOKE EXECUTE ON FUNCTION erp_procurement.amend_delivery_challan_dispatch_details(uuid, uuid, text, text, date, text, text, text, numeric, text, uuid) FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION erp_procurement.amend_delivery_challan_dispatch_details(uuid, uuid, text, text, date, text, text, text, numeric, text, uuid) TO service_role;
END;
$outer$;
