-- DEV ONLY. Every business row and stock effect is rolled back.
BEGIN;
SET LOCAL ROLE service_role;
DO $test$
DECLARE actor uuid:=gen_random_uuid(); sender uuid:=gen_random_uuid(); receiver uuid:=gen_random_uuid();
  material uuid:=gen_random_uuid(); term uuid; loc uuid; h jsonb; line jsonb; csns jsonb;
  sid uuid; lid uuid; lid2 uuid; dc uuid; dc2 uuid; inv uuid:=gen_random_uuid(); dcLine uuid; invContext jsonb; movement jsonb; before_qty numeric; value_rate numeric; mother uuid; sub uuid; po uuid; dist jsonb; c integer; qty numeric; failed boolean; dline jsonb;
BEGIN
  SELECT company_id,material_id,storage_location_id,quantity,valuation_rate INTO sender,material,loc,before_qty,value_rate FROM erp_inventory.stock_snapshot WHERE stock_type_code='UNRESTRICTED' AND batch_id IS NULL AND quantity>5000 AND base_uom_code='KG' ORDER BY quantity DESC LIMIT 1;
  SELECT id INTO receiver FROM erp_master.companies WHERE id<>sender ORDER BY id LIMIT 1;
  SELECT id INTO term FROM erp_master.payment_terms_master LIMIT 1;
  line:=jsonb_build_object('line_number',1,'material_id',material,'quantity',3000,'uom_code','KG',
    'transfer_price',72.2,'transfer_price_currency','INR','currency_code','INR','payment_term_id',term,
    'freight_term','FREIGHT_SEPARATE','gst_rate',18,'has_rebate',false,'balance_qty',3000);
  h:=jsonb_build_object('sto_number','TEST-STO-'||gen_random_uuid(),'sto_date',current_date,
    'sto_type','INTER_PLANT','status','DRAFT','is_opening_sto',true,'delivery_type','TANKER',
    'sending_company_id',sender,'receiving_company_id',receiver,'created_by',actor);
  -- Bad second line rolls back the header and first line.
  failed:=false;
  BEGIN
    PERFORM erp_procurement.create_sto_atomic(h,jsonb_build_array(line,line||'{"line_number":2,"quantity":-1}'::jsonb));
  EXCEPTION WHEN check_violation THEN failed:=true; END;
  IF NOT failed OR EXISTS(SELECT 1 FROM erp_procurement.stock_transfer_order WHERE sto_number=h->>'sto_number') THEN RAISE EXCEPTION 'TEST_PARTIAL_CREATE'; END IF;
  h:=erp_procurement.create_sto_atomic(h,jsonb_build_array(line,line||'{"line_number":2}'::jsonb)); sid:=(h->>'id')::uuid;
  SELECT id INTO lid FROM erp_procurement.stock_transfer_order_line WHERE sto_id=sid AND line_number=1;
  SELECT id INTO lid2 FROM erp_procurement.stock_transfer_order_line WHERE sto_id=sid AND line_number=2;
  failed:=false;
  BEGIN PERFORM erp_procurement.transition_sto_atomic(sid,'DRAFT','CREATED',actor,NULL,'[]');
  EXCEPTION WHEN raise_exception THEN failed:=true; END;
  IF NOT failed OR (SELECT status FROM erp_procurement.stock_transfer_order WHERE id=sid)<>'DRAFT' THEN RAISE EXCEPTION 'TEST_PARTIAL_CONFIRM'; END IF;
  SELECT jsonb_agg(jsonb_build_object('csn_number','TEST-CSN-'||l.id,'csn_type','DOMESTIC','delivery_type','TANKER',
    'status','ORD','company_id',receiver,'vendor_id',sender,'material_id',material,'po_qty',3000,'po_uom_code','KG',
    'payment_term_id',term,'lc_required',false,'has_rebate',false,'created_by',actor,'sto_id',sid,'sto_line_id',l.id,
    'dispatch_qty',0,'is_mother_csn',false)) INTO csns FROM erp_procurement.stock_transfer_order_line l WHERE sto_id=sid;
  PERFORM erp_procurement.transition_sto_atomic(sid,'DRAFT','CREATED',actor,NULL,csns);
  SELECT count(*) INTO c FROM erp_procurement.consignment_note WHERE sto_id=sid;
  IF c<>2 THEN RAISE EXCEPTION 'TEST_REPEATED_MATERIAL_CSN'; END IF;
  dline:=jsonb_build_object('line_number',1,'material_id',material,'sto_line_id',lid,'quantity',1000,'uom_code','KG',
    'storage_location_id',loc,'unit_value',72.2,'gst_rate',18,'gst_amount',12996,'line_total',85196,'source_type','STO','source_id',sid);
  dc:=erp_procurement.save_delivery_order_unified_atomic('CREATE',NULL,
    jsonb_build_object('dc_number','TEST-DO-'||sid,'dc_date',current_date,'dc_type','STO','selling_company_id',sender,'net_weight',1000),
    jsonb_build_array(jsonb_build_object('source_type','STO','source_id',sid)),jsonb_build_array(dline),actor);
  SET CONSTRAINTS ALL IMMEDIATE;
  IF (SELECT total_dispatch_qty FROM erp_procurement.consignment_note WHERE sto_line_id=lid)<>1000 OR
     (SELECT total_dispatch_qty FROM erp_procurement.consignment_note WHERE sto_line_id=lid2)<>0 THEN RAISE EXCEPTION 'TEST_PARTIAL_DISPATCH'; END IF;
  SET CONSTRAINTS ALL DEFERRED;
  PERFORM erp_procurement.save_delivery_order_unified_atomic('UPDATE',dc,
    jsonb_build_object('dc_type','STO','selling_company_id',sender,'net_weight',2000),
    jsonb_build_array(jsonb_build_object('source_type','STO','source_id',sid)),jsonb_build_array(dline||'{"quantity":2000}'::jsonb),actor);
  SET CONSTRAINTS ALL IMMEDIATE;
  IF (SELECT total_dispatch_qty FROM erp_procurement.consignment_note WHERE sto_line_id=lid)<>2000 THEN RAISE EXCEPTION 'TEST_EDIT_DOUBLE_COUNT'; END IF;
  failed:=false;
  BEGIN UPDATE erp_procurement.delivery_challan_line SET quantity=3001 WHERE dc_id=dc;
  EXCEPTION WHEN raise_exception THEN failed:=true; END;
  IF NOT failed THEN RAISE EXCEPTION 'TEST_OVER_DISPATCH'; END IF;
  SET CONSTRAINTS ALL DEFERRED;
  dc2:=erp_procurement.save_delivery_order_unified_atomic('CREATE',NULL,
    jsonb_build_object('dc_number','TEST-DO2-'||sid,'dc_date',current_date,'dc_type','STO','selling_company_id',sender,'net_weight',1000),
    jsonb_build_array(jsonb_build_object('source_type','STO','source_id',sid)),jsonb_build_array(dline),actor);
  SET CONSTRAINTS ALL IMMEDIATE;
  SELECT id INTO dcLine FROM erp_procurement.delivery_challan_line WHERE dc_id=dc;
  movement:=jsonb_build_object('posting_date',current_date,'movement_type_code','P601','company_id',sender,
    'storage_location_id',loc,'material_id',material,'quantity',2000,'base_uom_code','KG','unit_value',value_rate,
    'stock_type_code','UNRESTRICTED','direction','OUT','line_ref',dcLine);
  invContext:=jsonb_build_object('action','CREATE','dc_id',dc,'is_final_group',true,
    'invoice',jsonb_build_object('invoice_date',current_date,'company_id',sender,'sto_id',sid,'dc_id',dc,'gst_type','IGST',
      'tally_invoice_number','TEST-TALLY-'||inv,'tally_invoice_date',current_date,'total_taxable_value',144400,'total_gst_amount',25992,'total_igst_amount',25992,'total_invoice_value',170392,'created_by',actor,'posted_by',actor),
    'lines',jsonb_build_array(jsonb_build_object('line_number',1,'dc_line_id',dcLine,'material_id',material,'quantity',2000,
      'uom_code','KG','rate',72.2,'taxable_value',144400,'gst_rate',18,'igst_amount',25992,'line_total',170392)),
    'reservations',jsonb_build_array(jsonb_build_object('source_line_id',lid,'issued_qty',2000)));
  failed:=false;
  BEGIN
    PERFORM erp_inventory.post_sales_invoice_groups_atomic(jsonb_build_array(
      jsonb_build_object('invoice_id',inv,'movements',jsonb_build_array(movement),'context',invContext),
      jsonb_build_object('invoice_id',gen_random_uuid(),'movements',jsonb_build_array(movement||jsonb_build_object('quantity',before_qty+1)),'context',invContext)),actor);
  EXCEPTION WHEN OTHERS THEN failed:=true; END;
  IF NOT failed OR EXISTS(SELECT 1 FROM erp_procurement.sales_invoice WHERE id=inv) OR
    (SELECT quantity FROM erp_inventory.stock_snapshot WHERE company_id=sender AND material_id=material AND storage_location_id=loc AND stock_type_code='UNRESTRICTED' AND batch_id IS NULL)<>before_qty THEN RAISE EXCEPTION 'TEST_MULTI_GROUP_ROLLBACK'; END IF;
  PERFORM erp_inventory.post_sales_invoice_groups_atomic(jsonb_build_array(jsonb_build_object('invoice_id',inv,'movements',jsonb_build_array(movement),'context',invContext)),actor);
  IF (SELECT quantity FROM erp_inventory.stock_snapshot WHERE company_id=sender AND material_id=material AND storage_location_id=loc AND stock_type_code='UNRESTRICTED' AND batch_id IS NULL)<>before_qty-2000 THEN RAISE EXCEPTION 'TEST_SENDER_STOCK_OUT'; END IF;
  IF (SELECT status FROM erp_production.reservation_document WHERE dc_line_id=dcLine)<>'FULLY_ISSUED' OR
     EXISTS(SELECT 1 FROM erp_production.reservation_document r JOIN erp_procurement.delivery_challan_line dl ON dl.id=r.dc_line_id WHERE dl.dc_id=dc2 AND r.status<>'OPEN') THEN RAISE EXCEPTION 'TEST_SIBLING_RESERVATION_ISSUED'; END IF;
  IF (SELECT company_id FROM erp_procurement.sales_invoice WHERE id=inv)<>sender THEN RAISE EXCEPTION 'TEST_INVOICE_COMPANY'; END IF;
  SELECT jsonb_agg(jsonb_build_object('storage_location_id',source_location_id,'material_id',material_id,'quantity',quantity,
    'base_uom_code',base_uom_code,'unit_value',valuation_rate,'reversal_of_id',id,'line_ref',id)) INTO movement
    FROM erp_inventory.stock_document WHERE reference_document_id=inv AND reversal_document_id IS NULL;
  PERFORM erp_inventory.reverse_sales_invoice_groups_atomic(jsonb_build_array(jsonb_build_object('invoice_id',inv,
    'invoice_number',(SELECT invoice_number FROM erp_procurement.sales_invoice WHERE id=inv),'invoice_date',current_date,
    'company_id',sender,'dc_id',dc,'reason','Rollback test','movements',movement)),actor);
  IF (SELECT quantity FROM erp_inventory.stock_snapshot WHERE company_id=sender AND material_id=material AND storage_location_id=loc AND stock_type_code='UNRESTRICTED' AND batch_id IS NULL)<>before_qty THEN RAISE EXCEPTION 'TEST_REVERSAL_STOCK'; END IF;
  PERFORM erp_procurement.cancel_delivery_order_atomic(dc2,'Rollback test',actor);
  PERFORM erp_procurement.cancel_delivery_order_atomic(dc,'Rollback test',actor);
  IF (SELECT total_dispatch_qty FROM erp_procurement.consignment_note WHERE sto_line_id=lid)<>0 OR
     (SELECT status FROM erp_procurement.consignment_note WHERE sto_line_id=lid)<>'ORD' THEN RAISE EXCEPTION 'TEST_CANCEL_SYNC'; END IF;
  IF EXISTS(SELECT 1 FROM erp_production.reservation_document WHERE source_id=sid AND status IN ('OPEN','PARTIAL')) THEN RAISE EXCEPTION 'TEST_CANCEL_RESERVATION'; END IF;
  -- Distribution reuses the exact Sub-CSN and restores it on cancellation.
  SELECT id INTO po FROM erp_procurement.purchase_order LIMIT 1;
  INSERT INTO erp_procurement.consignment_note(csn_number,csn_type,delivery_type,status,company_id,vendor_id,material_id,po_id,po_qty,po_uom_code,payment_term_id,created_by,is_mother_csn)
  VALUES('TEST-MOTHER-'||sid,'IMPORT','STANDARD','TRN',sender,sender,material,po,3000,'KG',term,actor,true) RETURNING id INTO mother;
  INSERT INTO erp_procurement.consignment_note(csn_number,csn_type,delivery_type,status,company_id,vendor_id,material_id,po_id,po_qty,po_uom_code,payment_term_id,created_by,mother_csn_id,dispatch_qty,consignee_company_id)
  VALUES('TEST-SUB-'||sid,'IMPORT','STANDARD','TRN',sender,sender,material,po,3000,'KG',term,actor,mother,3000,receiver) RETURNING id INTO sub;
  dist:=erp_procurement.create_sto_atomic(h||jsonb_build_object('sto_number','TEST-DIST-'||sid,'sto_type','CONSIGNMENT_DISTRIBUTION','status','CREATED'),
    jsonb_build_array(line||jsonb_build_object('source_csn_id',sub)));
  IF (SELECT count(*) FROM erp_procurement.consignment_note WHERE sto_id=(dist->>'id')::uuid)<>1 OR
    NOT EXISTS(SELECT 1 FROM erp_procurement.consignment_note WHERE id=sub AND company_id=receiver AND vendor_id=sender AND mother_csn_id=mother AND csn_type='DOMESTIC' AND sto_line_id IS NOT NULL) THEN RAISE EXCEPTION 'TEST_DISTRIBUTION_LINK'; END IF;
  PERFORM erp_procurement.cancel_sto_atomic((dist->>'id')::uuid,'Rollback test',actor);
  IF NOT EXISTS(SELECT 1 FROM erp_procurement.consignment_note WHERE id=sub AND sto_id IS NULL AND sto_line_id IS NULL AND company_id=sender AND csn_type='IMPORT' AND status='TRN' AND dispatch_qty=3000) THEN RAISE EXCEPTION 'TEST_DISTRIBUTION_RESTORE'; END IF;
END $test$;
SELECT 'PASS: atomic create/confirm; repeated material; partial dispatch; edit; over-dispatch; invoice/PGI sender stock; sibling reservations; reversal; cancel; Distribution link/restore' AS result;
ROLLBACK;
