-- Cross-user idempotency for transactional workbook submissions.
--
-- A browser submission UUID protects retry/reconciliation for one user, but
-- cannot protect two users uploading the same workbook at the same time.  The
-- business fingerprint below is scoped to company and workflow, never to FO
-- or SO alone: legitimate later deliveries remain valid when their canonical
-- payload is different.  Bulk DO creation is integrated here because its DO
-- write and recorded outcome must commit atomically.
--
-- This migration is deliberately one top-level DO block.  The deployment CLI
-- applies migrations as prepared statements and cannot accept multiple
-- top-level commands in this repository's deployment configuration.
DO $migration$
BEGIN
  EXECUTE $ddl$
    CREATE TABLE IF NOT EXISTS erp_procurement.bulk_do_business_result (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id uuid NOT NULL,
      payload_fingerprint text NOT NULL,
      status text NOT NULL DEFAULT 'PROCESSING'
        CHECK (status IN ('PROCESSING', 'CREATED', 'FAILED')),
      delivery_challan_id uuid NULL REFERENCES erp_procurement.delivery_challan(id) ON DELETE RESTRICT,
      error_code text NULL,
      attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT bulk_do_business_result_company_fingerprint_unique UNIQUE (company_id, payload_fingerprint),
      CONSTRAINT bulk_do_business_result_created_dc_unique UNIQUE (delivery_challan_id)
    )
  $ddl$;
  EXECUTE $ddl$
    CREATE INDEX IF NOT EXISTS idx_bulk_do_business_result_status
      ON erp_procurement.bulk_do_business_result (company_id, status, updated_at DESC)
  $ddl$;
  EXECUTE 'ALTER TABLE erp_procurement.bulk_do_business_result ENABLE ROW LEVEL SECURITY';
  EXECUTE 'REVOKE ALL ON TABLE erp_procurement.bulk_do_business_result FROM PUBLIC';
  EXECUTE 'GRANT ALL ON TABLE erp_procurement.bulk_do_business_result TO service_role';

  -- A global result can legitimately be reflected in several users' local
  -- submission histories.  The old unique constraint prevented that exact
  -- safe reuse and is therefore removed before installing the new wrapper.
  EXECUTE 'ALTER TABLE erp_procurement.bulk_do_submission_group DROP CONSTRAINT IF EXISTS bulk_do_submission_group_created_dc_unique';

  EXECUTE $function_sql$
    CREATE OR REPLACE FUNCTION erp_procurement.save_bulk_delivery_order_submission_group_atomic(
      p_submission_id uuid,
      p_group_key uuid,
      p_company_id uuid,
      p_actor uuid,
      p_source_reference text,
      p_deferred boolean,
      p_payload_fingerprint text,
      p_header jsonb,
      p_sources jsonb,
      p_lines jsonb,
      p_patch jsonb
    ) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'erp_procurement', 'erp_production', 'public'
    AS $function$
    DECLARE
      v_submission erp_procurement.bulk_do_submission%ROWTYPE;
      v_group erp_procurement.bulk_do_submission_group%ROWTYPE;
      v_business erp_procurement.bulk_do_business_result%ROWTYPE;
      v_dc_id uuid;
      v_error text;
    BEGIN
      INSERT INTO erp_procurement.bulk_do_submission (id, company_id, submitted_by)
      VALUES (p_submission_id, p_company_id, p_actor)
      ON CONFLICT (id) DO NOTHING;

      SELECT * INTO v_submission
      FROM erp_procurement.bulk_do_submission
      WHERE id = p_submission_id
      FOR UPDATE;
      IF NOT FOUND OR v_submission.company_id <> p_company_id OR v_submission.submitted_by <> p_actor THEN
        RAISE EXCEPTION 'DO_BULK_SUBMISSION_SCOPE_MISMATCH';
      END IF;

      INSERT INTO erp_procurement.bulk_do_submission_group (
        submission_id, client_group_key, source_reference, payload_fingerprint
      ) VALUES (
        p_submission_id, p_group_key, p_source_reference, p_payload_fingerprint
      ) ON CONFLICT (submission_id, client_group_key) DO NOTHING;

      SELECT * INTO v_group
      FROM erp_procurement.bulk_do_submission_group
      WHERE submission_id = p_submission_id AND client_group_key = p_group_key
      FOR UPDATE;
      IF v_group.status = 'CREATED' AND v_group.delivery_challan_id IS NOT NULL THEN
        IF v_group.payload_fingerprint <> p_payload_fingerprint THEN
          RAISE EXCEPTION 'DO_BULK_SUBMISSION_GROUP_PAYLOAD_MISMATCH';
        END IF;
        RETURN jsonb_build_object('status', 'CREATED', 'dc_id', v_group.delivery_challan_id, 'reused', true);
      END IF;
      IF v_group.payload_fingerprint <> p_payload_fingerprint THEN
        UPDATE erp_procurement.bulk_do_submission_group
        SET source_reference = p_source_reference, payload_fingerprint = p_payload_fingerprint, updated_at = now()
        WHERE id = v_group.id;
      END IF;

      -- The unique business row is both a durable cross-user claim and a row
      -- lock. A racing request waits here, then receives the committed DO id
      -- instead of entering the DO creation path.
      INSERT INTO erp_procurement.bulk_do_business_result (company_id, payload_fingerprint)
      VALUES (p_company_id, p_payload_fingerprint)
      ON CONFLICT (company_id, payload_fingerprint) DO NOTHING;
      SELECT * INTO v_business
      FROM erp_procurement.bulk_do_business_result
      WHERE company_id = p_company_id AND payload_fingerprint = p_payload_fingerprint
      FOR UPDATE;
      IF v_business.status = 'CREATED' AND v_business.delivery_challan_id IS NOT NULL THEN
        UPDATE erp_procurement.bulk_do_submission_group
        SET status = 'CREATED', delivery_challan_id = v_business.delivery_challan_id,
            error_code = NULL, updated_at = now()
        WHERE id = v_group.id;
        RETURN jsonb_build_object('status', 'CREATED', 'dc_id', v_business.delivery_challan_id, 'reused', true);
      END IF;

      UPDATE erp_procurement.bulk_do_submission_group
      SET status = 'PROCESSING', error_code = NULL, attempt_count = attempt_count + 1, updated_at = now()
      WHERE id = v_group.id;
      UPDATE erp_procurement.bulk_do_business_result
      SET status = 'PROCESSING', error_code = NULL, attempt_count = attempt_count + 1, updated_at = now()
      WHERE id = v_business.id;

      BEGIN
        IF p_deferred THEN
          v_dc_id := erp_procurement.save_vdc_deferred_bulk_delivery_order_atomic(p_header, p_sources, p_lines, p_actor);
        ELSE
          v_dc_id := erp_procurement.save_delivery_order_unified_atomic('CREATE', NULL, p_header, p_sources, p_lines, p_actor);
        END IF;

        UPDATE erp_procurement.delivery_challan
        SET is_bulk_uploaded = true,
            pgi_deferred = p_deferred,
            dc_date = COALESCE(NULLIF(p_patch->>'do_date', '')::date, dc_date),
            dispatch_date = COALESCE(NULLIF(p_patch->>'dispatch_date', '')::date, dispatch_date),
            pre_invoice_tally_invoice_number = COALESCE(NULLIF(p_patch->>'tally_invoice_number', ''), pre_invoice_tally_invoice_number),
            pre_invoice_tally_invoice_date = COALESCE(NULLIF(p_patch->>'tally_invoice_date', '')::date, pre_invoice_tally_invoice_date),
            pre_invoice_inbound_number = COALESCE(NULLIF(p_patch->>'inbound_number', ''), pre_invoice_inbound_number)
        WHERE id = v_dc_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'DO_BULK_CREATE_RESULT_NOT_FOUND'; END IF;

        UPDATE erp_procurement.bulk_do_business_result
        SET status = 'CREATED', delivery_challan_id = v_dc_id, error_code = NULL, updated_at = now()
        WHERE id = v_business.id;
        UPDATE erp_procurement.bulk_do_submission_group
        SET status = 'CREATED', delivery_challan_id = v_dc_id, error_code = NULL, updated_at = now()
        WHERE id = v_group.id;
      EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
        UPDATE erp_procurement.bulk_do_business_result
        SET status = 'FAILED', error_code = left(coalesce(v_error, 'DO_BULK_CREATE_FAILED'), 250), updated_at = now()
        WHERE id = v_business.id;
        UPDATE erp_procurement.bulk_do_submission_group
        SET status = 'FAILED', error_code = left(coalesce(v_error, 'DO_BULK_CREATE_FAILED'), 250), updated_at = now()
        WHERE id = v_group.id;
        RETURN jsonb_build_object('status', 'FAILED', 'error_code', left(coalesce(v_error, 'DO_BULK_CREATE_FAILED'), 250));
      END;

      RETURN jsonb_build_object('status', 'CREATED', 'dc_id', v_dc_id, 'reused', false);
    END;
    $function$
  $function_sql$;

  EXECUTE 'REVOKE ALL ON FUNCTION erp_procurement.save_bulk_delivery_order_submission_group_atomic(uuid, uuid, uuid, uuid, text, boolean, text, jsonb, jsonb, jsonb, jsonb) FROM PUBLIC';
  EXECUTE 'GRANT EXECUTE ON FUNCTION erp_procurement.save_bulk_delivery_order_submission_group_atomic(uuid, uuid, uuid, uuid, text, boolean, text, jsonb, jsonb, jsonb, jsonb) TO service_role';

  -- SO Map has a natural business identity: one FO inside one SO.  The
  -- existing atomic upsert is therefore idempotent once concurrent callers
  -- serialize on that identity.  This applies to both the Excel bulk path
  -- and the normal single-group SO Map path because they use the same RPC.
  EXECUTE $function_sql$
    CREATE OR REPLACE FUNCTION erp_procurement."save_so_map_group_atomic"(p_group jsonb, p_allocations jsonb)
    RETURNS uuid
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = erp_procurement, erp_production, public
    AS $function$
    DECLARE
      v_group_id uuid;
      v_group_status text;
      v_external_fo text := nullif(p_group->>'external_fo_number', '');
    BEGIN
      IF jsonb_typeof(coalesce(p_allocations, '[]'::jsonb)) <> 'array'
        OR jsonb_array_length(coalesce(p_allocations, '[]'::jsonb)) = 0 THEN
        RAISE EXCEPTION 'SO_MAP_GROUP_EMPTY';
      END IF;

      -- Do not use a broad FO uniqueness rule.  The lock key contains the
      -- actual SO and FO identity, so different SOs/destinations still run
      -- independently while matching uploads cannot race into two groups.
      PERFORM pg_advisory_xact_lock(hashtextextended(
        coalesce(p_group->>'so_id', '') || '|' || coalesce(v_external_fo, '') || '|' || coalesce(p_group->>'source', ''),
        0
      ));
      IF v_external_fo IS NOT NULL THEN
        SELECT id, status INTO v_group_id, v_group_status
        FROM erp_procurement.sales_order_map_group
        WHERE so_id = (p_group->>'so_id')::uuid
          AND external_fo_number = v_external_fo
        FOR UPDATE;
      END IF;

      IF v_group_id IS NOT NULL THEN
        IF v_group_status = 'ACTIVE' AND EXISTS (
          SELECT 1
          FROM erp_procurement.delivery_challan_line line
          JOIN erp_procurement.sales_order_map_allocation allocation ON allocation.id = line.so_map_allocation_id
          JOIN erp_procurement.delivery_challan dc ON dc.id = line.dc_id
          WHERE allocation.map_group_id = v_group_id AND dc.status <> 'CANCELLED'
        ) THEN
          RAISE EXCEPTION 'SO_MAP_DO_LOCKED';
        END IF;
        UPDATE erp_procurement.sales_order_map_group
        SET customer_address_id = nullif(p_group->>'customer_address_id', '')::uuid,
            depot_code_id = nullif(p_group->>'depot_code_id', '')::uuid,
            status = 'ACTIVE',
            last_updated_by = (p_group->>'created_by')::uuid, last_updated_at = now()
        WHERE id = v_group_id;
      ELSE
        INSERT INTO erp_procurement.sales_order_map_group
          (so_id, fo_id, customer_address_id, depot_code_id, external_fo_number, status, created_by)
        VALUES
          ((p_group->>'so_id')::uuid, nullif(p_group->>'fo_id', '')::uuid,
           nullif(p_group->>'customer_address_id', '')::uuid, nullif(p_group->>'depot_code_id', '')::uuid,
           v_external_fo, 'ACTIVE', (p_group->>'created_by')::uuid)
        RETURNING id INTO v_group_id;
      END IF;

      UPDATE erp_procurement.sales_order_map_allocation existing
      SET allocated_qty = incoming.allocated_qty,
          customer_address_id = incoming.customer_address_id,
          depot_code_id = incoming.depot_code_id,
          sku_mismatch_confirmed = coalesce(incoming.sku_mismatch_confirmed, false),
          last_updated_by = incoming.created_by,
          last_updated_at = now()
      FROM jsonb_to_recordset(coalesce(p_allocations, '[]'::jsonb)) AS incoming(
        so_id uuid, so_line_id uuid, fo_id uuid, customer_address_id uuid, depot_code_id uuid,
        plan_feed_item_id uuid, allocated_qty numeric, sku_mismatch_confirmed boolean, created_by uuid
      )
      WHERE existing.map_group_id = v_group_id
        AND existing.so_line_id = incoming.so_line_id
        AND existing.status = 'ACTIVE';

      INSERT INTO erp_procurement.sales_order_map_allocation
        (so_id, so_line_id, fo_id, customer_address_id, depot_code_id, plan_feed_item_id,
         allocated_qty, status, sku_mismatch_confirmed, created_by, map_group_id)
      SELECT so_id, so_line_id, fo_id, customer_address_id, depot_code_id, plan_feed_item_id,
             allocated_qty, 'ACTIVE', coalesce(sku_mismatch_confirmed, false), created_by, v_group_id
      FROM jsonb_to_recordset(coalesce(p_allocations, '[]'::jsonb)) AS a(
        so_id uuid, so_line_id uuid, fo_id uuid, customer_address_id uuid, depot_code_id uuid,
        plan_feed_item_id uuid, allocated_qty numeric, sku_mismatch_confirmed boolean, created_by uuid
      )
      WHERE NOT EXISTS (
        SELECT 1 FROM erp_procurement.sales_order_map_allocation existing
        WHERE existing.map_group_id = v_group_id
          AND existing.so_line_id = a.so_line_id
          AND existing.status = 'ACTIVE'
      );
      RETURN v_group_id;
    END;
    $function$
  $function_sql$;
  EXECUTE 'REVOKE ALL ON FUNCTION erp_procurement."save_so_map_group_atomic"(jsonb, jsonb) FROM PUBLIC';
  EXECUTE 'GRANT EXECUTE ON FUNCTION erp_procurement."save_so_map_group_atomic"(jsonb, jsonb) TO service_role';
END;
$migration$;
