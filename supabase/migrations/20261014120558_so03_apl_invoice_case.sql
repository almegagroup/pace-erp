-- SO03 APL Invoice Case.  A case is attached to a SALES delivery order only;
-- STO documents deliberately have no FO / SO Map lifecycle to restore.
BEGIN;

CREATE TABLE erp_procurement.delivery_order_apl_invoice_case (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dc_id uuid NOT NULL UNIQUE REFERENCES erp_procurement.delivery_challan(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES erp_master.companies(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('NO', 'YES', 'CANCELLED')),
  received_date date NULL,
  cancellation_reason text NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT delivery_order_apl_invoice_case_received_date_check
    CHECK ((status = 'YES' AND received_date IS NOT NULL) OR (status <> 'YES' AND received_date IS NULL))
);

CREATE TABLE erp_procurement.delivery_order_apl_invoice_case_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  apl_case_id uuid NOT NULL REFERENCES erp_procurement.delivery_order_apl_invoice_case(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('NO', 'YES', 'CANCELLED')),
  received_date date NULL,
  cancellation_reason text NULL,
  changed_by uuid NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_delivery_order_apl_invoice_case_company ON erp_procurement.delivery_order_apl_invoice_case(company_id, status);
CREATE INDEX ix_delivery_order_apl_invoice_case_history_case ON erp_procurement.delivery_order_apl_invoice_case_history(apl_case_id, changed_at DESC);

ALTER TABLE erp_procurement.delivery_order_apl_invoice_case ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_procurement.delivery_order_apl_invoice_case_history ENABLE ROW LEVEL SECURITY;

-- The handler has already validated company scope and PROC_DO_CREATE:EDIT.
-- This procedure only performs the durable, append-only case state change.
CREATE OR REPLACE FUNCTION erp_procurement.save_apl_invoice_case(
  p_dc_id uuid,
  p_company_id uuid,
  p_status text,
  p_received_date date,
  p_actor uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = erp_procurement, public
AS $fn$
DECLARE v_case_id uuid; v_status text := upper(trim(p_status));
BEGIN
  IF v_status NOT IN ('NO', 'YES') THEN RAISE EXCEPTION 'APL_CASE_STATUS_INVALID'; END IF;
  IF (v_status = 'YES' AND p_received_date IS NULL) OR (v_status = 'NO' AND p_received_date IS NOT NULL) THEN
    RAISE EXCEPTION 'APL_CASE_RECEIVED_DATE_INVALID';
  END IF;
  PERFORM 1 FROM erp_procurement.delivery_challan
  WHERE id = p_dc_id AND selling_company_id = p_company_id AND dc_type = 'SALES' AND status <> 'CANCELLED'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'APL_CASE_SALES_DO_NOT_FOUND'; END IF;

  INSERT INTO erp_procurement.delivery_order_apl_invoice_case
    (dc_id, company_id, status, received_date, created_by, updated_by)
  VALUES (p_dc_id, p_company_id, v_status, p_received_date, p_actor, p_actor)
  ON CONFLICT (dc_id) DO UPDATE SET
    status = EXCLUDED.status,
    received_date = EXCLUDED.received_date,
    cancellation_reason = NULL,
    updated_by = EXCLUDED.updated_by,
    updated_at = now()
  RETURNING id INTO v_case_id;

  INSERT INTO erp_procurement.delivery_order_apl_invoice_case_history
    (apl_case_id, status, received_date, changed_by)
  VALUES (v_case_id, v_status, p_received_date, p_actor);
  RETURN v_case_id;
END;
$fn$;

REVOKE ALL ON FUNCTION erp_procurement.save_apl_invoice_case(uuid, uuid, text, date, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_procurement.save_apl_invoice_case(uuid, uuid, text, date, uuid) TO service_role;

-- This composes the established cancellation/reversal primitives inside one
-- database transaction. It never calls post_stock_movement directly.
CREATE OR REPLACE FUNCTION erp_procurement.cancel_apl_sales_delivery_order_atomic(
  p_dc_id uuid,
  p_company_id uuid,
  p_reason text,
  p_actor uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = erp_procurement, erp_inventory, erp_production, public
AS $fn$
DECLARE
  v_dc erp_procurement.delivery_challan%ROWTYPE;
  v_case_id uuid;
  v_groups jsonb;
  v_invoice record;
  v_movements jsonb;
  v_doc_number text;
  v_doc_year text;
BEGIN
  IF NULLIF(trim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'APL_CASE_CANCEL_REASON_REQUIRED'; END IF;
  SELECT * INTO v_dc FROM erp_procurement.delivery_challan
  WHERE id = p_dc_id AND selling_company_id = p_company_id AND dc_type = 'SALES'
  FOR UPDATE;
  IF NOT FOUND OR v_dc.status = 'CANCELLED' THEN RAISE EXCEPTION 'APL_CASE_SALES_DO_NOT_FOUND'; END IF;

  SELECT id INTO v_case_id FROM erp_procurement.delivery_order_apl_invoice_case
  WHERE dc_id = p_dc_id AND company_id = p_company_id AND status = 'NO'
  FOR UPDATE;
  IF v_case_id IS NULL THEN RAISE EXCEPTION 'APL_CASE_CANCEL_REQUIRES_NO'; END IF;

  IF v_dc.pgi_deferred IS TRUE THEN
    IF v_dc.status = 'CREATED' THEN
      PERFORM erp_procurement."cancel_vdc_created_delivery_order_atomic"(p_dc_id, p_reason, p_actor);
    ELSIF v_dc.status = 'INVOICED' AND NOT EXISTS (SELECT 1 FROM erp_procurement.sales_invoice WHERE dc_id = p_dc_id AND status = 'POSTED') THEN
      PERFORM erp_procurement.cancel_vdc_invoice_only_atomic(p_dc_id, p_reason, p_actor);
    ELSIF v_dc.status IN ('INVOICED', 'DISPATCHED') THEN
      -- A partially completed VDC can contain draft and posted invoices. The
      -- existing helper cancels the draft portion; P602 remains in the
      -- dedicated VDC posting source/completion path below.
      IF EXISTS (SELECT 1 FROM erp_procurement.sales_invoice WHERE dc_id = p_dc_id AND status = 'DRAFT') THEN
        PERFORM erp_procurement.cancel_vdc_draft_invoices_for_cascade(p_dc_id, p_reason, p_actor);
      END IF;
      FOR v_invoice IN
        SELECT id, invoice_number, invoice_date FROM erp_procurement.sales_invoice
        WHERE dc_id = p_dc_id AND status = 'POSTED' ORDER BY id
      LOOP
        SELECT jsonb_agg(jsonb_build_object(
          'document_number', v_invoice.invoice_number, 'document_date', v_invoice.invoice_date,
          'posting_date', current_date, 'movement_type_code', 'P602', 'company_id', p_company_id,
          'storage_location_id', sd.source_location_id, 'material_id', sd.material_id,
          'quantity', sd.quantity, 'base_uom_code', sd.base_uom_code, 'unit_value', sd.valuation_rate,
          'stock_type_code', 'UNRESTRICTED', 'direction', 'IN', 'reversal_of_id', sd.id,
          'material_doc_number', md.doc_number, 'material_doc_year', md.doc_year,
          'reference_document_number', v_invoice.invoice_number, 'line_ref', sd.id
        )) INTO v_movements
        FROM erp_inventory.stock_document sd
        CROSS JOIN LATERAL erp_inventory.generate_material_doc_number(p_company_id) md
        WHERE sd.reference_document_type = 'VDC_SALES_INVOICE'
          AND sd.reference_document_id = v_invoice.id AND sd.movement_type_code = 'P601'
          AND sd.reversal_document_id IS NULL;
        IF v_movements IS NULL THEN RAISE EXCEPTION 'VDC_PGI_REVERSE_NO_POSTINGS_FOUND'; END IF;
        PERFORM erp_inventory.post_document(
          'VDC_SALES_INVOICE', v_invoice.id, v_movements, p_actor,
          jsonb_build_object('action','REVERSE','dc_id',p_dc_id,'cancel',jsonb_build_object('cancelled_by',p_actor,'cancelled_at',now(),'cancellation_reason',p_reason))
        );
      END LOOP;
    ELSE
      RAISE EXCEPTION 'VDC_CANCEL_BLOCKED';
    END IF;
  ELSE
    IF v_dc.status = 'CREATED' THEN
      PERFORM erp_procurement.cancel_delivery_order_atomic(p_dc_id, p_reason, p_actor);
    ELSE
      SELECT jsonb_agg(jsonb_build_object(
        'invoice_id', si.id, 'invoice_number', si.invoice_number, 'invoice_date', si.invoice_date,
        'company_id', p_company_id, 'dc_id', p_dc_id, 'reason', p_reason,
        'movements', legs.movements
      )) INTO v_groups
      FROM erp_procurement.sales_invoice si
      CROSS JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_object(
          'storage_location_id', sd.source_location_id, 'material_id', sd.material_id,
          'quantity', sd.quantity, 'base_uom_code', sd.base_uom_code,
          'unit_value', sd.valuation_rate, 'reversal_of_id', sd.id, 'line_ref', sd.id
        )) AS movements
        FROM erp_inventory.stock_document sd
        WHERE sd.reference_document_type = 'SALES_INVOICE'
          AND sd.reference_document_id = si.id AND sd.movement_type_code = 'P601'
          AND sd.reversal_document_id IS NULL
      ) legs
      WHERE si.dc_id = p_dc_id AND si.status = 'POSTED';
      IF v_groups IS NULL THEN RAISE EXCEPTION 'APL_CASE_POSTED_INVOICE_NOT_FOUND'; END IF;
      PERFORM erp_inventory.reverse_sales_invoice_groups_atomic(v_groups, p_actor);
      PERFORM erp_procurement.cancel_delivery_order_atomic(p_dc_id, p_reason, p_actor);
    END IF;
  END IF;

  UPDATE erp_procurement.delivery_order_apl_invoice_case
  SET status = 'CANCELLED', received_date = NULL, cancellation_reason = p_reason,
      updated_by = p_actor, updated_at = now()
  WHERE id = v_case_id;
  INSERT INTO erp_procurement.delivery_order_apl_invoice_case_history
    (apl_case_id, status, cancellation_reason, changed_by)
  VALUES (v_case_id, 'CANCELLED', p_reason, p_actor);
END;
$fn$;

REVOKE ALL ON FUNCTION erp_procurement.cancel_apl_sales_delivery_order_atomic(uuid, uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_procurement.cancel_apl_sales_delivery_order_atomic(uuid, uuid, text, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
