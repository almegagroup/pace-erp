-- STO / FG STO: DO (SO03) -> CSN transport data, so nobody types it into the CSN Tracker.
--
-- save_delivery_order_unified_atomic: when a DO line dispatches an STO line, the linked CSN also
-- gets the DO's transporter, LR number/date and vehicle (both the transporter_* and
-- domestic_transporter_* column pairs, exactly as the CSN Tracker fills them for DOMESTIC CSNs).
-- A later DO edit re-runs the same update, so the CSN follows the DO.
--
-- cancel_delivery_order_atomic: when the cancelled DO was the CSN's only dispatch (total_dispatch_qty
-- back to 0) and the CSN is still ORD/TRN, the CSN returns to ORD with dispatch_qty, LR, vehicle,
-- transporter and ETA cleared (before, only total_dispatch_qty was decremented and the CSN stayed TRN
-- with the cancelled DO's LR/vehicle).
DO $migration$
DECLARE
  v_def text;
  v_old_save_set text := E'        dispatch_qty = dcl.quantity,\n        total_dispatch_qty = coalesce(c.total_dispatch_qty, 0) + dcl.quantity,';
  v_new_save_set text := E'        transporter_id = dco.transporter_id,\n        transporter_name_freetext = dco.transporter_name_freetext,\n        domestic_transporter_id = dco.transporter_id,\n        domestic_transporter_freetext = dco.transporter_name_freetext,\n        lr_number = dco.lr_number,\n        lr_date = dco.lr_date,\n        vehicle_number = dco.vehicle_number,\n        dispatch_qty = dcl.quantity,\n        total_dispatch_qty = coalesce(c.total_dispatch_qty, 0) + dcl.quantity,';
  v_old_save_from text := E'    JOIN erp_procurement.stock_transfer_order_line sol ON sol.id = dcl.sto_line_id\n    WHERE dcl.dc_id = v_dc_id AND dcl.line_number = (v_line->>''line_number'')::int';
  v_new_save_from text := E'    JOIN erp_procurement.stock_transfer_order_line sol ON sol.id = dcl.sto_line_id\n    JOIN erp_procurement.delivery_challan dco ON dco.id = dcl.dc_id\n    WHERE dcl.dc_id = v_dc_id AND dcl.line_number = (v_line->>''line_number'')::int';
  v_old_cancel_end text := E'  WHERE c.sto_id = x.sto_id AND c.material_id = x.material_id AND c.status IN (''ORD'', ''TRN'', ''GED'');\nEND;';
  v_new_cancel_end text := E'  WHERE c.sto_id = x.sto_id AND c.material_id = x.material_id AND c.status IN (''ORD'', ''TRN'', ''GED'');\n\n  -- Nothing left dispatched on the CSN: hand it back as an undispatched ORD CSN.\n  UPDATE erp_procurement.consignment_note c\n  SET status = CASE WHEN c.status = ''TRN'' THEN ''ORD'' ELSE c.status END,\n      dispatch_qty = 0,\n      transporter_id = NULL, transporter_name_freetext = NULL,\n      domestic_transporter_id = NULL, domestic_transporter_freetext = NULL,\n      lr_number = NULL, lr_date = NULL, vehicle_number = NULL,\n      eta_to_plant_calculated = NULL,\n      last_updated_by = p_actor, last_updated_at = v_now\n  FROM (\n    SELECT DISTINCT sol.sto_id, dcl.material_id\n    FROM erp_procurement.delivery_challan_line dcl\n    JOIN erp_procurement.stock_transfer_order_line sol ON sol.id = dcl.sto_line_id\n    WHERE dcl.dc_id = p_dc_id AND dcl.sto_line_id IS NOT NULL\n  ) x\n  WHERE c.sto_id = x.sto_id AND c.material_id = x.material_id\n    AND c.status IN (''ORD'', ''TRN'') AND coalesce(c.total_dispatch_qty, 0) = 0;\nEND;';
BEGIN
  SELECT pg_get_functiondef('erp_procurement.save_delivery_order_unified_atomic(text,uuid,jsonb,jsonb,jsonb,uuid)'::regprocedure) INTO v_def;
  v_def := replace(v_def, E'\r\n', E'\n');
  IF position('domestic_transporter_id = dco.transporter_id' IN v_def) = 0 THEN
    IF position(v_old_save_set IN v_def) = 0 OR position(v_old_save_from IN v_def) = 0 THEN
      RAISE EXCEPTION 'save_delivery_order_unified_atomic CSN update clauses not found; refusing an incomplete upgrade';
    END IF;
    v_def := replace(replace(v_def, v_old_save_set, v_new_save_set), v_old_save_from, v_new_save_from);
    EXECUTE v_def;
  END IF;

  SELECT pg_get_functiondef('erp_procurement.cancel_delivery_order_atomic(uuid,text,uuid)'::regprocedure) INTO v_def;
  v_def := replace(v_def, E'\r\n', E'\n');
  IF position('hand it back as an undispatched ORD CSN' IN v_def) = 0 THEN
    IF position(v_old_cancel_end IN v_def) = 0 THEN
      RAISE EXCEPTION 'cancel_delivery_order_atomic CSN clause not found; refusing an incomplete upgrade';
    END IF;
    EXECUTE replace(v_def, v_old_cancel_end, v_new_cancel_end);
  END IF;
END;
$migration$;
