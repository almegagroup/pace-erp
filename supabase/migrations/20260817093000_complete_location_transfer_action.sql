-- complete_location_transfer_action — IN10/IN11 location transfer posting/reversal
-- business writes inside the SAME transaction as post_document's stock legs.
--
-- Why: P311/P312 used to do OUT leg, then IN leg, then posting-row insert, then
-- request-line/header/reservation updates from TypeScript. If the server died in
-- the middle, stock could be half-posted while the request still looked OPEN.
-- This moves the whole write chain behind one transactional gate.

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
    )
    ON CONFLICT (source_line_id)
    DO UPDATE SET
      required_qty = EXCLUDED.required_qty,
      uom_code = EXCLUDED.uom_code,
      issued_qty = EXCLUDED.issued_qty,
      status = EXCLUDED.status,
      batch_number = EXCLUDED.batch_number,
      source_lot_ref = EXCLUDED.source_lot_ref,
      last_updated_by = EXCLUDED.last_updated_by,
      last_updated_at = EXCLUDED.last_updated_at;
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
  'post_document calls this in the same transaction for IN10/IN11. Writes location_transfer_posting, request line/header status+qty, and LOCATION_TRANSFER reservation rows atomically with the P311/P312 stock legs.';

REVOKE ALL ON FUNCTION erp_inventory.complete_location_transfer_action(uuid, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_inventory.complete_location_transfer_action(uuid, jsonb, jsonb) TO service_role;

INSERT INTO erp_inventory.posting_source_registry
  (reference_document_type, label, source_schema, source_table, status_column, suspect_statuses,
   is_active, notes, completion_schema, completion_function)
VALUES
  ('LTR', 'Location Transfer Request', 'erp_inventory', 'location_transfer_request', 'status',
   ARRAY['OPEN', 'PARTIALLY_POSTED'], true,
   'IN10/IN11 P311/P312 now post atomically through post_document; OPEN/PARTIALLY_POSTED are suspect if tagged stock exists.',
   'erp_inventory', 'complete_location_transfer_action')
ON CONFLICT (reference_document_type) DO UPDATE
SET completion_schema = EXCLUDED.completion_schema,
    completion_function = EXCLUDED.completion_function,
    suspect_statuses = EXCLUDED.suspect_statuses,
    notes = EXCLUDED.notes,
    is_active = EXCLUDED.is_active;

COMMIT;
