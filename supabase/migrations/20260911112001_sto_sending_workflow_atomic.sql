-- Sending-side STO lifecycle. No receiving GE/GRN or business-data repair.
ALTER TABLE erp_procurement.stock_transfer_order ADD COLUMN IF NOT EXISTS delivery_type text NOT NULL DEFAULT 'STANDARD' CHECK (delivery_type IN ('STANDARD','BULK','TANKER'));
ALTER TABLE erp_procurement.consignment_note ADD COLUMN IF NOT EXISTS sto_line_id uuid REFERENCES erp_procurement.stock_transfer_order_line(id);
ALTER TABLE erp_procurement.consignment_note ADD COLUMN IF NOT EXISTS sto_source_snapshot jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS consignment_note_sto_line_unique ON erp_procurement.consignment_note(sto_line_id) WHERE sto_line_id IS NOT NULL;
GRANT SELECT, INSERT ON erp_procurement.sto_approval_log TO service_role;
GRANT SELECT, INSERT, UPDATE ON erp_procurement.sto_amendment_log TO service_role;

CREATE OR REPLACE FUNCTION erp_procurement."create_sto_atomic"(p_header jsonb, p_lines jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $fn$
DECLARE h erp_procurement.stock_transfer_order; l jsonb; lid uuid; c erp_procurement.consignment_note;
BEGIN
  IF jsonb_array_length(p_lines) = 0 OR p_header->>'created_by' IS NULL THEN RAISE EXCEPTION 'STO_CREATE_INVALID'; END IF;
  IF p_header->>'sending_company_id' = p_header->>'receiving_company_id' THEN RAISE EXCEPTION 'STO_COMPANIES_MUST_DIFFER'; END IF;
  IF (p_header->>'sto_type' = 'INTER_PLANT' AND p_header->>'status' <> 'DRAFT') OR
     (p_header->>'sto_type' = 'CONSIGNMENT_DISTRIBUTION' AND p_header->>'status' <> 'CREATED') THEN RAISE EXCEPTION 'STO_CREATE_STATE_INVALID'; END IF;
  INSERT INTO erp_procurement.stock_transfer_order (sto_number, sto_date, sto_type, sending_company_id, receiving_company_id, sending_cost_center_id, receiving_cost_center_id, related_csn_id, status, is_opening_sto, delivery_type, remarks, group_number, created_by, last_updated_by) SELECT r.sto_number, r.sto_date, r.sto_type, r.sending_company_id, r.receiving_company_id, r.sending_cost_center_id, r.receiving_cost_center_id, r.related_csn_id, r.status, r.is_opening_sto, r.delivery_type, r.remarks, r.group_number, r.created_by, r.last_updated_by FROM jsonb_populate_record(NULL::erp_procurement.stock_transfer_order, p_header) r RETURNING * INTO h;
  -- Lock source CSNs consistently to serialize competing transforms.
  PERFORM id FROM erp_procurement.consignment_note WHERE id IN
    (SELECT (value->>'source_csn_id')::uuid FROM jsonb_array_elements(p_lines) WHERE value->>'source_csn_id' IS NOT NULL)
    ORDER BY id FOR UPDATE;
  FOR l IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    IF h.sto_type = 'CONSIGNMENT_DISTRIBUTION' THEN
      SELECT * INTO c FROM erp_procurement.consignment_note WHERE id = (l->>'source_csn_id')::uuid;
      IF NOT FOUND OR c.mother_csn_id IS NULL OR c.sto_id IS NOT NULL OR c.status NOT IN ('ORD','TRN') THEN RAISE EXCEPTION 'CSN_STO_LINK_BLOCKED'; END IF;
      IF NOT EXISTS (SELECT 1 FROM erp_procurement.consignment_note m WHERE m.id=c.mother_csn_id AND m.company_id=h.sending_company_id)
        OR (c.consignee_company_id IS NOT NULL AND c.consignee_company_id <> h.receiving_company_id)
        OR c.material_id <> (l->>'material_id')::uuid OR c.po_uom_code <> l->>'uom_code'
        OR coalesce(nullif(c.dispatch_qty,0),c.po_qty) <> (l->>'quantity')::numeric
        THEN RAISE EXCEPTION 'CSN_STO_SOURCE_MISMATCH'; END IF;
    END IF;
    l := l || jsonb_build_object('sto_id',h.id,'has_rebate',coalesce((l->>'has_rebate')::boolean,false),
      'gst_amount',round((l->>'quantity')::numeric * (l->>'transfer_price')::numeric * coalesce((l->>'gst_rate')::numeric,0)/100,4));
    INSERT INTO erp_procurement.stock_transfer_order_line (sto_id, line_number, material_id, sending_storage_location_id, receiving_storage_location_id, quantity, uom_code, transfer_price, transfer_price_currency, currency_code, payment_term_id, freight_term, gst_terms, gst_rate, gst_amount, remarks, has_rebate, rebate_rate, rebate_rate_uom_basis, rebate_remarks, expected_delivery_date, balance_qty) SELECT r.sto_id, r.line_number, r.material_id, r.sending_storage_location_id, r.receiving_storage_location_id, r.quantity, r.uom_code, r.transfer_price, r.transfer_price_currency, r.currency_code, r.payment_term_id, r.freight_term, r.gst_terms, r.gst_rate, r.gst_amount, r.remarks, r.has_rebate, r.rebate_rate, r.rebate_rate_uom_basis, r.rebate_remarks, r.expected_delivery_date, r.balance_qty FROM jsonb_populate_record(NULL::erp_procurement.stock_transfer_order_line, l) r RETURNING id INTO lid;
    IF h.sto_type = 'CONSIGNMENT_DISTRIBUTION' THEN
      UPDATE erp_procurement.consignment_note SET sto_source_snapshot=to_jsonb(c),
        sto_id=h.id, sto_line_id=lid, company_id=h.receiving_company_id, vendor_id=h.sending_company_id,
        consignee_company_id=NULL, csn_type='DOMESTIC', delivery_type=h.delivery_type,
        status='ORD', dispatch_qty=0, total_dispatch_qty=0, payment_term_id=(l->>'payment_term_id')::uuid,
        lc_required=false, last_updated_by=h.created_by, last_updated_at=now()
      WHERE id=c.id;
    END IF;
  END LOOP;
  RETURN to_jsonb(h);
END;
$fn$;
REVOKE ALL ON FUNCTION erp_procurement."create_sto_atomic"(jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION erp_procurement."create_sto_atomic"(jsonb,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION erp_procurement."transition_sto_atomic"(p_sto_id uuid,p_from_status text,p_to_status text,p_actor uuid,p_remarks text,p_csns jsonb)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $fn$
DECLARE h erp_procurement.stock_transfer_order; c jsonb; cid uuid;
BEGIN
  SELECT * INTO h FROM erp_procurement.stock_transfer_order WHERE id=p_sto_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'STO_NOT_FOUND'; END IF;
  IF h.status <> p_from_status THEN RAISE EXCEPTION 'STO_TRANSITION_BLOCKED'; END IF;
  IF NOT ((p_from_status='DRAFT' AND p_to_status IN ('CREATED','PENDING_APPROVAL')) OR
          (p_from_status='PENDING_APPROVAL' AND p_to_status='CREATED')) THEN RAISE EXCEPTION 'STO_TRANSITION_BLOCKED'; END IF;
  IF p_to_status='CREATED' AND h.sto_type='INTER_PLANT' THEN
    FOR c IN SELECT value FROM jsonb_array_elements(p_csns) LOOP
      IF NOT EXISTS (SELECT 1 FROM erp_procurement.stock_transfer_order_line l WHERE l.id=(c->>'sto_line_id')::uuid AND l.sto_id=h.id
        AND l.material_id=(c->>'material_id')::uuid AND l.quantity=(c->>'po_qty')::numeric)
        OR (c->>'company_id')::uuid <> h.receiving_company_id OR (c->>'vendor_id')::uuid <> h.sending_company_id
        THEN RAISE EXCEPTION 'STO_CSN_MISMATCH'; END IF;
      c := c || jsonb_build_object('sto_id',h.id);
      IF NOT EXISTS (SELECT 1 FROM erp_procurement.consignment_note WHERE sto_line_id=(c->>'sto_line_id')::uuid) THEN
        INSERT INTO erp_procurement.consignment_note (csn_number, csn_type, delivery_type, status, company_id, vendor_id, material_id, po_qty, po_uom_code, payment_term_id, lc_required, has_rebate, rebate_remarks, created_by, sto_id, sto_line_id, dispatch_qty, is_mother_csn) SELECT r.csn_number, r.csn_type, r.delivery_type, r.status, r.company_id, r.vendor_id, r.material_id, r.po_qty, r.po_uom_code, r.payment_term_id, r.lc_required, r.has_rebate, r.rebate_remarks, r.created_by, r.sto_id, r.sto_line_id, r.dispatch_qty, r.is_mother_csn FROM jsonb_populate_record(NULL::erp_procurement.consignment_note, c) r RETURNING id INTO cid;
      END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM erp_procurement.stock_transfer_order_line l WHERE l.sto_id=h.id AND NOT EXISTS
      (SELECT 1 FROM erp_procurement.consignment_note c WHERE c.sto_line_id=l.id AND c.sto_id=h.id)) THEN RAISE EXCEPTION 'STO_CSN_MISSING'; END IF;
  END IF;
  UPDATE erp_procurement.stock_transfer_order SET status=p_to_status,
    approved_by=CASE WHEN p_to_status='CREATED' THEN p_actor END,
    approved_at=CASE WHEN p_to_status='CREATED' THEN now() END,
    last_updated_by=p_actor,last_updated_at=now() WHERE id=h.id;
  IF p_to_status='PENDING_APPROVAL' OR p_from_status='PENDING_APPROVAL' THEN
    INSERT INTO erp_procurement.sto_approval_log(sto_id,action,from_status,to_status,remarks,actioned_by)
    VALUES(h.id,CASE WHEN p_to_status='PENDING_APPROVAL' THEN 'ESCALATED' ELSE 'APPROVED' END,p_from_status,p_to_status,p_remarks,p_actor);
  END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION erp_procurement."transition_sto_atomic"(uuid,text,text,uuid,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION erp_procurement."transition_sto_atomic"(uuid,text,text,uuid,text,jsonb) TO service_role;

-- Recompute from active DO lines, never increment/decrement a cached total.
-- Deferred triggers see the final edit/cancel/PGI state and roll back with it.
CREATE OR REPLACE FUNCTION erp_procurement.sync_sto_dispatch(p_sto_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $fn$
DECLARE l erp_procurement.stock_transfer_order_line; q numeric; h erp_procurement.stock_transfer_order;
BEGIN
  SELECT * INTO h FROM erp_procurement.stock_transfer_order WHERE id=p_sto_id FOR UPDATE;
  FOR l IN SELECT * FROM erp_procurement.stock_transfer_order_line WHERE sto_id=p_sto_id ORDER BY id FOR UPDATE LOOP
    SELECT coalesce(sum(dl.quantity),0) INTO q FROM erp_procurement.delivery_challan_line dl
    JOIN erp_procurement.delivery_challan d ON d.id=dl.dc_id
    WHERE dl.sto_line_id=l.id AND d.status <> 'CANCELLED';
    IF q > l.quantity THEN RAISE EXCEPTION 'DO_QTY_EXCEEDS_BALANCE'; END IF;
    IF q > 0 AND (h.status NOT IN ('CREATED','DISPATCHED','RECEIVED','CLOSED') OR l.line_status='KNOCKED_OFF') THEN RAISE EXCEPTION 'DO_SOURCE_NOT_DISPATCHABLE'; END IF;
    UPDATE erp_procurement.stock_transfer_order_line SET dispatched_qty=q,last_updated_at=now() WHERE id=l.id;
    UPDATE erp_procurement.consignment_note SET dispatch_qty=q,total_dispatch_qty=q,
      status=CASE WHEN status IN ('ORD','TRN') THEN CASE WHEN q>0 THEN 'TRN' ELSE 'ORD' END ELSE status END,
      last_updated_at=now()
    WHERE sto_line_id=l.id AND sto_id=h.id AND status NOT IN ('CAN','KOF');
  END LOOP;
  UPDATE erp_procurement.stock_transfer_order SET status=CASE WHEN EXISTS
    (SELECT 1 FROM erp_procurement.stock_transfer_order_line WHERE sto_id=h.id AND dispatched_qty>0) THEN 'DISPATCHED' ELSE 'CREATED' END,
    last_updated_at=now() WHERE id=h.id AND status IN ('CREATED','DISPATCHED');
END;
$fn$;
REVOKE ALL ON FUNCTION erp_procurement.sync_sto_dispatch(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION erp_procurement.sync_sto_dispatch(uuid) TO service_role;

CREATE OR REPLACE FUNCTION erp_procurement.sto_do_line_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $fn$
DECLARE l erp_procurement.stock_transfer_order_line; h erp_procurement.stock_transfer_order; company uuid;
BEGIN
  IF NEW.sto_line_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO l FROM erp_procurement.stock_transfer_order_line WHERE id=NEW.sto_line_id;
  SELECT * INTO h FROM erp_procurement.stock_transfer_order WHERE id=l.sto_id FOR UPDATE;
  SELECT selling_company_id INTO company FROM erp_procurement.delivery_challan WHERE id=NEW.dc_id;
  IF h.sending_company_id IS DISTINCT FROM company OR l.material_id IS DISTINCT FROM NEW.material_id OR l.uom_code IS DISTINCT FROM NEW.uom_code
    THEN RAISE EXCEPTION 'DO_STO_COMPANY_OR_MATERIAL_MISMATCH'; END IF;
  IF h.status NOT IN ('CREATED','DISPATCHED') OR l.line_status <> 'OPEN' THEN RAISE EXCEPTION 'DO_SOURCE_NOT_DISPATCHABLE'; END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER sto_do_line_guard BEFORE INSERT OR UPDATE OF sto_line_id,quantity,material_id,dc_id ON erp_procurement.delivery_challan_line
FOR EACH ROW EXECUTE FUNCTION erp_procurement.sto_do_line_guard();

CREATE OR REPLACE FUNCTION erp_procurement.sto_do_dispatch_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $fn$
DECLARE sid uuid; old_line uuid; new_line uuid;
BEGIN
  IF TG_TABLE_NAME='delivery_challan_line' THEN
    IF TG_OP <> 'INSERT' THEN old_line:=OLD.sto_line_id; END IF;
    IF TG_OP <> 'DELETE' THEN new_line:=NEW.sto_line_id; END IF;
    FOR sid IN SELECT DISTINCT sto_id FROM erp_procurement.stock_transfer_order_line WHERE id IN (old_line,new_line) ORDER BY sto_id LOOP
      PERFORM erp_procurement.sync_sto_dispatch(sid);
    END LOOP;
  ELSE
    FOR sid IN SELECT DISTINCT l.sto_id FROM erp_procurement.delivery_challan_line dl
      JOIN erp_procurement.stock_transfer_order_line l ON l.id=dl.sto_line_id WHERE dl.dc_id=NEW.id ORDER BY l.sto_id LOOP
      PERFORM erp_procurement.sync_sto_dispatch(sid);
    END LOOP;
  END IF;
  RETURN NULL;
END;
$fn$;
CREATE CONSTRAINT TRIGGER sto_do_line_dispatch AFTER INSERT OR UPDATE OR DELETE ON erp_procurement.delivery_challan_line
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp_procurement.sto_do_dispatch_trigger();
CREATE CONSTRAINT TRIGGER sto_do_header_dispatch AFTER UPDATE ON erp_procurement.delivery_challan
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp_procurement.sto_do_dispatch_trigger();
REVOKE ALL ON FUNCTION erp_procurement.sto_do_line_guard(), erp_procurement.sto_do_dispatch_trigger() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION erp_procurement.sto_do_line_guard(), erp_procurement.sto_do_dispatch_trigger() TO service_role;
NOTIFY pgrst, 'reload schema';
