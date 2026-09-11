-- §133.10 gap found 2026-09-11 (Codex root-cause audit +
-- outputs/legacy-sto-root-cause-audit-2026-09-11.md, "Downstream findings" #2):
-- the pre-atomic delivery_order.handlers.ts used to call upsertCsnDispatch()/
-- undoCsnDispatchForLines() after DO create/edit/cancel to keep an STO-sourced
-- line's linked consignment_note in sync (status ORD->TRN, dispatch_qty,
-- total_dispatch_qty). When DO creation moved to the atomic
-- save_delivery_order_unified_atomic()/cancel_delivery_order_atomic() RPCs
-- (2026-08-30 onward), those two TS-only helpers were deleted along with the
-- old createDeliveryOrderHandler and never ported into the new functions --
-- a real business document (CSN Tracker) silently stopped updating on
-- dispatch. Folding the same logic into these two functions (rather than
-- restoring it as a separate TS round-trip) keeps it inside the same
-- transaction as the stock/reservation writes, per §8D.
--
-- Semantics preserved exactly from the deleted TS helpers: lookup key is
-- (sto_id, material_id) against any consignment_note in status
-- ORD/TRN/GED (not every STO line is CSN-linked -- no match is a no-op);
-- create/edit-rebuild sets status ORD->TRN, dispatch_qty=this line's qty,
-- total_dispatch_qty += qty; edit-teardown/cancel only decrements
-- total_dispatch_qty (floored at 0), never touches status or dispatch_qty.

