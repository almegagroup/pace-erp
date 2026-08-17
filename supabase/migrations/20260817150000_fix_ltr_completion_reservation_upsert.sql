-- Fix complete_location_transfer_action — reservation_document has no unique
-- constraint on source_line_id (by design: process_order intentionally keeps
-- a CANCELLED row and inserts a fresh one on material swap, same source_line_id).
-- The ON CONFLICT (source_line_id) clause therefore fails with 42P10 on every
-- IN11 POST/REVERSE call, since post_document has no exception handler and
-- rolls the whole transaction back. Replaced with select-then-insert/update,
-- matching the same fix already applied to the TypeScript IN10 create/update
-- path (location_transfer.handlers.ts syncReservationForLine).

BEGIN;

CREATE OR REPLACE FUNCTION erp_inventory.complete_location_transfer_action(
  p_request_id uuid,
  p_postings   jsonb,
  p_context    jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = erp_inventory, erp_production, public
AS $fn$
DECLARE
  v_action text := upper(coalesce(p_context->>'action', ''));
  v_posted_by uuid := NULLIF(p_context->>'posted_by', '')::uuid;
  v_now timestamptz := now();
  v_line jsonb;
  v_request erp_inventory.location_transfer_request%ROWTYPE;
  v_request_line erp_inventory.location_transfer_request_line%ROWTYPE;
  v_out_doc_id uuid;
  v_in_doc_id uuid;
  v_delta_qty numeric(20,6);
  v_next_posted_qty numeric(20,6);
  v_next_line_status text;
  v_next_reservation_status text;
  v_existing_reservation_id uuid;
BEGIN
  IF v_action NOT IN ('POST', 'REVERSE') THEN
    RAISE EXCEPTION 'LTR_COMPLETION_ACTION_INVALID: %', v_action;
  END IF;

  SELECT *
    INTO v_request
  FROM erp_inventory.location_transfer_request
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'LTR_COMPLETION_REQUEST_NOT_FOUND: %', p_request_id;
  END IF;

  FOR v_line IN
    SELECT value
    FROM jsonb_array_elements(COALESCE(p_context->'posting_lines', '[]'::jsonb))
  LOOP
    SELECT *
      INTO v_request_line
    FROM erp_inventory.location_transfer_request_line
    WHERE id = NULLIF(v_line->>'request_line_id', '')::uuid
      AND request_id = p_request_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'LTR_COMPLETION_LINE_NOT_FOUND: %', v_line->>'request_line_id';
    END IF;

    SELECT NULLIF(p->>'stock_document_id', '')::uuid
      INTO v_out_doc_id
    FROM jsonb_array_elements(p_postings) AS p
    WHERE p->>'line_ref' = COALESCE(v_line->>'out_line_ref', '')
    LIMIT 1;

    SELECT NULLIF(p->>'stock_document_id', '')::uuid
      INTO v_in_doc_id
    FROM jsonb_array_elements(p_postings) AS p
    WHERE p->>'line_ref' = COALESCE(v_line->>'in_line_ref', '')
    LIMIT 1;

    IF v_out_doc_id IS NULL OR v_in_doc_id IS NULL THEN
      RAISE EXCEPTION 'LTR_COMPLETION_POSTING_REF_MISSING: %', v_line->>'request_line_id';
    END IF;

    INSERT INTO erp_inventory.location_transfer_posting (
      request_id,
      request_line_id,
      movement_type_code,
      posted_qty,
      uom_code,
      batch_number,
      source_lot_ref,
      material_doc_number,
      material_doc_year,
      stock_document_id_out,
      stock_document_id_in,
      reversal_of_posting_id,
      remarks,
      posted_by,
      posted_at
    )
    VALUES (
      p_request_id,
      v_request_line.id,
      COALESCE(NULLIF(v_line->>'movement_type_code', ''), CASE WHEN v_action = 'POST' THEN 'P311' ELSE 'P312' END),
      COALESCE(NULLIF(v_line->>'posted_qty', '')::numeric, 0),
      COALESCE(NULLIF(v_line->>'uom_code', ''), v_request_line.uom_code),
      NULLIF(v_line->>'batch_number', ''),
      NULLIF(v_line->>'source_lot_ref', ''),
      COALESCE(NULLIF(v_line->>'material_doc_number', ''), ''),
      COALESCE(NULLIF(v_line->>'material_doc_year', ''), ''),
      v_out_doc_id,
      v_in_doc_id,
      NULLIF(v_line->>'reversal_of_posting_id', '')::uuid,
      NULLIF(v_line->>'remarks', ''),
      v_posted_by,
      v_now
    );

    v_delta_qty := COALESCE(NULLIF(v_line->>'posted_qty', '')::numeric, 0);
    IF v_action = 'POST' THEN
      v_next_posted_qty := round(v_request_line.posted_qty + v_delta_qty, 6);
    ELSE
      v_next_posted_qty := round(greatest(0, v_request_line.posted_qty - v_delta_qty), 6);
    END IF;

    v_next_line_status :=
      CASE
        WHEN v_next_posted_qty <= 0.000001 THEN 'OPEN'
        WHEN v_next_posted_qty >= v_request_line.requested_qty - 0.000001 THEN 'POSTED'
        ELSE 'PARTIALLY_POSTED'
      END;

    UPDATE erp_inventory.location_transfer_request_line
    SET posted_qty = v_next_posted_qty,
        status = v_next_line_status,
        last_updated_by = v_posted_by,
        last_updated_at = v_now
    WHERE id = v_request_line.id;

    v_next_reservation_status :=
      CASE
        WHEN v_next_posted_qty >= v_request_line.requested_qty - 0.000001 THEN 'FULLY_ISSUED'
        WHEN v_next_posted_qty > 0.000001 THEN 'PARTIAL'
        ELSE 'OPEN'
      END;

    -- source_line_id has no unique constraint (see header note) -- select the
    -- existing row for this line explicitly, then branch, instead of upsert.
    SELECT id INTO v_existing_reservation_id
    FROM erp_production.reservation_document
    WHERE source_type = 'LOCATION_TRANSFER'
      AND source_line_id = v_request_line.id
    FOR UPDATE;

    IF v_existing_reservation_id IS NOT NULL THEN
      UPDATE erp_production.reservation_document
      SET required_qty = v_request_line.requested_qty,
          uom_code = v_request_line.uom_code,
          issued_qty = v_next_posted_qty,
          status = v_next_reservation_status,
          batch_number = v_request_line.batch_number,
          source_lot_ref = v_request_line.source_lot_ref,
          last_updated_by = v_posted_by,
          last_updated_at = v_now
      WHERE id = v_existing_reservation_id;
    ELSE
      INSERT INTO erp_production.reservation_document (
        source_type,
        source_id,
        source_line_id,
        company_id,
        material_id,
        storage_location_id,
        required_qty,
        uom_code,
        required_by_date,
        issued_qty,
        status,
        batch_number,
        source_lot_ref,
        created_by,
        last_updated_by,
        last_updated_at
      )
      VALUES (
        'LOCATION_TRANSFER',
        p_request_id,
        v_request_line.id,
        v_request.company_id,
        v_request_line.material_id,
        v_request_line.source_storage_location_id,
        v_request_line.requested_qty,
        v_request_line.uom_code,
        NULL,
        v_next_posted_qty,
        v_next_reservation_status,
        v_request_line.batch_number,
        v_request_line.source_lot_ref,
        v_posted_by,
        v_posted_by,
        v_now
      );
    END IF;
  END LOOP;

  UPDATE erp_inventory.location_transfer_request req
  SET status = CASE
        WHEN EXISTS (
          SELECT 1
          FROM erp_inventory.location_transfer_request_line l
          WHERE l.request_id = p_request_id
            AND l.status = 'OPEN'
        ) AND EXISTS (
          SELECT 1
          FROM erp_inventory.location_transfer_request_line l
          WHERE l.request_id = p_request_id
            AND l.status = 'POSTED'
        ) THEN 'PARTIALLY_POSTED'
        WHEN EXISTS (
          SELECT 1
          FROM erp_inventory.location_transfer_request_line l
          WHERE l.request_id = p_request_id
            AND l.status = 'OPEN'
        ) THEN 'OPEN'
        WHEN EXISTS (
          SELECT 1
          FROM erp_inventory.location_transfer_request_line l
          WHERE l.request_id = p_request_id
            AND l.status = 'POSTED'
        ) THEN 'POSTED'
        ELSE 'CANCELLED'
      END,
      last_updated_by = v_posted_by,
      last_updated_at = v_now
  WHERE req.id = p_request_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'LTR_COMPLETION_HEADER_UPDATE_FAILED: %', p_request_id;
  END IF;
END;
$fn$;

COMMENT ON FUNCTION erp_inventory.complete_location_transfer_action(uuid, jsonb, jsonb) IS
  'post_document calls this in the same transaction for IN10/IN11. Writes location_transfer_posting, request line/header status+qty, and LOCATION_TRANSFER reservation rows atomically with the P311/P312 stock legs. Fixed 2026-08-17: select-then-insert/update instead of ON CONFLICT (source_line_id), which has no matching unique constraint.';

REVOKE ALL ON FUNCTION erp_inventory.complete_location_transfer_action(uuid, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_inventory.complete_location_transfer_action(uuid, jsonb, jsonb) TO service_role;

COMMIT;
