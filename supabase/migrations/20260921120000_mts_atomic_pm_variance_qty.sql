-- §138 (2026-09-21): Page 4/6 shortfall/excess-confirm mechanism records a
-- signed variance_qty on RM lines already (process_order_line.variance_qty,
-- already read by this function). PM lines (packing_order_line) have the
-- same column (added 2026-07-21, §83.4.1 addendum) but this atomic function
-- never wrote to it. Adds that one column to the existing INSERT -- no other
-- behavior changes.
--
-- This is deliberately the final statement in this migration (same CLI
-- parsing workaround as the original 20260920125457 migration).
CREATE OR REPLACE FUNCTION erp_production."create_mts_documents_atomic"(
  p_request jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = erp_production, erp_procurement, erp_inventory, public
AS $$
DECLARE
  v_header jsonb := p_request->'header';
  v_rm_lines jsonb := COALESCE(p_request->'rm_lines', '[]'::jsonb);
  v_packing_orders jsonb := COALESCE(p_request->'packing_orders', '[]'::jsonb);
  v_batch_numbers jsonb := COALESCE(p_request->'batch_numbers', '[]'::jsonb);
  v_snapshot jsonb := COALESCE(p_request->'snapshot', '{}'::jsonb);
  v_company_id uuid := NULLIF(v_header->>'company_id', '')::uuid;
  v_actor_id uuid := NULLIF(v_header->>'actor_id', '')::uuid;
  v_process_order_id uuid;
  v_process_po_number text;
  v_process_status text;
  v_batch text;
  v_existing_batch_status text;
  v_row jsonb;
  v_line jsonb;
  v_plan jsonb;
  v_order jsonb;
  v_plan_row_id uuid;
  v_packing_order_id uuid;
  v_packing_po_number text;
  v_line_id uuid;
  v_need record;
  v_physical numeric;
  v_reserved numeric;
  v_available numeric;
  v_machine_id uuid;
  v_packing_results jsonb := '[]'::jsonb;
  v_now timestamptz := now();
BEGIN
  IF jsonb_typeof(p_request) <> 'object'
    OR jsonb_typeof(v_header) <> 'object'
    OR jsonb_typeof(v_rm_lines) <> 'array'
    OR jsonb_typeof(v_packing_orders) <> 'array'
    OR jsonb_typeof(v_batch_numbers) <> 'array'
    OR jsonb_array_length(v_rm_lines) = 0
    OR jsonb_array_length(v_packing_orders) = 0
    OR jsonb_array_length(v_batch_numbers) = 0
  THEN
    RAISE EXCEPTION 'PROD_MTS_SESSION_PAYLOAD_INVALID';
  END IF;

  IF v_company_id IS NULL OR v_actor_id IS NULL
    OR COALESCE(v_header->>'po_type', '') <> 'MTS'
    OR NULLIF(v_header->>'material_id', '') IS NULL
    OR NULLIF(v_header->>'stroke_master_id', '') IS NULL
    OR NULLIF(v_header->>'machine_id', '') IS NULL
    OR NULLIF(v_header->>'segment_code', '') IS NULL
    OR COALESCE((v_header->>'planned_qty')::numeric, 0) <= 0
  THEN
    RAISE EXCEPTION 'PROD_MTS_SESSION_HEADER_INVALID';
  END IF;

  /* Lock every stock cell in a deterministic order before reading it. */
  FOR v_need IN
    SELECT material_id, storage_location_id
    FROM (
      SELECT COALESCE(NULLIF(line->>'actual_material_id', '')::uuid, NULLIF(line->>'material_id', '')::uuid) AS material_id,
             NULLIF(line->>'issue_sloc_id', '')::uuid AS storage_location_id
      FROM jsonb_array_elements(v_rm_lines) AS line
      WHERE COALESCE((line->>'actual_qty')::numeric, 0) > 0
      UNION
      SELECT COALESCE(NULLIF(line->>'actual_material_id', '')::uuid, NULLIF(line->>'material_id', '')::uuid),
             NULLIF(line->>'issue_sloc_id', '')::uuid
      FROM jsonb_array_elements(v_packing_orders) AS item
      CROSS JOIN LATERAL jsonb_array_elements(item->'lines') AS line
      WHERE line->>'line_type' = 'PM' AND COALESCE((line->>'total_qty')::numeric, 0) > 0
    ) AS needs
    WHERE material_id IS NOT NULL AND storage_location_id IS NOT NULL
    GROUP BY material_id, storage_location_id
    ORDER BY material_id, storage_location_id
  LOOP
    PERFORM pg_advisory_xact_lock(hashtext('mts-stock:' || v_company_id::text || ':' || v_need.material_id::text || ':' || v_need.storage_location_id::text));
  END LOOP;

  /* Batch locks make an advisory Page-3 preview harmless under concurrency. */
  FOR v_batch IN SELECT value #>> '{}' FROM jsonb_array_elements(v_batch_numbers) ORDER BY 1
  LOOP
    IF NULLIF(v_batch, '') IS NULL THEN RAISE EXCEPTION 'PROD_BATCH_RANGE_INVALID'; END IF;
    PERFORM pg_advisory_xact_lock(hashtext('mts-batch:' || v_company_id::text || ':' || v_batch));
  END LOOP;

  /*
   * Common MTO/HPS/MTEST availability semantics: unrestricted physical less
   * every other OPEN/PARTIAL reservation.  Page-6 has no machine condition;
   * only Page-4 RM lines add the bucket-specific validation below.
   */
  FOR v_need IN
    SELECT material_id, storage_location_id, SUM(required_qty)::numeric AS required_qty
    FROM (
      SELECT COALESCE(NULLIF(line->>'actual_material_id', '')::uuid, NULLIF(line->>'material_id', '')::uuid) AS material_id,
             NULLIF(line->>'issue_sloc_id', '')::uuid AS storage_location_id,
             COALESCE((line->>'actual_qty')::numeric, 0) AS required_qty
      FROM jsonb_array_elements(v_rm_lines) AS line
      UNION ALL
      SELECT COALESCE(NULLIF(line->>'actual_material_id', '')::uuid, NULLIF(line->>'material_id', '')::uuid),
             NULLIF(line->>'issue_sloc_id', '')::uuid,
             COALESCE((line->>'total_qty')::numeric, 0)
      FROM jsonb_array_elements(v_packing_orders) AS item
      CROSS JOIN LATERAL jsonb_array_elements(item->'lines') AS line
      WHERE line->>'line_type' = 'PM'
    ) AS needs
    WHERE material_id IS NOT NULL AND storage_location_id IS NOT NULL AND required_qty > 0
    GROUP BY material_id, storage_location_id
  LOOP
    SELECT COALESCE(SUM(quantity), 0) INTO v_physical
      FROM erp_inventory.stock_snapshot
      WHERE company_id = v_company_id AND material_id = v_need.material_id
        AND storage_location_id = v_need.storage_location_id
        AND stock_type_code = 'UNRESTRICTED';
    SELECT COALESCE(SUM(balance_qty), 0) INTO v_reserved
      FROM erp_production.reservation_document
      WHERE company_id = v_company_id AND material_id = v_need.material_id
        AND storage_location_id = v_need.storage_location_id
        AND status IN ('OPEN', 'PARTIAL');
    v_available := v_physical - v_reserved;
    IF v_need.required_qty > v_available + 0.0001 THEN
      RAISE EXCEPTION 'PROD_MTS_INSUFFICIENT_STOCK: material %, location %, required %, available %',
        v_need.material_id, v_need.storage_location_id, v_need.required_qty, v_available;
    END IF;
  END LOOP;

  /* Page-4-only physical-source rule: own machine bucket, or Unassigned. */
  FOR v_need IN
    SELECT COALESCE(NULLIF(line->>'actual_material_id', '')::uuid, NULLIF(line->>'material_id', '')::uuid) AS material_id,
           NULLIF(line->>'issue_sloc_id', '')::uuid AS storage_location_id,
           NULLIF(line->>'bucket_machine_id', '')::uuid AS machine_id,
           SUM(COALESCE((line->>'actual_qty')::numeric, 0))::numeric AS required_qty
    FROM jsonb_array_elements(v_rm_lines) AS line
    WHERE COALESCE(line->>'bucket_source', 'LOCATION') IN ('MACHINE', 'UNASSIGNED')
      AND COALESCE((line->>'actual_qty')::numeric, 0) > 0
    GROUP BY 1, 2, 3
  LOOP
    SELECT COALESCE(SUM(CASE WHEN direction = 'OUT' THEN -qty ELSE qty END), 0) INTO v_physical
      FROM erp_production.machine_stock_log
      WHERE company_id = v_company_id AND material_id = v_need.material_id
        AND storage_location_id = v_need.storage_location_id
        AND machine_id IS NOT DISTINCT FROM v_need.machine_id;
    SELECT COALESCE(SUM(balance_qty), 0) INTO v_reserved
      FROM erp_production.reservation_document
      WHERE company_id = v_company_id AND material_id = v_need.material_id
        AND storage_location_id = v_need.storage_location_id
        AND status IN ('OPEN', 'PARTIAL');
    v_available := v_physical - v_reserved;
    IF v_need.required_qty > v_available + 0.0001 THEN
      RAISE EXCEPTION 'PROD_MTS_MACHINE_BUCKET_SHORT: material %, location %, required %, available %',
        v_need.material_id, v_need.storage_location_id, v_need.required_qty, v_available;
    END IF;
  END LOOP;

  SELECT erp_procurement.generate_doc_number('PROC_PO') INTO v_process_po_number;
  v_process_status := CASE WHEN COALESCE((v_header->>'mts_used_current_stroke')::boolean, false) THEN 'FINAL' ELSE 'STANDARD' END;

  INSERT INTO erp_production.process_order (
    company_id, po_number, po_type, material_id, stroke_master_id, machine_id,
    planned_qty, actual_qty, batch_number, batch_number_from, batch_number_to,
    number_of_batches, production_date, shift_id, status, segment_code,
    mts_used_current_stroke, finalized_by, finalized_at,
    created_by, created_at, last_updated_by, last_updated_at
  ) VALUES (
    v_company_id, v_process_po_number, 'MTS', (v_header->>'material_id')::uuid,
    (v_header->>'stroke_master_id')::uuid, (v_header->>'machine_id')::uuid,
    (v_header->>'planned_qty')::numeric,
    CASE WHEN v_process_status = 'FINAL' THEN (v_header->>'planned_qty')::numeric ELSE NULL END,
    v_batch_numbers->>0, v_batch_numbers->>0, v_batch_numbers->>(jsonb_array_length(v_batch_numbers) - 1),
    jsonb_array_length(v_batch_numbers), (v_header->>'production_date')::date,
    NULLIF(v_header->>'shift_id', '')::uuid, v_process_status, v_header->>'segment_code',
    COALESCE((v_header->>'mts_used_current_stroke')::boolean, false),
    CASE WHEN v_process_status = 'FINAL' THEN v_actor_id ELSE NULL END,
    CASE WHEN v_process_status = 'FINAL' THEN v_now ELSE NULL END,
    v_actor_id, v_now, v_actor_id, v_now
  ) RETURNING id INTO v_process_order_id;

  /* CLAIMED means this Page-6 document owns the range but Verify has not posted it. */
  FOR v_batch IN SELECT value #>> '{}' FROM jsonb_array_elements(v_batch_numbers)
  LOOP
    SELECT status INTO v_existing_batch_status
      FROM erp_production.batch_number_instance
      WHERE company_id = v_company_id AND batch_number = v_batch
      FOR UPDATE;
    IF FOUND THEN
      IF v_existing_batch_status IN ('ACTIVE', 'CLAIMED', 'USED') THEN
        RAISE EXCEPTION 'PROD_BATCH_RANGE_DUPLICATE: %', v_batch;
      END IF;
      UPDATE erp_production.batch_number_instance
        SET po_type = 'MTS', prodshade_material_id = (v_header->>'material_id')::uuid,
            status = 'CLAIMED', source_process_order_id = v_process_order_id,
            voided_at = NULL, released_by = NULL, released_at = NULL, release_reason = NULL,
            last_updated_by = v_actor_id, last_updated_at = v_now
        WHERE company_id = v_company_id AND batch_number = v_batch;
    ELSE
      INSERT INTO erp_production.batch_number_instance (
        company_id, po_type, prodshade_material_id, batch_number, status,
        source_process_order_id, created_at, last_updated_at, last_updated_by
      ) VALUES (
        v_company_id, 'MTS', (v_header->>'material_id')::uuid, v_batch, 'CLAIMED',
        v_process_order_id, v_now, v_now, v_actor_id
      );
    END IF;
  END LOOP;

  FOR v_row IN SELECT value FROM jsonb_array_elements(v_rm_lines)
  LOOP
    INSERT INTO erp_production.process_order_line (
      process_order_id, stroke_line_id, material_id, actual_material_id,
      planned_qty, actual_qty, uom_code, issue_sloc_id, is_rm, display_order,
      dosage_pct, is_formulation_line, approved_status, ap_approved_qty, variance_qty
    ) VALUES (
      v_process_order_id, NULLIF(v_row->>'stroke_line_id', '')::uuid,
      (v_row->>'material_id')::uuid, NULLIF(v_row->>'actual_material_id', '')::uuid,
      COALESCE((v_row->>'planned_qty')::numeric, 0), COALESCE((v_row->>'actual_qty')::numeric, 0),
      COALESCE(NULLIF(v_row->>'uom_code', ''), 'KG'), (v_row->>'issue_sloc_id')::uuid,
      true, COALESCE((v_row->>'display_order')::integer, 0),
      NULLIF(v_row->>'dosage_pct', '')::numeric,
      COALESCE((v_row->>'is_formulation_line')::boolean, false), 'YES',
      COALESCE((v_row->>'actual_qty')::numeric, 0), NULLIF(v_row->>'variance_qty', '')::numeric
    ) RETURNING id INTO v_line_id;

    IF COALESCE((v_row->>'actual_qty')::numeric, 0) > 0 THEN
      INSERT INTO erp_production.reservation_document (
        source_type, source_id, source_line_id, company_id, material_id,
        storage_location_id, required_qty, uom_code, required_by_date,
        issued_qty, status, created_by, created_at, last_updated_by, last_updated_at
      ) VALUES (
        'PROCESS_PO', v_process_order_id, v_line_id, v_company_id,
        COALESCE(NULLIF(v_row->>'actual_material_id', '')::uuid, (v_row->>'material_id')::uuid),
        (v_row->>'issue_sloc_id')::uuid, (v_row->>'actual_qty')::numeric,
        COALESCE(NULLIF(v_row->>'uom_code', ''), 'KG'), (v_header->>'production_date')::date,
        0, 'OPEN', v_actor_id, v_now, v_actor_id, v_now
      );
    END IF;
  END LOOP;

  FOR v_order IN SELECT value FROM jsonb_array_elements(v_packing_orders)
  LOOP
    v_plan := v_order->'plan';
    IF jsonb_typeof(v_plan) <> 'object' OR jsonb_typeof(v_order->'lines') <> 'array' THEN
      RAISE EXCEPTION 'PROD_MTS_PACKING_PAYLOAD_INVALID';
    END IF;
    INSERT INTO erp_production.mts_packing_plan_row (
      process_order_id, batch_number_from, batch_number_to, pack_code_id,
      outer_unit_per_batch, storage_location_id, display_order, status,
      created_by, created_at, last_updated_by, last_updated_at
    ) VALUES (
      v_process_order_id, v_plan->>'batch_number_from', v_plan->>'batch_number_to',
      (v_plan->>'pack_code_id')::uuid, (v_plan->>'outer_unit_per_batch')::numeric,
      (v_plan->>'storage_location_id')::uuid, COALESCE((v_plan->>'display_order')::integer, 0),
      'CONVERTED', v_actor_id, v_now, v_actor_id, v_now
    ) RETURNING id INTO v_plan_row_id;

    SELECT erp_procurement.generate_doc_number('PACK_PO') INTO v_packing_po_number;
    INSERT INTO erp_production.packing_order (
      company_id, po_number, po_type, source_po_type, process_order_id, machine_id,
      material_id, pack_code_id, batch_number_from, batch_number_to,
      fill_qty_per_pack, num_packs, sku_qty, fg_conversion_qty, sfg_conversion_qty,
      planned_qty_kg, total_qty_kg, status, segment_code,
      created_by, created_at, last_updated_by, last_updated_at
    ) VALUES (
      v_company_id, v_packing_po_number, 'PMTS', 'MTS', v_process_order_id, NULL,
      (v_order->'header'->>'material_id')::uuid, (v_plan->>'pack_code_id')::uuid,
      v_plan->>'batch_number_from', v_plan->>'batch_number_to',
      (v_order->'header'->>'fill_qty_per_pack')::numeric,
      (v_order->'header'->>'num_packs')::numeric, (v_order->'header'->>'sku_qty')::numeric,
      (v_order->'header'->>'fg_conversion_qty')::numeric, (v_order->'header'->>'sfg_conversion_qty')::numeric,
      (v_order->'header'->>'planned_qty_kg')::numeric, (v_order->'header'->>'total_qty_kg')::numeric,
      'STANDARD', v_header->>'segment_code', v_actor_id, v_now, v_actor_id, v_now
    ) RETURNING id INTO v_packing_order_id;

    UPDATE erp_production.mts_packing_plan_row
      SET packing_order_id = v_packing_order_id, last_updated_by = v_actor_id, last_updated_at = v_now
      WHERE id = v_plan_row_id;

    FOR v_line IN SELECT value FROM jsonb_array_elements(v_order->'lines')
    LOOP
      INSERT INTO erp_production.packing_order_line (
        packing_order_id, line_type, material_id, actual_material_id, batch_number,
        qty_per_pack, total_qty, actual_qty, issue_sloc_id, uom_code,
        movement_type_code, has_alternate, material_group_id, display_order, variance_qty
      ) VALUES (
        v_packing_order_id, v_line->>'line_type', (v_line->>'material_id')::uuid,
        NULLIF(v_line->>'actual_material_id', '')::uuid, NULL,
        COALESCE((v_line->>'qty_per_pack')::numeric, 0), COALESCE((v_line->>'total_qty')::numeric, 0),
        NULL, NULLIF(v_line->>'issue_sloc_id', '')::uuid,
        COALESCE(NULLIF(v_line->>'uom_code', ''), 'KG'),
        COALESCE(NULLIF(v_line->>'movement_type_code', ''), CASE WHEN v_line->>'line_type' = 'FG' THEN 'P101' ELSE 'P261' END),
        COALESCE((v_line->>'has_alternate')::boolean, false), NULLIF(v_line->>'material_group_id', '')::uuid,
        COALESCE((v_line->>'display_order')::integer, 0), NULLIF(v_line->>'variance_qty', '')::numeric
      ) RETURNING id INTO v_line_id;

      IF v_line->>'line_type' <> 'FG' AND COALESCE((v_line->>'total_qty')::numeric, 0) > 0 THEN
        INSERT INTO erp_production.reservation_document (
          source_type, source_id, source_line_id, company_id, material_id,
          storage_location_id, required_qty, uom_code, required_by_date,
          issued_qty, status, batch_number, created_by, created_at, last_updated_by, last_updated_at
        ) VALUES (
          'PACKING_PO', v_packing_order_id, v_line_id, v_company_id,
          COALESCE(NULLIF(v_line->>'actual_material_id', '')::uuid, (v_line->>'material_id')::uuid),
          NULLIF(v_line->>'issue_sloc_id', '')::uuid, (v_line->>'total_qty')::numeric,
          COALESCE(NULLIF(v_line->>'uom_code', ''), 'KG'), (v_header->>'production_date')::date,
          0, 'OPEN', NULL, v_actor_id, v_now, v_actor_id, v_now
        );
      END IF;
    END LOOP;

    v_packing_results := v_packing_results || jsonb_build_array(jsonb_build_object(
      'id', v_packing_order_id, 'po_number', v_packing_po_number,
      'batch_number_from', v_plan->>'batch_number_from', 'batch_number_to', v_plan->>'batch_number_to'
    ));
  END LOOP;

  INSERT INTO erp_production.mts_creation_snapshot (
    process_order_id, page4_material_plan, page5_packing_plan, page6_pm_plan,
    created_by, created_at, last_updated_by, last_updated_at
  ) VALUES (
    v_process_order_id, COALESCE(v_snapshot->'page4_material_plan', '[]'::jsonb),
    COALESCE(v_snapshot->'page5_packing_plan', '[]'::jsonb), COALESCE(v_snapshot->'page6_pm_plan', '[]'::jsonb),
    v_actor_id, v_now, v_actor_id, v_now
  );

  RETURN jsonb_build_object(
    'id', v_process_order_id,
    'po_number', v_process_po_number,
    'status', v_process_status,
    'packing_orders', v_packing_results
  );
END;
$$;
