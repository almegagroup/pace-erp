-- §6 point 21 — VDC Invoice-only cancellation. This deliberately does not
-- alter the shared cancel_delivery_order_atomic() or SALES_INVOICE reversal
-- chain used by the live DC/RM/PM/INT flows.
--
-- A VDC row can have a reservation (when Truck + Dispatch Date were both
-- supplied at Bulk-DO create time) even though its invoice is still DRAFT.
-- Therefore invoice cancellation, DO cancellation and release must be one
-- transaction; otherwise an interrupted request can strand reserved stock.
CREATE OR REPLACE FUNCTION erp_procurement.cancel_vdc_invoice_only_atomic(
  p_dc_id uuid,
  p_reason text,
  p_actor uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = erp_procurement, erp_production, public
AS $function$
DECLARE
  v_now timestamptz := now();
  v_dc erp_procurement.delivery_challan%ROWTYPE;
BEGIN
  IF NULLIF(trim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'VDC_CANCEL_REASON_REQUIRED';
  END IF;

  SELECT * INTO v_dc
  FROM erp_procurement.delivery_challan
  WHERE id = p_dc_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DO_NOT_FOUND'; END IF;
  IF v_dc.pgi_deferred IS DISTINCT FROM true
    OR v_dc.is_bulk_uploaded IS DISTINCT FROM true
    OR v_dc.status <> 'INVOICED' THEN
    RAISE EXCEPTION 'VDC_CANCEL_BLOCKED';
  END IF;

  -- Invoice-only state must contain draft invoices only. A posted VDC invoice
  -- has a physical P601 and must go through the existing reversal posting.
  IF EXISTS (
    SELECT 1 FROM erp_procurement.sales_invoice
    WHERE dc_id = p_dc_id AND status = 'POSTED'
  ) THEN RAISE EXCEPTION 'VDC_CANCEL_POSTED_PGI_REQUIRES_REVERSAL'; END IF;

  UPDATE erp_procurement.sales_invoice
  SET status = 'CANCELLED',
      cancelled_by = p_actor,
      cancelled_at = v_now,
      cancellation_reason = p_reason,
      last_updated_at = v_now
  WHERE dc_id = p_dc_id AND status = 'DRAFT';
  IF NOT FOUND THEN RAISE EXCEPTION 'VDC_CANCEL_DRAFT_INVOICE_NOT_FOUND'; END IF;

  UPDATE erp_procurement.delivery_challan
  SET status = 'CANCELLED',
      cancellation_reason = p_reason,
      cancelled_by = p_actor,
      cancelled_at = v_now
  WHERE id = p_dc_id AND status = 'INVOICED';
  IF NOT FOUND THEN RAISE EXCEPTION 'VDC_CANCEL_BLOCKED'; END IF;

  -- Same dc_line-first release invariant as cancel_delivery_order_atomic().
  UPDATE erp_production.reservation_document
  SET status = 'CANCELLED', last_updated_by = p_actor, last_updated_at = v_now
  WHERE dc_line_id IN (SELECT id FROM erp_procurement.delivery_challan_line WHERE dc_id = p_dc_id)
    AND status IN ('OPEN', 'PARTIAL');

  UPDATE erp_production.reservation_document rd
  SET status = 'CANCELLED', last_updated_by = p_actor, last_updated_at = v_now
  FROM erp_procurement.delivery_challan_line dcl
  WHERE dcl.dc_id = p_dc_id
    AND rd.dc_line_id IS NULL
    AND rd.source_line_id = COALESCE(dcl.so_line_id, dcl.sto_line_id)
    AND rd.status IN ('OPEN', 'PARTIAL');
END;
$function$;

REVOKE ALL ON FUNCTION erp_procurement.cancel_vdc_invoice_only_atomic(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_procurement.cancel_vdc_invoice_only_atomic(uuid, text, uuid) TO service_role;

-- Partial multi-group PGI is possible: some invoice groups may already be
-- POSTED while another is still DRAFT. Cancel the commercial-only groups
-- first; their posted siblings are then reversed through post_document().
CREATE OR REPLACE FUNCTION erp_procurement.cancel_vdc_draft_invoices_for_cascade(
  p_dc_id uuid,
  p_reason text,
  p_actor uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = erp_procurement, public
AS $function$
BEGIN
  IF NULLIF(trim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'VDC_CANCEL_REASON_REQUIRED'; END IF;
  PERFORM 1 FROM erp_procurement.delivery_challan
  WHERE id = p_dc_id AND pgi_deferred = true AND is_bulk_uploaded = true
    AND status IN ('INVOICED', 'DISPATCHED')
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'VDC_CANCEL_BLOCKED'; END IF;
  UPDATE erp_procurement.sales_invoice
  SET status = 'CANCELLED', cancelled_by = p_actor, cancelled_at = now(),
      cancellation_reason = p_reason, last_updated_at = now()
  WHERE dc_id = p_dc_id AND status = 'DRAFT';
  IF NOT FOUND THEN RAISE EXCEPTION 'VDC_CANCEL_DRAFT_INVOICE_NOT_FOUND'; END IF;
END;
$function$;

REVOKE ALL ON FUNCTION erp_procurement.cancel_vdc_draft_invoices_for_cascade(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_procurement.cancel_vdc_draft_invoices_for_cascade(uuid, text, uuid) TO service_role;

-- Extend only VDC's own completion dispatcher. CREATE/REVERSE for the shared
-- SALES_INVOICE source remains byte-for-byte outside this migration.
CREATE OR REPLACE FUNCTION erp_procurement.complete_vdc_pgi_only_action(
  p_reference_document_id uuid,
  p_postings jsonb,
  p_context jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'erp_procurement', 'erp_production', 'public'
AS $function$
DECLARE
  v_action text := p_context->>'action';
  v_dc_id uuid := NULLIF(p_context->>'dc_id', '')::uuid;
  v_actor uuid := NULLIF(p_context->'cancel'->>'cancelled_by', '')::uuid;
  v_reason text := NULLIF(p_context->'cancel'->>'cancellation_reason', '');
BEGIN
  IF v_dc_id IS NULL THEN RAISE EXCEPTION 'VDC_PGI_ONLY_CONTEXT_INVALID'; END IF;

  IF v_action = 'PGI_ONLY' THEN
    UPDATE erp_procurement.sales_invoice
    SET status = 'POSTED', posted_by = NULLIF(p_context->'invoice'->>'posted_by', '')::uuid,
        posted_at = now(), last_updated_at = now()
    WHERE id = p_reference_document_id AND dc_id = v_dc_id AND status = 'DRAFT';
    IF NOT FOUND THEN RAISE EXCEPTION 'VDC_PGI_ONLY_INVOICE_NOT_DRAFT'; END IF;

    UPDATE erp_production.reservation_document rd
    SET issued_qty = sil.quantity, status = 'FULLY_ISSUED', last_updated_at = now(),
        last_updated_by = NULLIF(p_context->'invoice'->>'posted_by', '')::uuid
    FROM erp_procurement.sales_invoice_line sil
    WHERE sil.invoice_id = p_reference_document_id AND rd.dc_line_id = sil.dc_line_id
      AND rd.status IN ('OPEN', 'PARTIAL', 'FULLY_ISSUED');

    INSERT INTO erp_production.reservation_document (
      dc_line_id, source_type, source_id, source_line_id, company_id, material_id,
      storage_location_id, batch_number, packing_order_id, required_qty, uom_code,
      issued_qty, status, created_by, created_at, last_updated_by, last_updated_at
    )
    SELECT dcl.id, 'SALES_ORDER', si.so_id, dcl.so_line_id, si.company_id,
      dcl.material_id, dcl.storage_location_id, dcl.batch_number, dcl.packing_order_id,
      sil.quantity, sil.uom_code, sil.quantity, 'FULLY_ISSUED',
      NULLIF(p_context->'invoice'->>'posted_by', '')::uuid, now(),
      NULLIF(p_context->'invoice'->>'posted_by', '')::uuid, now()
    FROM erp_procurement.sales_invoice si
    JOIN erp_procurement.sales_invoice_line sil ON sil.invoice_id = si.id
    JOIN erp_procurement.delivery_challan_line dcl ON dcl.id = sil.dc_line_id
    WHERE si.id = p_reference_document_id
      AND NOT EXISTS (SELECT 1 FROM erp_production.reservation_document rd WHERE rd.dc_line_id = dcl.id);

    IF EXISTS (
      SELECT 1 FROM erp_procurement.sales_invoice_line sil
      LEFT JOIN erp_production.reservation_document rd ON rd.dc_line_id = sil.dc_line_id
      WHERE sil.invoice_id = p_reference_document_id AND rd.id IS NULL
    ) THEN RAISE EXCEPTION 'VDC_PGI_ONLY_RESERVATION_WRITE_FAILED'; END IF;

    IF NOT EXISTS (SELECT 1 FROM erp_procurement.sales_invoice WHERE dc_id = v_dc_id AND status = 'DRAFT') THEN
      UPDATE erp_procurement.delivery_challan SET status = 'DISPATCHED'
      WHERE id = v_dc_id AND status = 'INVOICED';
      IF NOT FOUND THEN RAISE EXCEPTION 'VDC_PGI_ONLY_DO_NOT_INVOICED'; END IF;
    END IF;

  ELSIF v_action = 'REVERSE' THEN
    IF v_actor IS NULL OR v_reason IS NULL THEN RAISE EXCEPTION 'VDC_PGI_REVERSE_CONTEXT_INVALID'; END IF;
    UPDATE erp_procurement.sales_invoice
    SET status = 'CANCELLED', cancelled_by = v_actor, cancelled_at = now(),
        cancellation_reason = v_reason, last_updated_at = now()
    WHERE id = p_reference_document_id AND dc_id = v_dc_id AND status = 'POSTED';
    IF NOT FOUND THEN RAISE EXCEPTION 'VDC_PGI_REVERSE_NOT_POSTED'; END IF;

    UPDATE erp_production.reservation_document
    SET status = 'CANCELLED', last_updated_by = v_actor, last_updated_at = now()
    WHERE dc_line_id IN (
      SELECT dc_line_id FROM erp_procurement.sales_invoice_line WHERE invoice_id = p_reference_document_id
    ) AND status IN ('OPEN', 'PARTIAL', 'FULLY_ISSUED');

    -- This endpoint is an explicit cancel cascade, not a generic "reopen".
    -- On the final reversed invoice it makes the DO re-upload-ready as well.
    IF NOT EXISTS (
      SELECT 1 FROM erp_procurement.sales_invoice
      WHERE dc_id = v_dc_id AND status IN ('DRAFT', 'POSTED')
    ) THEN
      UPDATE erp_procurement.delivery_challan
      SET status = 'CANCELLED', cancellation_reason = v_reason,
          cancelled_by = v_actor, cancelled_at = now()
      WHERE id = v_dc_id AND status IN ('INVOICED', 'DISPATCHED');
      IF NOT FOUND THEN RAISE EXCEPTION 'VDC_PGI_REVERSE_DO_STATE_INVALID'; END IF;
    END IF;
  ELSE
    RAISE EXCEPTION 'VDC_PGI_ONLY_CONTEXT_INVALID';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION erp_procurement.complete_vdc_pgi_only_action(uuid, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_procurement.complete_vdc_pgi_only_action(uuid, jsonb, jsonb) TO service_role;
