-- A partial invoice must issue/reopen only its own DO-line reservations.
CREATE OR REPLACE FUNCTION erp_procurement.complete_pgi_invoice_action(p_reference_document_id uuid, p_postings jsonb, p_context jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'erp_procurement', 'erp_production', 'public'
AS $function$
DECLARE
  v_action text := p_context->>'action';
  v_dc_id  uuid := NULLIF(p_context->>'dc_id', '')::uuid;
  v_inv    jsonb := p_context->'invoice';
  v_cancel jsonb := p_context->'cancel';
  v_remaining_active_invoices int;
  v_reversal_date date := COALESCE((v_cancel->>'cancelled_at')::date, current_date);
BEGIN
  IF v_action = 'CREATE' THEN
    INSERT INTO erp_procurement.sales_invoice (
      id, invoice_number, invoice_date, company_id, customer_id, sto_id, dc_id, so_id,
      payment_term_id, gst_type,
      bill_to_name, bill_to_address, bill_to_state, bill_to_gst_number,
      ship_to_name, ship_to_address, ship_to_state, ship_to_gst_number,
      tally_invoice_number, tally_invoice_date, freight_included, freight_amount,
      total_taxable_value, total_cgst_amount, total_sgst_amount, total_igst_amount,
      total_gst_amount, total_invoice_value, status, posted_by, posted_at, remarks, created_by,
      inbound_number, e_way_bill_applicable, e_way_bill_number,
      freight_mode, freight_rate, freight_net_weight,
      freight_gst_included, freight_gst_treatment, freight_gst_rate, freight_gst_amount,
      additional_cost_total, round_off_amount, fo_id, fo_number, fo_date
    )
    VALUES (
      p_reference_document_id,
      v_inv->>'invoice_number',
      (v_inv->>'invoice_date')::date,
      (v_inv->>'company_id')::uuid,
      NULLIF(v_inv->>'customer_id', '')::uuid,
      NULLIF(v_inv->>'sto_id', '')::uuid,
      (v_inv->>'dc_id')::uuid,
      NULLIF(v_inv->>'so_id', '')::uuid,
      NULLIF(v_inv->>'payment_term_id', '')::uuid,
      v_inv->>'gst_type',
      v_inv->>'bill_to_name', v_inv->>'bill_to_address', v_inv->>'bill_to_state', v_inv->>'bill_to_gst_number',
      v_inv->>'ship_to_name', v_inv->>'ship_to_address', v_inv->>'ship_to_state', v_inv->>'ship_to_gst_number',
      v_inv->>'tally_invoice_number',
      (v_inv->>'tally_invoice_date')::date,
      COALESCE((v_inv->>'freight_included')::boolean, false),
      NULLIF(v_inv->>'freight_amount', '')::numeric,
      NULLIF(v_inv->>'total_taxable_value', '')::numeric,
      NULLIF(v_inv->>'total_cgst_amount', '')::numeric,
      NULLIF(v_inv->>'total_sgst_amount', '')::numeric,
      NULLIF(v_inv->>'total_igst_amount', '')::numeric,
      NULLIF(v_inv->>'total_gst_amount', '')::numeric,
      NULLIF(v_inv->>'total_invoice_value', '')::numeric,
      'POSTED',
      NULLIF(v_inv->>'posted_by', '')::uuid,
      COALESCE((v_inv->>'posted_at')::timestamptz, now()),
      NULLIF(v_inv->>'remarks', ''),
      (v_inv->>'created_by')::uuid,
      NULLIF(v_inv->>'inbound_number', ''),
      COALESCE((v_inv->>'e_way_bill_applicable')::boolean, false),
      NULLIF(v_inv->>'e_way_bill_number', ''),
      NULLIF(v_inv->>'freight_mode', ''),
      NULLIF(v_inv->>'freight_rate', '')::numeric,
      NULLIF(v_inv->>'freight_net_weight', '')::numeric,
      COALESCE((v_inv->>'freight_gst_included')::boolean, false),
      NULLIF(v_inv->>'freight_gst_treatment', ''),
      NULLIF(v_inv->>'freight_gst_rate', '')::numeric,
      NULLIF(v_inv->>'freight_gst_amount', '')::numeric,
      COALESCE(NULLIF(v_inv->>'additional_cost_total', '')::numeric, 0),
      COALESCE(NULLIF(v_inv->>'round_off_amount', '')::numeric, 0),
      NULLIF(v_inv->>'fo_id', '')::uuid,
      NULLIF(v_inv->>'fo_number', ''),
      NULLIF(v_inv->>'fo_date', '')::date
    );

    INSERT INTO erp_procurement.sales_invoice_line (
      id, invoice_id, line_number, so_line_id, dc_line_id, material_id, quantity, uom_code, rate,
      display_rate_basis, display_rate, display_uom_code, pack_qty, pack_uom_code,
      taxable_value, gst_rate, cgst_amount, sgst_amount, igst_amount, line_total
    )
    SELECT
      gen_random_uuid(),
      p_reference_document_id,
      (line->>'line_number')::int,
      NULLIF(line->>'so_line_id', '')::uuid,
      NULLIF(line->>'dc_line_id', '')::uuid,
      (line->>'material_id')::uuid,
      (line->>'quantity')::numeric,
      line->>'uom_code',
      (line->>'rate')::numeric,
      NULLIF(line->>'display_rate_basis', ''),
      NULLIF(line->>'display_rate', '')::numeric,
      NULLIF(line->>'display_uom_code', ''),
      NULLIF(line->>'pack_qty', '')::numeric,
      NULLIF(line->>'pack_uom_code', ''),
      (line->>'taxable_value')::numeric,
      NULLIF(line->>'gst_rate', '')::numeric,
      NULLIF(line->>'cgst_amount', '')::numeric,
      NULLIF(line->>'sgst_amount', '')::numeric,
      NULLIF(line->>'igst_amount', '')::numeric,
      (line->>'line_total')::numeric
    FROM jsonb_array_elements(p_context->'lines') AS line;

    INSERT INTO erp_procurement.sales_invoice_additional_cost_line (
      id, invoice_id, category_id, amount, gst_included, gst_treatment, gst_rate, gst_amount, line_total
    )
    SELECT
      gen_random_uuid(),
      p_reference_document_id,
      (ac->>'category_id')::uuid,
      (ac->>'amount')::numeric,
      COALESCE((ac->>'gst_included')::boolean, false),
      NULLIF(ac->>'gst_treatment', ''),
      NULLIF(ac->>'gst_rate', '')::numeric,
      NULLIF(ac->>'gst_amount', '')::numeric,
      (ac->>'line_total')::numeric
    FROM jsonb_array_elements(COALESCE(p_context->'additional_cost_lines', '[]'::jsonb)) AS ac;

    INSERT INTO erp_production.dispatch_reco (
      id, company_id, invoice_id, invoice_number, invoice_date, tally_invoice_number, tally_invoice_date,
      inbound_number, dc_id, dc_number, source_type, so_id, so_number, fo_id, fo_number, dispatch_category,
      process_order_id, process_order_number, batch_number, packing_order_id, packing_order_number, po_type,
      dispatch_qty_kg, material_id, line_material_type, standard_qty, actual_qty, ap_approved_qty,
      is_asian_billed, created_by
    )
    SELECT
      gen_random_uuid(),
      (v_inv->>'company_id')::uuid,
      p_reference_document_id,
      v_inv->>'invoice_number',
      (v_inv->>'invoice_date')::date,
      dr->>'tally_invoice_number',
      NULLIF(dr->>'tally_invoice_date', '')::date,
      NULLIF(dr->>'inbound_number', ''),
      v_dc_id,
      dr->>'dc_number',
      'SALES_ORDER',
      NULLIF(dr->>'so_id', '')::uuid,
      dr->>'so_number',
      NULLIF(dr->>'fo_id', '')::uuid,
      dr->>'fo_number',
      dr->>'dispatch_category',
      NULLIF(dr->>'process_order_id', '')::uuid,
      dr->>'process_order_number',
      dr->>'batch_number',
      NULLIF(dr->>'packing_order_id', '')::uuid,
      dr->>'packing_order_number',
      dr->>'po_type',
      (dr->>'dispatch_qty_kg')::numeric,
      (dr->>'material_id')::uuid,
      dr->>'line_material_type',
      NULLIF(dr->>'standard_qty', '')::numeric,
      NULLIF(dr->>'actual_qty', '')::numeric,
      NULLIF(dr->>'ap_approved_qty', '')::numeric,
      COALESCE((dr->>'is_asian_billed')::boolean, true),
      (v_inv->>'created_by')::uuid
    FROM jsonb_array_elements(COALESCE(p_context->'dispatch_reco_lines', '[]'::jsonb)) AS dr;

    UPDATE erp_production.reservation_document rd
    SET status = 'FULLY_ISSUED',
        issued_qty = (r->>'issued_qty')::numeric,
        last_updated_at = now(),
        last_updated_by = NULLIF(v_inv->>'posted_by', '')::uuid
    FROM jsonb_array_elements(COALESCE(p_context->'reservations', '[]'::jsonb)) AS r
    WHERE rd.source_line_id = (r->>'source_line_id')::uuid
      AND rd.dc_line_id = NULLIF(r->>'dc_line_id', '')::uuid
      AND rd.status IN ('OPEN', 'PARTIAL');

    IF COALESCE(p_context->>'is_final_group', 'true') = 'true' THEN
      UPDATE erp_procurement.delivery_challan
      SET status = 'DISPATCHED'
      WHERE id = v_dc_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'PGI_INVOICE_DC_NOT_FOUND: %', v_dc_id;
      END IF;
    END IF;

  ELSIF v_action = 'REVERSE' THEN
    UPDATE erp_procurement.sales_invoice
    SET status = 'CANCELLED',
        cancelled_by = NULLIF(v_cancel->>'cancelled_by', '')::uuid,
        cancelled_at = COALESCE((v_cancel->>'cancelled_at')::timestamptz, now()),
        cancellation_reason = v_cancel->>'cancellation_reason',
        last_updated_at = now()
    WHERE id = p_reference_document_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'SALES_INVOICE_REVERSE_NOT_FOUND: %', p_reference_document_id;
    END IF;

    WITH voided AS (
      UPDATE erp_production.dispatch_reco
      SET is_voided = true,
          voided_at = COALESCE((v_cancel->>'cancelled_at')::timestamptz, now()),
          voided_by = NULLIF(v_cancel->>'cancelled_by', '')::uuid
      WHERE invoice_id = p_reference_document_id
        AND is_voided = false
      RETURNING *
    )
    INSERT INTO erp_production.dispatch_reco (
      id, company_id, invoice_id, invoice_number, invoice_date, tally_invoice_number, tally_invoice_date,
      inbound_number, dc_id, dc_number, source_type, so_id, so_number, fo_id, fo_number, dispatch_category,
      process_order_id, process_order_number, batch_number, packing_order_id, packing_order_number, po_type,
      dispatch_qty_kg, material_id, line_material_type, standard_qty, actual_qty, ap_approved_qty,
      is_asian_billed, reversal_of_id, created_by
    )
    SELECT
      gen_random_uuid(),
      company_id, invoice_id, invoice_number, invoice_date, tally_invoice_number,
      v_reversal_date,
      inbound_number, dc_id, dc_number, source_type, so_id, so_number, fo_id, fo_number, dispatch_category,
      process_order_id, process_order_number, batch_number, packing_order_id, packing_order_number, po_type,
      -dispatch_qty_kg, material_id, line_material_type,
      CASE WHEN standard_qty IS NULL THEN NULL ELSE -standard_qty END,
      CASE WHEN actual_qty IS NULL THEN NULL ELSE -actual_qty END,
      CASE WHEN ap_approved_qty IS NULL THEN NULL ELSE -ap_approved_qty END,
      is_asian_billed, id,
      NULLIF(v_cancel->>'cancelled_by', '')::uuid
    FROM voided;

    UPDATE erp_production.reservation_document rd
    SET issued_qty = GREATEST(rd.issued_qty - COALESCE(sil.quantity, 0), 0),
        status = CASE WHEN GREATEST(rd.issued_qty - COALESCE(sil.quantity, 0), 0) <= 0 THEN 'OPEN' ELSE 'PARTIAL' END,
        last_updated_at = now(),
        last_updated_by = NULLIF(v_cancel->>'cancelled_by', '')::uuid
    FROM erp_procurement.sales_invoice_line sil
    JOIN erp_procurement.delivery_challan_line dcl ON dcl.id = sil.dc_line_id
    WHERE sil.invoice_id = p_reference_document_id
      AND rd.source_line_id = COALESCE(dcl.so_line_id, dcl.sto_line_id)
      AND rd.dc_line_id = dcl.id
      AND rd.status IN ('PARTIAL', 'FULLY_ISSUED');

    IF v_dc_id IS NOT NULL THEN
      SELECT count(*) INTO v_remaining_active_invoices
      FROM erp_procurement.sales_invoice
      WHERE dc_id = v_dc_id AND status IN ('DRAFT', 'POSTED');
      IF v_remaining_active_invoices = 0 THEN
        UPDATE erp_procurement.delivery_challan
        SET status = 'CREATED'
        WHERE id = v_dc_id;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'PGI_INVOICE_REVERSE_DC_NOT_FOUND: %', v_dc_id;
        END IF;
      END IF;
    END IF;

  ELSE
    RAISE EXCEPTION 'PGI_INVOICE_ACTION_UNKNOWN: %', v_action;
  END IF;
END;
$function$;

-- Cancellation and CSN restoration must be one operation, before dispatch only.
CREATE OR REPLACE FUNCTION erp_procurement.cancel_sto_atomic(p_sto_id uuid,p_reason text,p_actor uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $fn$
DECLARE h erp_procurement.stock_transfer_order; c erp_procurement.consignment_note; source erp_procurement.consignment_note;
BEGIN
  SELECT * INTO h FROM erp_procurement.stock_transfer_order WHERE id=p_sto_id FOR UPDATE;
  IF NOT FOUND OR h.status NOT IN ('DRAFT','PENDING_APPROVAL','CREATED') OR nullif(trim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'STO_CANCEL_BLOCKED'; END IF;
  IF EXISTS(SELECT 1 FROM erp_procurement.delivery_challan_line dl JOIN erp_procurement.stock_transfer_order_line l ON l.id=dl.sto_line_id
    JOIN erp_procurement.delivery_challan d ON d.id=dl.dc_id WHERE l.sto_id=h.id AND d.status<>'CANCELLED') THEN RAISE EXCEPTION 'STO_HAS_ACTIVE_DO'; END IF;
  FOR c IN SELECT * FROM erp_procurement.consignment_note WHERE sto_id=h.id FOR UPDATE LOOP
    IF c.status IN ('GED','GRD') THEN RAISE EXCEPTION 'STO_CANCEL_BLOCKED'; END IF;
    IF h.sto_type='CONSIGNMENT_DISTRIBUTION' AND c.sto_source_snapshot IS NOT NULL THEN
      source:=jsonb_populate_record(NULL::erp_procurement.consignment_note,c.sto_source_snapshot);
      UPDATE erp_procurement.consignment_note SET sto_id=NULL,sto_line_id=NULL,sto_source_snapshot=NULL,
        company_id=source.company_id,vendor_id=source.vendor_id,consignee_company_id=source.consignee_company_id,
        csn_type=source.csn_type,delivery_type=source.delivery_type,status=source.status,
        dispatch_qty=source.dispatch_qty,total_dispatch_qty=source.total_dispatch_qty,
        payment_term_id=source.payment_term_id,lc_required=source.lc_required,last_updated_at=now(),last_updated_by=p_actor
      WHERE id=c.id;
    ELSE
      UPDATE erp_procurement.consignment_note SET status='CAN',inactive_reason_code='CAN',inactive_from_status=c.status,
        inactive_at=now(),inactive_by=p_actor,remarks=p_reason,last_updated_at=now(),last_updated_by=p_actor WHERE id=c.id;
    END IF;
  END LOOP;
  UPDATE erp_procurement.stock_transfer_order SET status='CANCELLED',cancellation_reason=p_reason,cancelled_at=now(),
    cancelled_by=p_actor,last_updated_at=now(),last_updated_by=p_actor WHERE id=h.id;
END $fn$;
REVOKE ALL ON FUNCTION erp_procurement.cancel_sto_atomic(uuid,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION erp_procurement.cancel_sto_atomic(uuid,text,uuid) TO service_role;

-- No stale edit or knock-off can race an active DO on this source line.
CREATE OR REPLACE FUNCTION erp_procurement.guard_sto_line_change()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $fn$
BEGIN
  PERFORM id FROM erp_procurement.stock_transfer_order WHERE id=NEW.sto_id FOR UPDATE;
  IF (NEW.quantity,NEW.transfer_price,NEW.gst_rate,NEW.material_id,NEW.uom_code,NEW.line_status)
    IS DISTINCT FROM (OLD.quantity,OLD.transfer_price,OLD.gst_rate,OLD.material_id,OLD.uom_code,OLD.line_status)
    AND EXISTS(SELECT 1 FROM erp_procurement.delivery_challan_line dl JOIN erp_procurement.delivery_challan d ON d.id=dl.dc_id
      WHERE dl.sto_line_id=NEW.id AND d.status<>'CANCELLED') THEN RAISE EXCEPTION 'STO_LINE_HAS_ACTIVE_DO'; END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER sto_line_change_guard BEFORE UPDATE ON erp_procurement.stock_transfer_order_line
FOR EACH ROW EXECUTE FUNCTION erp_procurement.guard_sto_line_change();
REVOKE ALL ON FUNCTION erp_procurement.guard_sto_line_change() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION erp_procurement.guard_sto_line_change() TO service_role;
NOTIFY pgrst, 'reload schema';
