-- P0 Bulk DO submission safety.  This migration intentionally contains one
-- top-level DO statement because the deployment CLI applies migration text as
-- a prepared statement.  The group row and its Delivery Order are written by
-- one database transaction: an uncertain HTTP response can therefore always
-- be reconciled without re-creating a successfully committed DO.
DO $migration$
BEGIN
  EXECUTE $ddl$
    CREATE TABLE IF NOT EXISTS erp_procurement.bulk_do_submission (
      id uuid PRIMARY KEY,
      company_id uuid NOT NULL,
      submitted_by uuid NOT NULL,
      status text NOT NULL DEFAULT 'PROCESSING'
        CHECK (status IN ('PROCESSING', 'COMPLETED', 'PARTIAL', 'FAILED')),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  $ddl$;

  EXECUTE $ddl$
    CREATE TABLE IF NOT EXISTS erp_procurement.bulk_do_submission_group (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      submission_id uuid NOT NULL REFERENCES erp_procurement.bulk_do_submission(id) ON DELETE RESTRICT,
      client_group_key uuid NOT NULL,
      source_reference text NOT NULL,
      payload_fingerprint text NOT NULL,
      status text NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'PROCESSING', 'CREATED', 'FAILED')),
      delivery_challan_id uuid NULL REFERENCES erp_procurement.delivery_challan(id) ON DELETE RESTRICT,
      error_code text NULL,
      attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT bulk_do_submission_group_submission_key_unique UNIQUE (submission_id, client_group_key),
      CONSTRAINT bulk_do_submission_group_created_dc_unique UNIQUE (delivery_challan_id)
    )
  $ddl$;

  EXECUTE $ddl$
    CREATE INDEX IF NOT EXISTS idx_bulk_do_submission_company_actor_updated
      ON erp_procurement.bulk_do_submission (company_id, submitted_by, updated_at DESC)
  $ddl$;
  EXECUTE $ddl$
    CREATE INDEX IF NOT EXISTS idx_bulk_do_submission_group_submission_status
      ON erp_procurement.bulk_do_submission_group (submission_id, status)
  $ddl$;

  EXECUTE 'ALTER TABLE erp_procurement.bulk_do_submission ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE erp_procurement.bulk_do_submission_group ENABLE ROW LEVEL SECURITY';
  EXECUTE 'REVOKE ALL ON TABLE erp_procurement.bulk_do_submission FROM PUBLIC';
  EXECUTE 'REVOKE ALL ON TABLE erp_procurement.bulk_do_submission_group FROM PUBLIC';
  EXECUTE 'GRANT ALL ON TABLE erp_procurement.bulk_do_submission TO service_role';
  EXECUTE 'GRANT ALL ON TABLE erp_procurement.bulk_do_submission_group TO service_role';

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
      -- A failed group has no DO association.  Its user may correct a
      -- transporter, SKU choice, or other review value and retry it under
      -- the same submission; only a completed group is immutable.
      IF v_group.payload_fingerprint <> p_payload_fingerprint THEN
        UPDATE erp_procurement.bulk_do_submission_group
        SET source_reference = p_source_reference, payload_fingerprint = p_payload_fingerprint, updated_at = now()
        WHERE id = v_group.id;
      END IF;

      UPDATE erp_procurement.bulk_do_submission_group
      SET status = 'PROCESSING', error_code = NULL, attempt_count = attempt_count + 1, updated_at = now()
      WHERE id = v_group.id;

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

        UPDATE erp_procurement.bulk_do_submission_group
        SET status = 'CREATED', delivery_challan_id = v_dc_id, error_code = NULL, updated_at = now()
        WHERE id = v_group.id;
      EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
        UPDATE erp_procurement.bulk_do_submission_group
        SET status = 'FAILED', error_code = left(coalesce(v_error, 'DO_BULK_CREATE_FAILED'), 250), updated_at = now()
        WHERE id = v_group.id;
        RETURN jsonb_build_object('status', 'FAILED', 'error_code', left(coalesce(v_error, 'DO_BULK_CREATE_FAILED'), 250));
      END;

      RETURN jsonb_build_object('status', 'CREATED', 'dc_id', v_dc_id, 'reused', false);
    END;
    $function$
  $function_sql$;
  EXECUTE $function_sql$
    CREATE OR REPLACE FUNCTION erp_procurement.record_bulk_delivery_order_submission_group_failure(
      p_submission_id uuid,
      p_group_key uuid,
      p_company_id uuid,
      p_actor uuid,
      p_source_reference text,
      p_payload_fingerprint text,
      p_error_code text
    ) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'erp_procurement', 'public'
    AS $function$
    DECLARE v_submission erp_procurement.bulk_do_submission%ROWTYPE;
    BEGIN
      INSERT INTO erp_procurement.bulk_do_submission (id, company_id, submitted_by)
      VALUES (p_submission_id, p_company_id, p_actor)
      ON CONFLICT (id) DO NOTHING;
      SELECT * INTO v_submission FROM erp_procurement.bulk_do_submission WHERE id = p_submission_id FOR UPDATE;
      IF NOT FOUND OR v_submission.company_id <> p_company_id OR v_submission.submitted_by <> p_actor THEN
        RAISE EXCEPTION 'DO_BULK_SUBMISSION_SCOPE_MISMATCH';
      END IF;
      INSERT INTO erp_procurement.bulk_do_submission_group (
        submission_id, client_group_key, source_reference, payload_fingerprint, status, error_code
      ) VALUES (
        p_submission_id, p_group_key, p_source_reference, p_payload_fingerprint, 'FAILED', left(p_error_code, 250)
      ) ON CONFLICT (submission_id, client_group_key) DO NOTHING;
      UPDATE erp_procurement.bulk_do_submission_group
      SET source_reference = p_source_reference,
          payload_fingerprint = p_payload_fingerprint,
          status = 'FAILED',
          error_code = left(p_error_code, 250),
          updated_at = now()
      WHERE submission_id = p_submission_id
        AND client_group_key = p_group_key
        AND status <> 'CREATED';
      RETURN 'FAILED';
    END;
    $function$
  $function_sql$;
  EXECUTE 'REVOKE ALL ON FUNCTION erp_procurement.save_bulk_delivery_order_submission_group_atomic(uuid, uuid, uuid, uuid, text, boolean, text, jsonb, jsonb, jsonb, jsonb) FROM PUBLIC';
  EXECUTE 'GRANT EXECUTE ON FUNCTION erp_procurement.save_bulk_delivery_order_submission_group_atomic(uuid, uuid, uuid, uuid, text, boolean, text, jsonb, jsonb, jsonb, jsonb) TO service_role';
  EXECUTE 'REVOKE ALL ON FUNCTION erp_procurement.record_bulk_delivery_order_submission_group_failure(uuid, uuid, uuid, uuid, text, text, text) FROM PUBLIC';
  EXECUTE 'GRANT EXECUTE ON FUNCTION erp_procurement.record_bulk_delivery_order_submission_group_failure(uuid, uuid, uuid, uuid, text, text, text) TO service_role';
END;
$migration$;
