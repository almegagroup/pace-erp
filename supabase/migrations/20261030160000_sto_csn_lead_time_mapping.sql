-- Map the company-to-company lead time (20261030140000) into STO / FG STO CSNs.
--
-- Before: an STO CSN was created with transit_days_snapshot NULL (transition_sto_atomic
-- inserts an explicit column list that did not include it) and its ETA to plant was the
-- LR date itself (prod CSN 3000000128/131).
--
-- 1. transition_sto_atomic: the CSN created when an INTER_PLANT STO becomes CREATED now
--    stores transit_days_snapshot = the sending<->receiving lane days (NULL when the lane
--    has no row, exactly as before -- no block).
-- 2. save_delivery_order_unified_atomic: when a DO line dispatches an STO line, the linked
--    CSN gets transit_days_snapshot (if still empty) and eta_to_plant_calculated =
--    (DO LR date, else DO date) + transit days. Only while the CSN is ORD/TRN: once the gate
--    entry is done (GED) ETA stays the gate entry date, as in the CSN tracker rules.
DO $migration$
DECLARE
  v_def text;
  v_old_insert text := 'dispatch_qty, is_mother_csn) SELECT r.csn_number, r.csn_type, r.delivery_type, r.status, r.company_id, r.vendor_id, r.material_id, r.po_qty, r.po_uom_code, r.payment_term_id, r.lc_required, r.has_rebate, r.rebate_remarks, r.created_by, r.sto_id, r.sto_line_id, r.dispatch_qty, r.is_mother_csn FROM';
  v_new_insert text := 'dispatch_qty, is_mother_csn, transit_days_snapshot) SELECT r.csn_number, r.csn_type, r.delivery_type, r.status, r.company_id, r.vendor_id, r.material_id, r.po_qty, r.po_uom_code, r.payment_term_id, r.lc_required, r.has_rebate, r.rebate_remarks, r.created_by, r.sto_id, r.sto_line_id, r.dispatch_qty, r.is_mother_csn, coalesce(r.transit_days_snapshot, erp_master.resolve_company_transit_days(r.vendor_id, r.company_id, CURRENT_DATE)) FROM';
  v_old_set text := E'    SET status = CASE WHEN c.status = ''ORD'' THEN ''TRN'' ELSE c.status END,\n        dispatch_qty = dcl.quantity,';
  v_new_set text := E'    SET status = CASE WHEN c.status = ''ORD'' THEN ''TRN'' ELSE c.status END,\n        transit_days_snapshot = coalesce(c.transit_days_snapshot, erp_master.resolve_company_transit_days(c.vendor_id, c.company_id, CURRENT_DATE)),\n        eta_to_plant_calculated = CASE WHEN c.status IN (''ORD'', ''TRN'')\n          THEN (SELECT coalesce(d.lr_date, d.dc_date) FROM erp_procurement.delivery_challan d WHERE d.id = v_dc_id)\n               + coalesce(c.transit_days_snapshot, erp_master.resolve_company_transit_days(c.vendor_id, c.company_id, CURRENT_DATE), 0)\n          ELSE c.eta_to_plant_calculated END,\n        dispatch_qty = dcl.quantity,';
BEGIN
  SELECT pg_get_functiondef('erp_procurement.transition_sto_atomic(uuid,text,text,uuid,text,jsonb)'::regprocedure) INTO v_def;
  IF position('transit_days_snapshot' IN v_def) = 0 THEN
    IF position(v_old_insert IN v_def) = 0 THEN
      RAISE EXCEPTION 'transition_sto_atomic CSN insert clause not found; refusing an incomplete upgrade';
    END IF;
    EXECUTE replace(v_def, v_old_insert, v_new_insert);
  END IF;

  SELECT pg_get_functiondef('erp_procurement.save_delivery_order_unified_atomic(text,uuid,jsonb,jsonb,jsonb,uuid)'::regprocedure) INTO v_def;
  v_def := replace(v_def, E'\r\n', E'\n');
  IF position('resolve_company_transit_days' IN v_def) = 0 THEN
    IF position(v_old_set IN v_def) = 0 THEN
      RAISE EXCEPTION 'save_delivery_order_unified_atomic CSN update clause not found; refusing an incomplete upgrade';
    END IF;
    EXECUTE replace(v_def, v_old_set, v_new_set);
  END IF;
END;
$migration$;
