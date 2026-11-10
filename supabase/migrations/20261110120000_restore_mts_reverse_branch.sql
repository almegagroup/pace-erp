-- Restore the p_context->'mts_reverse' branch of
-- erp_production.complete_process_po_verify (found missing 2026-11-10 on dev
-- and prod).
--
-- 20260921181000_mts_process_po_cors_reverse.sql added the branch. A later
-- migration, 20261007050015_mts_urgent_manager_posting.sql, redefined the whole
-- function with CREATE OR REPLACE from a body that did not contain it, silently
-- dropping it; 20261110100000_mts_hold_reason.sql then patched the live
-- definition in place without noticing. Result: reverseMtsProcessOrderHandler
-- posted its reversal stock movements through post_document with
-- context.mts_reverse, the function ignored that key and fell into the non-MTS
-- verify path, so the Process PO / Packing POs / hold rows were never marked
-- REVERSED and the batch range was never released.
--
-- This body is the LIVE definition (pg_get_functiondef, 2026-11-10: urgent-
-- manager + hold-reason logic included) with the mts_reverse branch from
-- 20260921181000 merged in unchanged, placed before the `IF v_is_mts` branch
-- exactly as it was originally.
--
-- Deliberately the final statement in this migration (Supabase CLI v2.75.0
-- mis-parses an atomic function identifier when another top-level statement
-- follows it).
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
  v_mts_urgent jsonb := COALESCE(p_context->'mts_urgent_manager', '{}'::jsonb);
  v_is_mts boolean := p_context ? 'mts_verify';
  v_rev jsonb := COALESCE(p_context->'mts_reverse', '{}'::jsonb);
  v_is_mts_reverse boolean := p_context ? 'mts_reverse';
  v_actor_id uuid := NULLIF(v_header->>'last_updated_by', '')::uuid;
  v_verified_by uuid := COALESCE(NULLIF(v_header->>'verified_by', '')::uuid, NULLIF(v_header->>'last_updated_by', '')::uuid);
  v_item jsonb;
  v_out_document_id uuid;
  v_in_document_id uuid;
  v_ssc_number text;
  v_reverse_actor_id uuid;
  v_reverse_reason text;
  v_hold jsonb;
  v_original erp_inventory.stock_status_change_posting%ROWTYPE;
  v_new_ssc_id uuid;
