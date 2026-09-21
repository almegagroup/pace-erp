CREATE OR REPLACE FUNCTION erp_production.complete_process_po_verify(
  p_process_order_id uuid,
  p_postings         jsonb,
  p_context          jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = erp_production, erp_inventory, erp_procurement, public
AS $$
DECLARE
  v_fg_ledger uuid;
  v_qi_ledger uuid;
  v_header jsonb := COALESCE(p_context->'header', '{}'::jsonb);
  v_mts jsonb := COALESCE(p_context->'mts_verify', '{}'::jsonb);
  v_is_mts boolean := p_context ? 'mts_verify';
  v_actor_id uuid := NULLIF(v_header->>'last_updated_by', '')::uuid;
  v_item jsonb;
  v_out_document_id uuid;
  v_in_document_id uuid;
  v_ssc_number text;
BEGIN
  -- These three writes are shared by normal Process PO Verify and MTS Verify.
  UPDATE erp_production.reservation_document rd
  SET issued_qty = (r->>'issued_qty')::numeric,
      status = r->>'status', last_updated_at = now(), last_updated_by = v_actor_id
  FROM jsonb_array_elements(COALESCE(p_context->'reservations','[]'::jsonb)) AS r
  WHERE rd.id = (r->>'reservation_id')::uuid;

  IF jsonb_array_length(COALESCE(p_context->'machine_stock_log_rows','[]'::jsonb)) > 0 THEN
    INSERT INTO erp_production.machine_stock_log (
      company_id, storage_location_id, material_id, machine_id, batch_number, qty,
      direction, source_type, reference_document_type, reference_document_id, created_by
    )
    SELECT (row_json->>'company_id')::uuid, (row_json->>'storage_location_id')::uuid,
      (row_json->>'material_id')::uuid, NULLIF(row_json->>'machine_id','')::uuid,
      NULLIF(row_json->>'batch_number',''), (row_json->>'qty')::numeric,
      row_json->>'direction', row_json->>'source_type', row_json->>'reference_document_type',
      (row_json->>'reference_document_id')::uuid, NULLIF(row_json->>'created_by','')::uuid
    FROM jsonb_array_elements(p_context->'machine_stock_log_rows') AS row_json;
  END IF;

  IF jsonb_array_length(COALESCE(p_context->'reco_rows','[]'::jsonb)) > 0 THEN
    INSERT INTO erp_production.process_order_line_reco
    SELECT (jsonb_populate_record(NULL::erp_production.process_order_line_reco,
      jsonb_build_object('id', gen_random_uuid(), 'line_material_type', 'RM',
        'is_formulation_line', true, 'is_voided', false, 'source_txn_type', 'PRODUCTION',
        'reco_document_year', '', 'last_updated_at', now()) || row_json)).*
    FROM jsonb_array_elements(p_context->'reco_rows') AS row_json;
  END IF;

  IF v_is_mts THEN
    -- MTS line refs are deliberately prefixed, so normal Verify can still use
    -- raw Process-line UUID refs without a casting accident.
    UPDATE erp_production.process_order_line pol
    SET stock_ledger_id = (
      SELECT (p->>'stock_ledger_id')::uuid FROM jsonb_array_elements(p_postings) p
      WHERE p->>'line_ref' = u->>'line_ref'
    )
    FROM jsonb_array_elements(COALESCE(v_mts->'process_line_postings','[]'::jsonb)) u
    WHERE pol.id = (u->>'process_order_line_id')::uuid;

    UPDATE erp_production.packing_order_line pol
    SET actual_qty = (u->>'actual_qty')::numeric,
        stock_ledger_id = CASE WHEN NULLIF(u->>'line_ref','') IS NULL THEN NULL ELSE (
          SELECT (p->>'stock_ledger_id')::uuid FROM jsonb_array_elements(p_postings) p
          WHERE p->>'line_ref' = u->>'line_ref'
        ) END
    FROM jsonb_array_elements(COALESCE(v_mts->'packing_line_updates','[]'::jsonb)) u
    WHERE pol.id = (u->>'packing_order_line_id')::uuid;

    UPDATE erp_production.packing_order pko
    SET status = 'FINAL', actual_qty_kg = (u->>'actual_qty_kg')::numeric,
        total_qty_kg = (u->>'actual_qty_kg')::numeric,
        finalized_at = now(), finalized_by = v_actor_id,
        last_updated_at = now(), last_updated_by = v_actor_id
    FROM jsonb_array_elements(COALESCE(v_mts->'packing_orders','[]'::jsonb)) u
    WHERE pko.id = (u->>'packing_order_id')::uuid
      AND pko.process_order_id = p_process_order_id;

    -- A historic MTS Page-6 can have an SFG virtual reservation. It represents
    -- no physical issue and must be released even if it predates this migration.
    UPDATE erp_production.reservation_document rd
    SET status = 'CANCELLED', last_updated_at = now(), last_updated_by = v_actor_id
    FROM erp_production.packing_order_line pol
    JOIN erp_production.packing_order pko ON pko.id = pol.packing_order_id
    WHERE rd.source_line_id = pol.id AND rd.source_type = 'PACKING_PO'
      AND pko.process_order_id = p_process_order_id AND pol.line_type = 'SFG'
      AND rd.status IN ('OPEN', 'PARTIAL');

    IF jsonb_array_length(COALESCE(v_mts->'packing_reco_rows','[]'::jsonb)) > 0 THEN
      INSERT INTO erp_production.packing_order_line_reco
      SELECT (jsonb_populate_record(NULL::erp_production.packing_order_line_reco,
        jsonb_build_object('id', gen_random_uuid(), 'is_voided', false,
          'reco_document_year', '', 'source_txn_type', 'PRODUCTION',
          'last_updated_at', now()) || row_json)).*
      FROM jsonb_array_elements(v_mts->'packing_reco_rows') row_json;
    END IF;

    INSERT INTO erp_production.mts_verify_check (process_order_id, check_code, checked_by)
    SELECT p_process_order_id, row_json->>'check_code', v_actor_id
    FROM jsonb_array_elements(COALESCE(v_mts->'checks','[]'::jsonb)) row_json;

    INSERT INTO erp_production.mts_verify_hold_allocation (
      process_order_id, packing_order_id, batch_number_from, batch_number_to, batch_number,
      sku_material_id, target_stock_type, declared_pack_qty, held_pack_qty, qty_kg, created_by
    )
    SELECT p_process_order_id, (row_json->>'packing_order_id')::uuid,
      row_json->>'batch_number_from', row_json->>'batch_number_to', row_json->>'batch_number',
      (row_json->>'sku_material_id')::uuid, row_json->>'target_stock_type',
      (row_json->>'declared_pack_qty')::numeric, (row_json->>'held_pack_qty')::numeric,
      (row_json->>'qty_kg')::numeric, v_actor_id
    FROM jsonb_array_elements(COALESCE(v_mts->'hold_allocations','[]'::jsonb)) row_json;

    FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(v_mts->'status_postings','[]'::jsonb))
    LOOP
      SELECT (p->>'stock_document_id')::uuid INTO v_out_document_id
      FROM jsonb_array_elements(p_postings) p WHERE p->>'line_ref' = v_item->>'out_ref';
      SELECT (p->>'stock_document_id')::uuid INTO v_in_document_id
      FROM jsonb_array_elements(p_postings) p WHERE p->>'line_ref' = v_item->>'in_ref';
      IF v_out_document_id IS NULL OR v_in_document_id IS NULL THEN
        RAISE EXCEPTION 'PROD_MTS_VERIFY_STATUS_POSTING_MISSING';
      END IF;
      SELECT erp_procurement.generate_doc_number('SSC') INTO v_ssc_number;
      INSERT INTO erp_inventory.stock_status_change_posting (
        document_number, company_id, material_id, storage_location_id, batch_number,
        packing_po_number, from_stock_type, to_stock_type, movement_type_code,
        quantity, entered_quantity, uom_code, reason, requires_approval, status,
        stock_document_id_out, stock_document_id_in, created_by, created_at,
        approved_by, approved_at, last_updated_by, last_updated_at
      ) VALUES (
        v_ssc_number,
        (SELECT company_id FROM erp_production.process_order WHERE id = p_process_order_id),
        (v_item->>'material_id')::uuid, (v_item->>'storage_location_id')::uuid,
        NULL, NULL, 'UNRESTRICTED', v_item->>'target_stock_type', v_item->>'movement_type_code',
        (v_item->>'quantity')::numeric, (v_item->>'quantity')::numeric, v_item->>'uom_code',
        'MTS Verify QA stock allocation', false, 'POSTED', v_out_document_id, v_in_document_id,
        v_actor_id, now(), v_actor_id, now(), v_actor_id, now()
      );
    END LOOP;

    UPDATE erp_production.mts_batch_yield_variance
    SET status = 'POSTED', last_updated_by = v_actor_id, last_updated_at = now()
    WHERE process_order_id = p_process_order_id AND id IN (
      SELECT (row_json #>> '{}')::uuid FROM jsonb_array_elements(COALESCE(v_mts->'yield_ids','[]'::jsonb)) row_json
    ) AND status = 'PENDING';
    IF (SELECT COUNT(*) FROM erp_production.mts_batch_yield_variance WHERE process_order_id = p_process_order_id AND status = 'PENDING') > 0 THEN
      RAISE EXCEPTION 'PROD_MTS_VERIFY_YIELD_NOT_POSTED';
    END IF;

    UPDATE erp_production.process_order
    SET status = 'VERIFIED', actual_qty = (v_header->>'actual_qty')::numeric,
        fg_stock_ledger_id = NULL, qi_release_stock_ledger_id = NULL,
        verified_at = now(), verified_by = NULLIF(v_header->>'verified_by','')::uuid,
        has_unapproved_deviation = false, urgent_posting_date = NULL,
        last_updated_at = now(), last_updated_by = v_actor_id
    WHERE id = p_process_order_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'PROD_PO_VERIFY_HEADER_NOT_FOUND: %', p_process_order_id; END IF;
    RETURN;
  END IF;

  -- Existing non-MTS Process PO Verify behaviour is preserved below.
  UPDATE erp_production.process_order_line pol
  SET stock_ledger_id = (p->>'stock_ledger_id')::uuid
  FROM jsonb_array_elements(p_postings) AS p
  WHERE p->>'line_ref' NOT IN ('FG', 'QI_OUT', 'QI_RELEASE')
    AND pol.id = (p->>'line_ref')::uuid;
  SELECT (p->>'stock_ledger_id')::uuid INTO v_fg_ledger FROM jsonb_array_elements(p_postings) p WHERE p->>'line_ref' = 'FG';
  SELECT (p->>'stock_ledger_id')::uuid INTO v_qi_ledger FROM jsonb_array_elements(p_postings) p WHERE p->>'line_ref' = 'QI_RELEASE';
  UPDATE erp_production.process_order
  SET status = 'VERIFIED', actual_qty = (v_header->>'actual_qty')::numeric,
      fg_stock_ledger_id = v_fg_ledger, qi_release_stock_ledger_id = v_qi_ledger,
      verified_at = now(), verified_by = NULLIF(v_header->>'verified_by','')::uuid,
      has_unapproved_deviation = COALESCE((v_header->>'has_unapproved_deviation')::boolean, false),
      urgent_posting_date = NULLIF(v_header->>'urgent_posting_date','')::date,
      last_updated_at = now(), last_updated_by = v_actor_id
  WHERE id = p_process_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROD_PO_VERIFY_HEADER_NOT_FOUND: %', p_process_order_id; END IF;
END;
$$;
