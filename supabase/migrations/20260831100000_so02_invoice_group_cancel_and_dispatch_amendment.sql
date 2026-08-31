-- SO02: retain immutable posting history while allowing a posted invoice group
-- to be cancelled and recreated.  Dispatch logistics amendments are recorded
-- separately so they never alter financial or stock postings.

CREATE TABLE IF NOT EXISTS erp_procurement.delivery_challan_dispatch_amendment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dc_id uuid NOT NULL REFERENCES erp_procurement.delivery_challan(id),
  amendment_reason text NOT NULL CHECK (length(trim(amendment_reason)) > 0),
  old_transporter_id uuid NULL,
  new_transporter_id uuid NULL,
  old_vehicle_number text NULL,
  new_vehicle_number text NULL,
  old_lr_number text NULL,
  new_lr_number text NULL,
  old_lr_date date NULL,
  new_lr_date date NULL,
  amended_by uuid NOT NULL,
  amended_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dc_dispatch_amendment_dc_time
  ON erp_procurement.delivery_challan_dispatch_amendment (dc_id, amended_at DESC);

GRANT ALL ON TABLE erp_procurement.delivery_challan_dispatch_amendment TO service_role;

DO $outer$
BEGIN
  EXECUTE $sql$
    CREATE OR REPLACE FUNCTION erp_procurement.amend_delivery_challan_dispatch_details(p_dc_id uuid, p_transporter_id uuid, p_vehicle_number text, p_lr_number text, p_lr_date date, p_reason text, p_amended_by uuid)
    RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = erp_procurement, public AS $fn$
    DECLARE v_dc erp_procurement.delivery_challan%ROWTYPE;
    BEGIN
      SELECT * INTO v_dc FROM erp_procurement.delivery_challan WHERE id = p_dc_id FOR UPDATE;
      IF NOT FOUND OR v_dc.status <> 'DISPATCHED' THEN RAISE EXCEPTION 'DISPATCH_AMENDMENT_BLOCKED'; END IF;
      INSERT INTO erp_procurement.delivery_challan_dispatch_amendment (dc_id, amendment_reason, old_transporter_id, new_transporter_id, old_vehicle_number, new_vehicle_number, old_lr_number, new_lr_number, old_lr_date, new_lr_date, amended_by)
      VALUES (p_dc_id, p_reason, v_dc.transporter_id, p_transporter_id, v_dc.vehicle_number, p_vehicle_number, v_dc.lr_number, p_lr_number, v_dc.lr_date, p_lr_date, p_amended_by);
      UPDATE erp_procurement.delivery_challan SET transporter_id = p_transporter_id, vehicle_number = p_vehicle_number, lr_number = p_lr_number, lr_date = p_lr_date WHERE id = p_dc_id;
    END;
    $fn$;
  $sql$;
  REVOKE EXECUTE ON FUNCTION erp_procurement.amend_delivery_challan_dispatch_details(uuid, uuid, text, text, date, text, uuid) FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION erp_procurement.amend_delivery_challan_dispatch_details(uuid, uuid, text, text, date, text, uuid) TO service_role;
END;
$outer$;

DO $outer$
BEGIN
  EXECUTE $sql$
    CREATE OR REPLACE FUNCTION erp_inventory.reverse_sales_invoice_groups_atomic(p_groups jsonb, p_posted_by uuid)
    RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = erp_inventory, erp_procurement, public AS $fn$
    DECLARE v_group jsonb; v_invoice_id uuid; v_invoice_number text; v_invoice_date date; v_company_id uuid; v_dc_id uuid; v_reason text; v_matdoc_number text; v_matdoc_year text; v_movements jsonb; v_context jsonb;
    BEGIN
      IF p_groups IS NULL OR jsonb_typeof(p_groups) <> 'array' OR jsonb_array_length(p_groups) = 0 THEN RAISE EXCEPTION 'PGI_INVOICE_GROUPS_INVALID'; END IF;
      FOR v_group IN SELECT value FROM jsonb_array_elements(p_groups) LOOP
        v_invoice_id := NULLIF(v_group->>'invoice_id', '')::uuid; v_invoice_number := NULLIF(v_group->>'invoice_number', ''); v_invoice_date := NULLIF(v_group->>'invoice_date', '')::date; v_company_id := NULLIF(v_group->>'company_id', '')::uuid; v_dc_id := NULLIF(v_group->>'dc_id', '')::uuid; v_reason := NULLIF(trim(v_group->>'reason'), '');
        IF v_invoice_id IS NULL OR v_invoice_number IS NULL OR v_company_id IS NULL OR v_reason IS NULL THEN RAISE EXCEPTION 'PGI_INVOICE_REVERSE_CONTEXT_INVALID'; END IF;
        SELECT doc_number, doc_year INTO v_matdoc_number, v_matdoc_year FROM erp_inventory.generate_material_doc_number(v_company_id);
        SELECT jsonb_agg(movement || jsonb_build_object('document_number', v_invoice_number, 'document_date', COALESCE(v_invoice_date, current_date), 'posting_date', current_date, 'movement_type_code', 'P602', 'company_id', v_company_id, 'stock_type_code', 'UNRESTRICTED', 'direction', 'IN', 'material_doc_number', v_matdoc_number, 'material_doc_year', v_matdoc_year, 'reference_document_number', v_invoice_number) ORDER BY ordinal) INTO v_movements FROM jsonb_array_elements(v_group->'movements') WITH ORDINALITY AS entries(movement, ordinal);
        IF v_movements IS NULL THEN RAISE EXCEPTION 'PGI_INVOICE_NO_POSTINGS_FOUND'; END IF;
        v_context := jsonb_build_object('action', 'REVERSE', 'dc_id', v_dc_id, 'cancel', jsonb_build_object('cancelled_by', p_posted_by, 'cancelled_at', now(), 'cancellation_reason', v_reason));
        PERFORM erp_inventory.post_document('SALES_INVOICE', v_invoice_id, v_movements, p_posted_by, v_context);
      END LOOP;
    END;
    $fn$;
  $sql$;
  REVOKE EXECUTE ON FUNCTION erp_inventory.reverse_sales_invoice_groups_atomic(jsonb, uuid) FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION erp_inventory.reverse_sales_invoice_groups_atomic(jsonb, uuid) TO service_role;
END;
$outer$;