CREATE OR REPLACE FUNCTION erp_procurement.save_delivery_order_unified_atomic(p_action text, p_dc_id uuid, p_header jsonb, p_sources jsonb, p_lines jsonb, p_actor uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'erp_procurement', 'erp_production', 'public'
AS $function$
DECLARE
  v_dc_id uuid := p_dc_id;
  v_line jsonb;
BEGIN
  IF upper(p_action) = 'CREATE' THEN
    INSERT INTO erp_procurement.delivery_challan (
      dc_number, dc_date, dc_type, selling_company_id, vehicle_number,
      transporter_id, transporter_name_freetext, lr_number, lr_date,
      gross_weight, net_weight, driver_number, driver_contact_number, status, remarks
    ) VALUES (
      p_header->>'dc_number', (p_header->>'dc_date')::date, p_header->>'dc_type',
      (p_header->>'selling_company_id')::uuid, nullif(p_header->>'vehicle_number', '')::text,
      nullif(p_header->>'transporter_id', '')::uuid, nullif(p_header->>'transporter_name_freetext', ''),
      nullif(p_header->>'lr_number', ''), nullif(p_header->>'lr_date', '')::date,
      nullif(p_header->>'gross_weight', '')::numeric, (p_header->>'net_weight')::numeric,
      nullif(p_header->>'driver_number', ''), nullif(p_header->>'driver_contact_number', ''),
      'CREATED', nullif(p_header->>'remarks', '')
    ) RETURNING id INTO v_dc_id;
  ELSIF upper(p_action) = 'UPDATE' THEN
    IF v_dc_id IS NULL THEN RAISE EXCEPTION 'DO_ID_REQUIRED'; END IF;

    UPDATE erp_production.reservation_document
    SET status = 'CANCELLED', dc_line_id = NULL, last_updated_by = p_actor, last_updated_at = now()
    WHERE dc_line_id IN (SELECT id FROM erp_procurement.delivery_challan_line WHERE dc_id = v_dc_id);

    -- Undo CSN dispatch totals for the old STO-sourced lines being torn
    -- down, before they're deleted below -- mirrors the deleted
    -- undoCsnDispatchForLines() TS helper, now in the same transaction.
    UPDATE erp_procurement.consignment_note c
    SET total_dispatch_qty = GREATEST(0, coalesce(c.total_dispatch_qty, 0) - x.qty),
        last_updated_by = p_actor, last_updated_at = now()
    FROM (
      SELECT sol.sto_id, dcl.material_id, sum(dcl.quantity) AS qty
      FROM erp_procurement.delivery_challan_line dcl
      JOIN erp_procurement.stock_transfer_order_line sol ON sol.id = dcl.sto_line_id
      WHERE dcl.dc_id = v_dc_id AND dcl.sto_line_id IS NOT NULL
      GROUP BY sol.sto_id, dcl.material_id
    ) x
    WHERE c.sto_id = x.sto_id AND c.material_id = x.material_id AND c.status IN ('ORD', 'TRN', 'GED');

    DELETE FROM erp_procurement.delivery_challan_line WHERE dc_id = v_dc_id;
    DELETE FROM erp_procurement.delivery_challan_source WHERE dc_id = v_dc_id;

    UPDATE erp_procurement.delivery_challan SET
      dc_type = p_header->>'dc_type', vehicle_number = nullif(p_header->>'vehicle_number', ''),
      transporter_id = nullif(p_header->>'transporter_id', '')::uuid,
      transporter_name_freetext = nullif(p_header->>'transporter_name_freetext', ''),
      lr_number = nullif(p_header->>'lr_number', ''), lr_date = nullif(p_header->>'lr_date', '')::date,
      gross_weight = nullif(p_header->>'gross_weight', '')::numeric,
      net_weight = (p_header->>'net_weight')::numeric,
      driver_number = nullif(p_header->>'driver_number', ''),
      driver_contact_number = nullif(p_header->>'driver_contact_number', ''),
      remarks = nullif(p_header->>'remarks', '')
    WHERE id = v_dc_id AND status = 'CREATED';
    IF NOT FOUND THEN RAISE EXCEPTION 'DO_EDIT_BLOCKED'; END IF;
  ELSE
    RAISE EXCEPTION 'DO_ACTION_INVALID';
  END IF;

  INSERT INTO erp_procurement.delivery_challan_source (dc_id, source_type, source_id)
  SELECT v_dc_id, source_type, source_id
  FROM jsonb_to_recordset(coalesce(p_sources, '[]'::jsonb)) AS s(source_type text, source_id uuid);

  FOR v_line IN SELECT value FROM jsonb_array_elements(coalesce(p_lines, '[]'::jsonb))
  LOOP
    INSERT INTO erp_procurement.delivery_challan_line (
      dc_id, line_number, material_id, so_line_id, sto_line_id, so_map_allocation_id,
      quantity, uom_code, storage_location_id, batch_number, expiry_date, packing_order_id,
      unit_value, gst_rate, gst_amount, line_total, ship_to_customer_id, ship_to_name,
      ship_to_address, ship_to_state, ship_to_gst_number,
      display_rate_basis, display_rate, display_uom_code, pack_qty, pack_uom_code,
      urgent_dispatch_decision
    ) VALUES (
      v_dc_id, (v_line->>'line_number')::int, (v_line->>'material_id')::uuid,
      nullif(v_line->>'so_line_id', '')::uuid, nullif(v_line->>'sto_line_id', '')::uuid,
      nullif(v_line->>'so_map_allocation_id', '')::uuid, (v_line->>'quantity')::numeric,
      v_line->>'uom_code', (v_line->>'storage_location_id')::uuid, nullif(v_line->>'batch_number', ''),
      nullif(v_line->>'expiry_date', '')::date, nullif(v_line->>'packing_order_id', '')::uuid,
      (v_line->>'unit_value')::numeric, (v_line->>'gst_rate')::numeric, (v_line->>'gst_amount')::numeric,
      (v_line->>'line_total')::numeric, nullif(v_line->>'ship_to_customer_id', '')::uuid,
      nullif(v_line->>'ship_to_name', ''), nullif(v_line->>'ship_to_address', ''),
      nullif(v_line->>'ship_to_state', ''), nullif(v_line->>'ship_to_gst_number', ''),
      nullif(v_line->>'display_rate_basis', ''), nullif(v_line->>'display_rate', '')::numeric,
      nullif(v_line->>'display_uom_code', ''), nullif(v_line->>'pack_qty', '')::numeric,
      nullif(v_line->>'pack_uom_code', ''),
      nullif(v_line->>'urgent_dispatch_decision', '')
    );

    -- §136 follow-up -- reservation now carries the same batch_number/
    -- packing_order_id the line itself just got (NULL for RM/PM/INT and for
    -- any FG line that genuinely has neither), read straight off the just-
    -- inserted line rather than re-parsing v_line twice.
    INSERT INTO erp_production.reservation_document (
      dc_line_id, source_type, source_id, source_line_id, company_id, material_id,
      storage_location_id, batch_number, packing_order_id, required_qty, uom_code, issued_qty, status,
      created_by, created_at, last_updated_by, last_updated_at
    ) SELECT dcl.id, v_line->>'source_type', (v_line->>'source_id')::uuid,
      coalesce(nullif(v_line->>'so_line_id', '')::uuid, nullif(v_line->>'sto_line_id', '')::uuid),
      (p_header->>'selling_company_id')::uuid, dcl.material_id,
      dcl.storage_location_id, dcl.batch_number, dcl.packing_order_id, dcl.quantity,
      dcl.uom_code, 0, 'OPEN', p_actor, now(), p_actor, now()
    FROM erp_procurement.delivery_challan_line dcl
    WHERE dcl.dc_id = v_dc_id AND dcl.line_number = (v_line->>'line_number')::int;

    -- STO-sourced line: sync the linked CSN's dispatch status/qty in the
    -- same transaction. SO-sourced lines have no sto_line_id/consignment_note
    -- match, so this is a no-op for them.
    UPDATE erp_procurement.consignment_note c
    SET status = CASE WHEN c.status = 'ORD' THEN 'TRN' ELSE c.status END,
        dispatch_qty = dcl.quantity,
        total_dispatch_qty = coalesce(c.total_dispatch_qty, 0) + dcl.quantity,
        last_updated_by = p_actor, last_updated_at = now()
    FROM erp_procurement.delivery_challan_line dcl
    JOIN erp_procurement.stock_transfer_order_line sol ON sol.id = dcl.sto_line_id
    WHERE dcl.dc_id = v_dc_id AND dcl.line_number = (v_line->>'line_number')::int
      AND dcl.sto_line_id IS NOT NULL
      AND c.sto_id = sol.sto_id AND c.material_id = dcl.material_id
      AND c.status IN ('ORD', 'TRN', 'GED');
  END LOOP;

  RETURN v_dc_id;
END;
$function$;

CREATE OR REPLACE FUNCTION erp_procurement.cancel_delivery_order_atomic(
  p_dc_id uuid,
  p_reason text,
  p_actor uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = erp_procurement, erp_production, public
AS $fn$
DECLARE
  v_now timestamptz := now();
BEGIN
  UPDATE erp_procurement.delivery_challan
  SET status = 'CANCELLED', cancellation_reason = p_reason, cancelled_by = p_actor, cancelled_at = v_now
  WHERE id = p_dc_id AND status = 'CREATED';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DO_CANCEL_BLOCKED';
  END IF;

  -- §133.12 -- release by dc_line_id (THIS DC's own lines) first; a
  -- multi-source DO's sibling DOs against the same source line keep their
  -- own separate OPEN reservations untouched.
  UPDATE erp_production.reservation_document
  SET status = 'CANCELLED', last_updated_by = p_actor, last_updated_at = v_now
  WHERE dc_line_id IN (SELECT id FROM erp_procurement.delivery_challan_line WHERE dc_id = p_dc_id)
    AND status IN ('OPEN', 'PARTIAL');

  -- Legacy fallback for pre-§133.12 rows with no dc_line_id of their own.
  UPDATE erp_production.reservation_document rd
  SET status = 'CANCELLED', last_updated_by = p_actor, last_updated_at = v_now
  FROM erp_procurement.delivery_challan_line dcl
  WHERE dcl.dc_id = p_dc_id
    AND rd.dc_line_id IS NULL
    AND rd.source_line_id = COALESCE(dcl.so_line_id, dcl.sto_line_id)
    AND rd.status IN ('OPEN', 'PARTIAL');

  -- Undo CSN dispatch totals for any STO-sourced line this DO carried --
  -- lines are never deleted on cancel (kept for audit), so read them
  -- directly. Mirrors the deleted undoCsnDispatchForLines() TS helper.
  UPDATE erp_procurement.consignment_note c
  SET total_dispatch_qty = GREATEST(0, coalesce(c.total_dispatch_qty, 0) - x.qty),
      last_updated_by = p_actor, last_updated_at = v_now
  FROM (
    SELECT sol.sto_id, dcl.material_id, sum(dcl.quantity) AS qty
    FROM erp_procurement.delivery_challan_line dcl
    JOIN erp_procurement.stock_transfer_order_line sol ON sol.id = dcl.sto_line_id
    WHERE dcl.dc_id = p_dc_id AND dcl.sto_line_id IS NOT NULL
    GROUP BY sol.sto_id, dcl.material_id
  ) x
  WHERE c.sto_id = x.sto_id AND c.material_id = x.material_id AND c.status IN ('ORD', 'TRN', 'GED');
END;
$fn$;

REVOKE ALL ON FUNCTION erp_procurement.save_delivery_order_unified_atomic(text, uuid, jsonb, jsonb, jsonb, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_procurement.save_delivery_order_unified_atomic(text, uuid, jsonb, jsonb, jsonb, uuid) TO service_role;
REVOKE ALL ON FUNCTION erp_procurement.cancel_delivery_order_atomic(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_procurement.cancel_delivery_order_atomic(uuid, text, uuid) TO service_role;
