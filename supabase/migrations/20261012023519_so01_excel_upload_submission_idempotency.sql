-- SO01 Excel lines need a durable, business-level idempotency record.  A
-- browser/user UUID is insufficient because another user can upload the same
-- worksheet concurrently.  The row result and the sales_order_line are
-- written by the same RPC transaction, making an uncertain response safely
-- replayable without inserting another line.
DO $migration$
BEGIN
  EXECUTE $ddl$
    CREATE TABLE IF NOT EXISTS erp_procurement.sales_order_excel_upload_result (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id uuid NOT NULL,
      payload_fingerprint text NOT NULL,
      so_id uuid NOT NULL REFERENCES erp_procurement.sales_order(id) ON DELETE RESTRICT,
      sales_order_line_id uuid NULL REFERENCES erp_procurement.sales_order_line(id) ON DELETE RESTRICT,
      status text NOT NULL DEFAULT 'PROCESSING'
        CHECK (status IN ('PROCESSING', 'CREATED', 'FAILED')),
      error_code text NULL,
      attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT sales_order_excel_upload_result_company_fingerprint_unique UNIQUE (company_id, payload_fingerprint),
      CONSTRAINT sales_order_excel_upload_result_created_line_unique UNIQUE (sales_order_line_id)
    )
  $ddl$;
  EXECUTE $ddl$
    CREATE INDEX IF NOT EXISTS idx_so_excel_upload_result_so_status
      ON erp_procurement.sales_order_excel_upload_result (so_id, status, updated_at DESC)
  $ddl$;
  EXECUTE 'ALTER TABLE erp_procurement.sales_order_excel_upload_result ENABLE ROW LEVEL SECURITY';
  EXECUTE 'REVOKE ALL ON TABLE erp_procurement.sales_order_excel_upload_result FROM PUBLIC';
  EXECUTE 'GRANT ALL ON TABLE erp_procurement.sales_order_excel_upload_result TO service_role';

  EXECUTE $function_sql$
    CREATE OR REPLACE FUNCTION erp_procurement.save_sales_order_excel_lines_atomic(
      p_company_id uuid,
      p_actor uuid,
      p_lines jsonb
    ) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'erp_procurement', 'erp_master', 'public'
    AS $function$
    DECLARE
      v_input jsonb;
      v_result erp_procurement.sales_order_excel_upload_result%ROWTYPE;
      v_so erp_procurement.sales_order%ROWTYPE;
      v_so_id uuid;
      v_line_id uuid;
      v_line_number integer;
      v_error text;
      v_results jsonb := '[]'::jsonb;
      v_success_so_ids uuid[] := ARRAY[]::uuid[];
      v_fingerprint text;
      v_row_key text;
    BEGIN
      IF jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array'
         OR jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0 THEN
        RAISE EXCEPTION 'SO_EXCEL_LINES_REQUIRED';
      END IF;

      -- Lock SOs in a deterministic order before assigning line numbers.
      -- This prevents two independent workbook submissions from reading the
      -- same max(line_number) and then racing into either duplicate data or a
      -- misleading unique-constraint failure.
      FOR v_so_id IN
        SELECT DISTINCT NULLIF(value->>'so_id', '')::uuid
        FROM jsonb_array_elements(p_lines)
        WHERE NULLIF(value->>'so_id', '') IS NOT NULL
        ORDER BY 1
      LOOP
        SELECT * INTO v_so
        FROM erp_procurement.sales_order
        WHERE id = v_so_id AND company_id = p_company_id
        FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'SO_EXCEL_SO_LOOKUP_FAILED'; END IF;
        IF v_so.status <> 'DRAFT' OR v_so.is_excel_upload IS DISTINCT FROM true THEN
          RAISE EXCEPTION 'SO_EXCEL_SO_NOT_DRAFT';
        END IF;
      END LOOP;

      FOR v_input IN SELECT value FROM jsonb_array_elements(p_lines)
      LOOP
        v_so_id := NULLIF(v_input->>'so_id', '')::uuid;
        v_fingerprint := NULLIF(v_input->>'submission_fingerprint', '');
        v_row_key := coalesce(NULLIF(v_input->>'row_key', ''), v_fingerprint, 'unknown');
        IF v_so_id IS NULL OR v_fingerprint IS NULL THEN
          RAISE EXCEPTION 'SO_EXCEL_SUBMISSION_FINGERPRINT_REQUIRED';
        END IF;

        INSERT INTO erp_procurement.sales_order_excel_upload_result (
          company_id, payload_fingerprint, so_id
        ) VALUES (p_company_id, v_fingerprint, v_so_id)
        ON CONFLICT (company_id, payload_fingerprint) DO NOTHING;

        SELECT * INTO v_result
        FROM erp_procurement.sales_order_excel_upload_result
        WHERE company_id = p_company_id AND payload_fingerprint = v_fingerprint
        FOR UPDATE;
        IF v_result.so_id <> v_so_id THEN
          RAISE EXCEPTION 'SO_EXCEL_SUBMISSION_FINGERPRINT_SCOPE_MISMATCH';
        END IF;
        IF v_result.status = 'CREATED' AND v_result.sales_order_line_id IS NOT NULL THEN
          v_results := v_results || jsonb_build_array(jsonb_build_object(
            'row_key', v_row_key, 'so_id', v_so_id, 'status', 'CREATED',
            'line_id', v_result.sales_order_line_id, 'reused', true
          ));
          v_success_so_ids := array_append(v_success_so_ids, v_so_id);
          CONTINUE;
        END IF;

        UPDATE erp_procurement.sales_order_excel_upload_result
        SET status = 'PROCESSING', error_code = NULL, attempt_count = attempt_count + 1, updated_at = now()
        WHERE id = v_result.id;

        BEGIN
          SELECT coalesce(max(line_number), 0) + 1 INTO v_line_number
          FROM erp_procurement.sales_order_line
          WHERE so_id = v_so_id;

          INSERT INTO erp_procurement.sales_order_line (
            so_id, line_number, line_material_type, material_id, manual_sku_name,
            fg_type, quantity, base_qty, pack_uom_code, pack_qty, per_pack_qty,
            rate_basis, uom_code, rate, net_rate, currency_code, gst_treatment,
            gst_rate, gst_amount, cgst_amount, sgst_amount, igst_amount,
            round_off_amount, total_value, balance_qty, hsn_code, batch_number,
            expiry_date, costing_rate_month, declared_stroke_number, packing_order_id, remarks
          ) VALUES (
            v_so_id, v_line_number, NULLIF(v_input->>'line_material_type', ''),
            NULLIF(v_input->>'material_id', '')::uuid, NULLIF(v_input->>'manual_sku_name', ''),
            NULLIF(v_input->>'fg_type', ''), (v_input->>'quantity')::numeric,
            NULLIF(v_input->>'base_qty', '')::numeric, NULLIF(v_input->>'pack_uom_code', ''),
            NULLIF(v_input->>'pack_qty', '')::numeric, NULLIF(v_input->>'per_pack_qty', '')::numeric,
            NULLIF(v_input->>'rate_basis', ''), NULLIF(v_input->>'uom_code', ''),
            (v_input->>'rate')::numeric, (v_input->>'net_rate')::numeric,
            NULLIF(v_input->>'currency_code', ''), NULLIF(v_input->>'gst_treatment', ''),
            NULLIF(v_input->>'gst_rate', '')::numeric, NULLIF(v_input->>'gst_amount', '')::numeric,
            NULLIF(v_input->>'cgst_amount', '')::numeric, NULLIF(v_input->>'sgst_amount', '')::numeric,
            NULLIF(v_input->>'igst_amount', '')::numeric, NULLIF(v_input->>'round_off_amount', '')::numeric,
            NULLIF(v_input->>'total_value', '')::numeric, (v_input->>'balance_qty')::numeric,
            NULLIF(v_input->>'hsn_code', ''), NULLIF(v_input->>'batch_number', ''),
            NULLIF(v_input->>'expiry_date', '')::date, NULLIF(v_input->>'costing_rate_month', ''),
            NULLIF(v_input->>'declared_stroke_number', ''), NULLIF(v_input->>'packing_order_id', '')::uuid,
            NULLIF(v_input->>'remarks', '')
          ) RETURNING id INTO v_line_id;

          UPDATE erp_procurement.sales_order_excel_upload_result
          SET status = 'CREATED', sales_order_line_id = v_line_id,
              error_code = NULL, updated_at = now()
          WHERE id = v_result.id;
          v_results := v_results || jsonb_build_array(jsonb_build_object(
            'row_key', v_row_key, 'so_id', v_so_id, 'status', 'CREATED',
            'line_id', v_line_id, 'reused', false
          ));
          v_success_so_ids := array_append(v_success_so_ids, v_so_id);
        EXCEPTION WHEN OTHERS THEN
          GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
          UPDATE erp_procurement.sales_order_excel_upload_result
          SET status = 'FAILED', error_code = left(coalesce(v_error, 'SO_EXCEL_LINE_INSERT_FAILED'), 250), updated_at = now()
          WHERE id = v_result.id;
          v_results := v_results || jsonb_build_array(jsonb_build_object(
            'row_key', v_row_key, 'so_id', v_so_id, 'status', 'FAILED',
            'error_code', left(coalesce(v_error, 'SO_EXCEL_LINE_INSERT_FAILED'), 250)
          ));
        END;
      END LOOP;

      UPDATE erp_procurement.sales_order
      SET excel_uploaded = true
      WHERE id = ANY(ARRAY(SELECT DISTINCT unnest(v_success_so_ids)));

      RETURN v_results;
    END;
    $function$
  $function_sql$;
  EXECUTE 'REVOKE ALL ON FUNCTION erp_procurement.save_sales_order_excel_lines_atomic(uuid, uuid, jsonb) FROM PUBLIC';
  EXECUTE 'GRANT EXECUTE ON FUNCTION erp_procurement.save_sales_order_excel_lines_atomic(uuid, uuid, jsonb) TO service_role';
END;
$migration$;