BEGIN
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

  IF v_is_mts_reverse THEN
    v_reverse_actor_id := NULLIF(v_rev->>'actor_id', '')::uuid;
    v_reverse_reason := COALESCE(v_rev->>'reason', 'CORS reversal');

    -- Reverse every hold posting this Process PO's own MTS Verify created --
    -- located via reference_document_id, never by guessing among look-alike
    -- rows from a sibling Process PO holding the same blended SKU.
    FOR v_hold IN SELECT value FROM jsonb_array_elements(COALESCE(v_rev->'hold_reversals','[]'::jsonb))
    LOOP
      SELECT (p->>'stock_document_id')::uuid INTO v_out_document_id
      FROM jsonb_array_elements(p_postings) p WHERE p->>'line_ref' = v_hold->>'out_ref';
      SELECT (p->>'stock_document_id')::uuid INTO v_in_document_id
      FROM jsonb_array_elements(p_postings) p WHERE p->>'line_ref' = v_hold->>'in_ref';
      IF v_out_document_id IS NULL OR v_in_document_id IS NULL THEN
        RAISE EXCEPTION 'PROD_MTS_REVERSE_HOLD_POSTING_MISSING';
      END IF;

      SELECT * INTO v_original FROM erp_inventory.stock_status_change_posting
      WHERE id = (v_hold->>'original_posting_id')::uuid
        AND reference_document_type = 'PROC_PO' AND reference_document_id = p_process_order_id
        AND status = 'POSTED'
      FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'PROD_MTS_REVERSE_HOLD_ORIGINAL_NOT_FOUND'; END IF;

      v_new_ssc_id := gen_random_uuid();
      SELECT erp_procurement.generate_doc_number('SSC') INTO v_ssc_number;
      INSERT INTO erp_inventory.stock_status_change_posting (
        id, document_number, company_id, material_id, storage_location_id,
        batch_number, packing_po_number, from_stock_type, to_stock_type,
        movement_type_code, quantity, entered_quantity, uom_code, reason,
        requires_approval, status, stock_document_id_out, stock_document_id_in,
        reversal_of_posting_id, reference_document_type, reference_document_id,
        created_by, created_at
      ) VALUES (
        v_new_ssc_id, v_ssc_number,
        v_original.company_id, v_original.material_id, v_original.storage_location_id,
        v_original.batch_number, v_original.packing_po_number,
        v_original.to_stock_type, v_original.from_stock_type,
        COALESCE(v_hold->>'reversal_movement_type_code', ''),
        v_original.quantity, v_original.entered_quantity, v_original.uom_code,
        'CORS reversal of ' || v_original.document_number, false, 'POSTED',
        v_out_document_id, v_in_document_id, v_original.id,
        v_original.reference_document_type, v_original.reference_document_id,
        v_reverse_actor_id, now()
      );
      UPDATE erp_inventory.stock_status_change_posting
      SET status = 'REVERSED', last_updated_by = v_reverse_actor_id, last_updated_at = now()
      WHERE id = v_original.id;
    END LOOP;

    -- Every linked Packing PO is controlled by this parent; CORS on the
    -- parent cascades (no per-Packing-PO reversal step for MTS).
    UPDATE erp_production.packing_order
    SET status = 'REVERSED', reversed_by = v_reverse_actor_id, reversed_at = now(),
        last_updated_at = now(), last_updated_by = v_reverse_actor_id
    WHERE process_order_id = p_process_order_id AND status <> 'REVERSED';

    -- A pre-§138-fix VERIFIED MTS batch may still carry real reco rows --
    -- void them the same "append, never reset" way every other CORS/COR6
    -- path already does.
    UPDATE erp_production.process_order_line_reco
    SET is_voided = true, voided_at = now(), last_updated_at = now(), last_updated_by = v_reverse_actor_id
    WHERE process_order_id = p_process_order_id AND is_voided = false;
    UPDATE erp_production.packing_order_line_reco plr
    SET is_voided = true, voided_at = now(), last_updated_at = now(), last_updated_by = v_reverse_actor_id
    FROM erp_production.packing_order pko
    WHERE plr.packing_order_id = pko.id AND pko.process_order_id = p_process_order_id AND plr.is_voided = false;

    -- Release the whole batch range immediately, USED included (business
    -- owner, 2026-09-21, MTS CORS path only).
    UPDATE erp_production.batch_number_instance
    SET status = 'RELEASED', released_by = v_reverse_actor_id, released_at = now(),
        release_reason = v_reverse_reason, last_updated_at = now(), last_updated_by = v_reverse_actor_id
    WHERE source_process_order_id = p_process_order_id AND po_type = 'MTS'
      AND status IN ('ACTIVE', 'VOIDED', 'CLAIMED', 'USED');

    UPDATE erp_production.process_order
    SET status = 'REVERSED', reverse_reason = v_reverse_reason, reversed_by = v_reverse_actor_id,
        reversed_at = now(), last_updated_at = now(), last_updated_by = v_reverse_actor_id
    WHERE id = p_process_order_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'PROD_PO_REVERSE_HEADER_NOT_FOUND: %', p_process_order_id; END IF;
    RETURN;
  END IF;

  IF v_is_mts THEN
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
    SELECT p_process_order_id, row_json->>'check_code', v_verified_by
    FROM jsonb_array_elements(COALESCE(v_mts->'checks','[]'::jsonb)) row_json;

    INSERT INTO erp_production.mts_verify_hold_allocation (
      process_order_id, packing_order_id, batch_number_from, batch_number_to, batch_number,
      sku_material_id, target_stock_type, declared_pack_qty, held_pack_qty, qty_kg, created_by, reason
    )
    SELECT p_process_order_id, (row_json->>'packing_order_id')::uuid,
      row_json->>'batch_number_from', row_json->>'batch_number_to', row_json->>'batch_number',
      (row_json->>'sku_material_id')::uuid, row_json->>'target_stock_type',
      (row_json->>'declared_pack_qty')::numeric, (row_json->>'held_pack_qty')::numeric,
      (row_json->>'qty_kg')::numeric, v_verified_by, NULLIF(btrim(row_json->>'reason'), '')
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
        NULLIF(v_item->>'batch_number', ''), NULL, 'UNRESTRICTED', v_item->>'target_stock_type', v_item->>'movement_type_code',
        (v_item->>'quantity')::numeric, (v_item->>'quantity')::numeric, v_item->>'uom_code',
        COALESCE(NULLIF(btrim(v_item->>'reason'), ''), 'MTS Verify QA stock allocation'), false, 'POSTED', v_out_document_id, v_in_document_id,
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
        has_unapproved_deviation = false,
        urgent_posting_date = NULLIF(v_header->>'urgent_posting_date','')::date,
        priority = CASE WHEN v_mts_urgent->>'decision' = 'REJECT_URGENCY_POST_NORMAL' THEN 'NORMAL' ELSE priority END,
        manager_decided_by = COALESCE(NULLIF(v_header->>'manager_decided_by','')::uuid, manager_decided_by),
        manager_decided_at = CASE WHEN NULLIF(v_header->>'manager_decided_by','') IS NULL THEN manager_decided_at ELSE now() END,
        last_updated_at = now(), last_updated_by = v_actor_id
    WHERE id = p_process_order_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'PROD_PO_VERIFY_HEADER_NOT_FOUND: %', p_process_order_id; END IF;

    IF NULLIF(v_mts_urgent->>'decision','') IS NOT NULL THEN
      UPDATE erp_production.mts_urgent_verify_request
      SET status = CASE WHEN v_mts_urgent->>'decision' = 'APPROVE_URGENT' THEN 'APPROVED_URGENT' ELSE 'REJECTED_TO_NORMAL' END,
          manager_decided_by = NULLIF(v_mts_urgent->>'manager_decided_by','')::uuid,
          manager_decided_at = now(),
          manager_decision = v_mts_urgent->>'decision',
          manager_reason = NULLIF(v_mts_urgent->>'reason',''),
          effective_posting_date = COALESCE(
            NULLIF(v_mts_urgent->>'effective_posting_date','')::date,
            NULLIF(v_header->>'urgent_posting_date','')::date
          ),
          updated_at = now()
      WHERE process_order_id = p_process_order_id AND status = 'PENDING_MANAGER';
      IF NOT FOUND THEN RAISE EXCEPTION 'PROD_MTS_URGENT_REQUEST_NOT_PENDING'; END IF;
    END IF;
    RETURN;
  END IF;

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
