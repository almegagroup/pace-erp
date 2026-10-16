/*
 * Historical procurement v2: 24-month analytical window plus a durable,
 * source-lineaged Product_Data_Base reference snapshot.  This migration never
 * writes erp_procurement, inventory, stock, GRN, invoice or GL tables.
 *
 * Procurement analytical period: 2024-09-01 through 2026-08-31 inclusive.
 * The Production / FG Dispatch cutover is intentionally not changed here.
 */
BEGIN;

ALTER TABLE erp_history.import_batch
  DROP CONSTRAINT IF EXISTS import_batch_record_kind_check;
ALTER TABLE erp_history.import_batch
  ADD CONSTRAINT import_batch_record_kind_check
  CHECK (record_kind IN ('PRODUCTION', 'FG_DISPATCH', 'PURCHASE_ORDER', 'CONSIGNMENT_MOVEMENT', 'PRODUCT_REFERENCE_SNAPSHOT'));

ALTER TABLE erp_history.import_exception
  DROP CONSTRAINT IF EXISTS import_exception_record_kind_check;
ALTER TABLE erp_history.import_exception
  ADD CONSTRAINT import_exception_record_kind_check
  CHECK (record_kind IN ('PRODUCTION', 'FG_DISPATCH', 'PURCHASE_ORDER', 'CONSIGNMENT_MOVEMENT', 'PRODUCT_REFERENCE_SNAPSHOT'));

ALTER TABLE erp_history.purchase_order
  ADD COLUMN IF NOT EXISTS analytical_window_included boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS dependency_outside_window boolean NOT NULL DEFAULT false;
ALTER TABLE erp_history.purchase_order_line
  ADD COLUMN IF NOT EXISTS analytical_window_included boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS dependency_outside_window boolean NOT NULL DEFAULT false;
ALTER TABLE erp_history.consignment_movement
  ADD COLUMN IF NOT EXISTS analytical_event_date date NULL,
  ADD COLUMN IF NOT EXISTS analytical_window_included boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS invoice_date date NULL,
  ADD COLUMN IF NOT EXISTS boe_number text NULL,
  ADD COLUMN IF NOT EXISTS lr_number text NULL;

CREATE INDEX IF NOT EXISTS ix_history_movement_analytics_window
  ON erp_history.consignment_movement (company_id, analytical_event_date, purchase_order_line_id)
  WHERE analytical_window_included AND validation_status = 'VALIDATED' AND NOT cancellation_flag;

CREATE TABLE IF NOT EXISTS erp_history.product_reference_snapshot (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                 uuid NOT NULL REFERENCES erp_master.companies(id) ON DELETE RESTRICT,
  first_import_batch_id      uuid NOT NULL REFERENCES erp_history.import_batch(id) ON DELETE RESTRICT,
  last_import_batch_id       uuid NOT NULL REFERENCES erp_history.import_batch(id) ON DELETE RESTRICT,
  source_system              text NOT NULL,
  source_file_key            text NOT NULL,
  source_file_name           text NULL,
  source_sheet_name          text NOT NULL,
  source_row_number          integer NOT NULL CHECK (source_row_number > 0),
  source_record_key          text NOT NULL CHECK (btrim(source_record_key) <> ''),
  source_extracted_at        timestamptz NOT NULL,
  snapshot_kind              text NOT NULL DEFAULT 'UNDATED_CURRENT_REFERENCE'
                             CHECK (snapshot_kind = 'UNDATED_CURRENT_REFERENCE'),
  supplier_name              text NULL,
  vendor_code                text NULL,
  vendor_id                  uuid NULL REFERENCES erp_master.vendor_master(id) ON DELETE RESTRICT,
  item_name                  text NULL,
  item_category              text NULL,
  item_type                  text NULL,
  material_code              text NULL,
  material_id                uuid NULL REFERENCES erp_master.material_master(id) ON DELETE RESTRICT,
  source_uom                 text NULL,
  supply_type                text NULL CHECK (supply_type IS NULL OR supply_type IN ('LOCAL', 'IMPORT')),
  source_prefix              text NULL,
  source_lead_time_defaults  jsonb NOT NULL DEFAULT '{}'::jsonb,
  validation_status          text NOT NULL DEFAULT 'VALIDATED'
                             CHECK (validation_status IN ('VALIDATED', 'UNMAPPED', 'QUARANTINED')),
  source_payload             jsonb NOT NULL DEFAULT '{}'::jsonb,
  validation_metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_revision_count      integer NOT NULL DEFAULT 1 CHECK (source_revision_count >= 1),
  imported_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_history_product_reference_identity
    UNIQUE (company_id, source_system, source_file_key, source_sheet_name, source_record_key)
);
CREATE INDEX IF NOT EXISTS ix_history_product_reference_company_material
  ON erp_history.product_reference_snapshot (company_id, material_id, source_extracted_at DESC);
CREATE INDEX IF NOT EXISTS ix_history_product_reference_company_vendor
  ON erp_history.product_reference_snapshot (company_id, vendor_id, source_extracted_at DESC);

DROP TRIGGER IF EXISTS trg_history_product_reference_preserve_origin ON erp_history.product_reference_snapshot;
CREATE TRIGGER trg_history_product_reference_preserve_origin
  BEFORE UPDATE ON erp_history.product_reference_snapshot
  FOR EACH ROW EXECUTE FUNCTION erp_history.preserve_procurement_import_origin();
ALTER TABLE erp_history.product_reference_snapshot ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON erp_history.product_reference_snapshot FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON erp_history.product_reference_snapshot TO service_role;

/*
 * Keep the proven atomic importer as the one write foundation.  The wrapper
 * retains its validation/upsert/linkage behaviour, adds snapshot handling and
 * derives analytical-window flags after the same transaction has committed
 * its history-only rows.  It is deliberately not a new import system.
 */
ALTER FUNCTION public.import_historical_procurement(jsonb, uuid, boolean)
  RENAME TO import_historical_procurement_base_v1;

CREATE OR REPLACE FUNCTION public.import_historical_procurement(p_request jsonb, p_actor uuid, p_dry_run boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, erp_history, erp_master, pg_temp
AS $fn$
DECLARE
  v_company uuid;
  v_system text := coalesce(nullif(btrim(p_request->>'source_system'), ''), 'GOOGLE_SHEETS');
  v_file text := nullif(btrim(p_request->>'source_file_key'), '');
  v_file_name text := nullif(btrim(p_request->>'source_file_name'), '');
  v_sheet text := nullif(btrim(p_request->>'source_sheet_name'), '');
  v_checksum text := nullif(btrim(p_request->>'checksum'), '');
  v_extracted_at timestamptz;
  v_headers jsonb := coalesce(p_request->'purchase_orders', '[]'::jsonb);
  v_lines jsonb := coalesce(p_request->'purchase_order_lines', '[]'::jsonb);
  v_moves jsonb := coalesce(p_request->'consignment_movements', '[]'::jsonb);
  v_refs jsonb := coalesce(p_request->'product_reference_snapshots', '[]'::jsonb);
  v_normal_count integer;
  v_total integer;
  v_base_request jsonb;
  v_base_result jsonb := '{}'::jsonb;
  v_base_summary jsonb := '{}'::jsonb;
  v_base_issues jsonb := '[]'::jsonb;
  v_ref_issues jsonb := '[]'::jsonb;
  v_issues jsonb := '[]'::jsonb;
  v_error_count integer := 0;
  v_warning_count integer := 0;
  v_error_rows integer := 0;
  v_warning_rows integer := 0;
  v_unmapped_rows integer := 0;
  v_quarantined_rows integer := 0;
  v_validated_rows integer := 0;
  v_batch uuid;
  v_existing uuid;
  v_status text;
  v_uom_totals jsonb := '{}'::jsonb;
BEGIN
  BEGIN
    v_company := nullif(p_request->>'company_id', '')::uuid;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'HISTORY_IMPORT_INVALID: company_id is not a valid id';
  END;
  IF v_company IS NULL OR NOT EXISTS (SELECT 1 FROM erp_master.companies WHERE id = v_company) THEN
    RAISE EXCEPTION 'HISTORY_IMPORT_INVALID: company_id is required and must exist';
  END IF;
  IF p_actor IS NULL THEN RAISE EXCEPTION 'HISTORY_IMPORT_INVALID: actor is required'; END IF;
  IF v_file IS NULL OR v_sheet IS NULL THEN
    RAISE EXCEPTION 'HISTORY_IMPORT_INVALID: source_file_key and source_sheet_name are required';
  END IF;
  IF jsonb_typeof(v_headers) <> 'array' OR jsonb_typeof(v_lines) <> 'array'
     OR jsonb_typeof(v_moves) <> 'array' OR jsonb_typeof(v_refs) <> 'array' THEN
    RAISE EXCEPTION 'HISTORY_IMPORT_INVALID: purchase_orders, purchase_order_lines, consignment_movements and product_reference_snapshots must be arrays';
  END IF;
  v_normal_count := jsonb_array_length(v_headers) + jsonb_array_length(v_lines) + jsonb_array_length(v_moves);
  v_total := v_normal_count + jsonb_array_length(v_refs);
  IF v_total < 1 OR v_total > 500 THEN
    RAISE EXCEPTION 'HISTORY_IMPORT_BATCH_SIZE: send between 1 and 500 combined records per request (got %)', v_total;
  END IF;

  BEGIN
    v_extracted_at := nullif(btrim(p_request->>'source_extracted_at'), '')::timestamptz;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'HISTORY_IMPORT_INVALID: source_extracted_at must be an ISO timestamp when supplied';
  END;

  DROP TABLE IF EXISTS hp2_ref_issue, hp2_ref;
  CREATE TEMP TABLE hp2_ref_issue (
    record_kind text NOT NULL, row_no integer NULL, record_key text NULL,
    severity text NOT NULL, code text NOT NULL, message text NOT NULL, payload jsonb NOT NULL
  ) ON COMMIT DROP;
  CREATE TEMP TABLE hp2_ref ON COMMIT DROP AS
  SELECT e.ord::integer AS idx,
         CASE WHEN (e.v->>'source_row_number') ~ '^[0-9]+$' AND (e.v->>'source_row_number')::bigint BETWEEN 1 AND 2147483647
           THEN (e.v->>'source_row_number')::integer END AS row_no,
         nullif(btrim(e.v->>'source_record_key'), '') AS record_key,
         nullif(btrim(e.v->>'supplier_name'), '') AS supplier_name,
         nullif(btrim(e.v->>'vendor_code'), '') AS vendor_code,
         NULL::uuid AS vendor_id,
         nullif(btrim(e.v->>'item_name'), '') AS item_name,
         nullif(btrim(e.v->>'item_category'), '') AS item_category,
         nullif(btrim(e.v->>'item_type'), '') AS item_type,
         nullif(btrim(e.v->>'material_code'), '') AS material_code,
         NULL::uuid AS material_id,
         0::integer AS material_match_count,
         upper(nullif(btrim(e.v->>'source_uom'), '')) AS source_uom,
         upper(nullif(btrim(e.v->>'supply_type'), '')) AS supply_raw,
         CASE upper(nullif(btrim(e.v->>'supply_type'), '')) WHEN 'LOCAL' THEN 'LOCAL' WHEN 'DOMESTIC' THEN 'LOCAL' WHEN 'IMPORT' THEN 'IMPORT' END AS supply_type,
         nullif(btrim(e.v->>'source_prefix'), '') AS source_prefix,
         coalesce(e.v->'source_lead_time_defaults', '{}'::jsonb) AS source_lead_time_defaults,
         'VALIDATED'::text AS validation_status,
         e.v AS payload
  FROM jsonb_array_elements(v_refs) WITH ORDINALITY AS e(v, ord);

  INSERT INTO hp2_ref_issue
    SELECT 'PRODUCT_REFERENCE_SNAPSHOT', row_no, record_key, 'ERROR', 'HISTORY_SOURCE_ROW_REQUIRED',
           'source_row_number must be a positive integer.', payload
    FROM hp2_ref WHERE row_no IS NULL;
  INSERT INTO hp2_ref_issue
    SELECT 'PRODUCT_REFERENCE_SNAPSHOT', row_no, record_key, 'ERROR', 'HISTORY_SOURCE_RECORD_KEY_REQUIRED',
           'source_record_key is required for a stable Product Database snapshot identity.', payload
    FROM hp2_ref WHERE record_key IS NULL;
  INSERT INTO hp2_ref_issue
    SELECT 'PRODUCT_REFERENCE_SNAPSHOT', r.row_no, r.record_key, 'ERROR', 'HISTORY_SNAPSHOT_DUPLICATE_IN_BATCH',
           'The same Product Database source_record_key appears more than once in this request.', r.payload
    FROM hp2_ref r WHERE r.record_key IS NOT NULL
      AND (SELECT count(*) FROM hp2_ref x WHERE x.record_key = r.record_key) > 1;
  IF jsonb_array_length(v_refs) > 0 AND v_extracted_at IS NULL THEN
    INSERT INTO hp2_ref_issue
      SELECT 'PRODUCT_REFERENCE_SNAPSHOT', row_no, record_key, 'ERROR', 'HISTORY_SNAPSHOT_TIMESTAMP_REQUIRED',
             'source_extracted_at is required: Product_Data_Base is an undated current reference snapshot, not historical proof.', payload
      FROM hp2_ref;
  END IF;
  INSERT INTO hp2_ref_issue
    SELECT 'PRODUCT_REFERENCE_SNAPSHOT', row_no, record_key, 'ERROR', 'HISTORY_RAW_ID_NOT_ACCEPTED',
           'Send vendor_code/material_code, not ids; all mappings are resolved by the server.', payload
    FROM hp2_ref WHERE payload ? 'vendor_id' OR payload ? 'material_id';
  INSERT INTO hp2_ref_issue
    SELECT 'PRODUCT_REFERENCE_SNAPSHOT', row_no, record_key, 'ERROR', 'HISTORY_SUPPLY_TYPE_INVALID',
           'supply_type must be LOCAL, DOMESTIC or IMPORT when supplied.', payload
    FROM hp2_ref WHERE supply_raw IS NOT NULL AND supply_type IS NULL;

  UPDATE hp2_ref r SET vendor_id = v.id
  FROM erp_master.vendor_master v
  JOIN erp_master.vendor_company_map vc ON vc.vendor_id = v.id AND vc.company_id = v_company AND vc.active
  WHERE r.vendor_code IS NOT NULL AND v.vendor_code = r.vendor_code;
  INSERT INTO hp2_ref_issue
    SELECT 'PRODUCT_REFERENCE_SNAPSHOT', row_no, record_key, 'ERROR', 'HISTORY_VENDOR_NOT_FOUND',
           'vendor_code ' || vendor_code || ' is not an active vendor of this company.', payload
    FROM hp2_ref WHERE vendor_code IS NOT NULL AND vendor_id IS NULL;
  UPDATE hp2_ref SET validation_status = 'UNMAPPED'
   WHERE vendor_code IS NULL AND supplier_name IS NOT NULL;
  INSERT INTO hp2_ref_issue
    SELECT 'PRODUCT_REFERENCE_SNAPSHOT', row_no, record_key, 'WARNING', 'HISTORY_VENDOR_UNMAPPED',
           'Supplier has no verified vendor_code; original supplier identity is preserved without creating a live vendor.', payload
    FROM hp2_ref WHERE vendor_code IS NULL AND supplier_name IS NOT NULL;

  UPDATE hp2_ref r
     SET material_match_count = m.cnt,
         material_id = CASE WHEN m.cnt = 1 THEN m.one END
    FROM (
      SELECT r2.idx, count(*)::integer AS cnt, (array_agg(mm.material_id))[1] AS one
      FROM hp2_ref r2 CROSS JOIN LATERAL erp_history.company_material_matches(v_company, r2.material_code, true) mm
      GROUP BY r2.idx
    ) m
   WHERE m.idx = r.idx;
  INSERT INTO hp2_ref_issue
    SELECT 'PRODUCT_REFERENCE_SNAPSHOT', row_no, record_key, 'ERROR', 'HISTORY_MATERIAL_AMBIGUOUS',
           'material_code ' || material_code || ' has more than one exact active company-eligible match.', payload
    FROM hp2_ref WHERE material_match_count > 1;
  UPDATE hp2_ref SET validation_status = 'UNMAPPED'
   WHERE material_id IS NULL AND material_match_count <= 1;
  INSERT INTO hp2_ref_issue
    SELECT 'PRODUCT_REFERENCE_SNAPSHOT', row_no, record_key, 'WARNING', 'HISTORY_MATERIAL_UNMAPPED',
           CASE WHEN material_code IS NULL THEN 'No material_code supplied; original item identity is preserved as unmapped.'
             ELSE 'material_code ' || material_code || ' has no exact active company-eligible match; no live material is created.' END,
           payload
    FROM hp2_ref WHERE material_id IS NULL AND material_match_count = 0;

  /* A schedule is not an actual event: retain the row, but make exclusion reviewable. */
  INSERT INTO hp2_ref_issue
    SELECT 'CONSIGNMENT_MOVEMENT',
      CASE WHEN (e.v->>'source_row_number') ~ '^[0-9]+$' THEN (e.v->>'source_row_number')::integer END,
      nullif(btrim(e.v->>'source_record_key'), ''), 'WARNING', 'HISTORY_MOVEMENT_EVENT_DATE_MISSING',
      'No actual movement event date (dispatch/ATD/ATA/BOE/LR/inward) was supplied; scheduled ETD/ETA is not substituted.', e.v
    FROM jsonb_array_elements(v_moves) e(v)
    WHERE coalesce(lower(nullif(btrim(e.v->>'cancellation_flag'), '')), 'false') <> 'true'
      AND nullif(btrim(e.v->>'dispatch_date'), '') IS NULL
      AND nullif(btrim(e.v->>'atd_date'), '') IS NULL
      AND nullif(btrim(e.v->>'ata_port_date'), '') IS NULL
      AND nullif(btrim(e.v->>'boe_date'), '') IS NULL
      AND nullif(btrim(e.v->>'lr_date'), '') IS NULL
      AND nullif(btrim(e.v->>'inward_date'), '') IS NULL;
  INSERT INTO hp2_ref_issue
    SELECT 'CONSIGNMENT_MOVEMENT',
      CASE WHEN (e.v->>'source_row_number') ~ '^[0-9]+$' THEN (e.v->>'source_row_number')::integer END,
      nullif(btrim(e.v->>'source_record_key'), ''), 'WARNING', 'HISTORY_PROCUREMENT_OUTSIDE_WINDOW',
      'Actual movement event is outside 2024-09-01 through 2026-08-31; retained for audit but excluded from procurement analytics.', e.v
    FROM jsonb_array_elements(v_moves) e(v)
    WHERE erp_history.try_date(coalesce(
      nullif(btrim(e.v->>'inward_date'), ''), nullif(btrim(e.v->>'lr_date'), ''), nullif(btrim(e.v->>'boe_date'), ''),
      nullif(btrim(e.v->>'ata_port_date'), ''), nullif(btrim(e.v->>'atd_date'), ''), nullif(btrim(e.v->>'dispatch_date'), '')
    )) IS NOT NULL
    AND erp_history.try_date(coalesce(
      nullif(btrim(e.v->>'inward_date'), ''), nullif(btrim(e.v->>'lr_date'), ''), nullif(btrim(e.v->>'boe_date'), ''),
      nullif(btrim(e.v->>'ata_port_date'), ''), nullif(btrim(e.v->>'atd_date'), ''), nullif(btrim(e.v->>'dispatch_date'), '')
    )) NOT BETWEEN DATE '2024-09-01' AND DATE '2026-08-31';
  INSERT INTO hp2_ref_issue
    SELECT 'CONSIGNMENT_MOVEMENT',
      CASE WHEN (e.v->>'source_row_number') ~ '^[0-9]+$' THEN (e.v->>'source_row_number')::integer END,
      nullif(btrim(e.v->>'source_record_key'), ''), 'ERROR', 'HISTORY_DATE_INVALID',
      'invoice_date must be a real YYYY-MM-DD date.', e.v
    FROM jsonb_array_elements(v_moves) e(v)
    WHERE nullif(btrim(e.v->>'invoice_date'), '') IS NOT NULL
      AND erp_history.try_date(nullif(btrim(e.v->>'invoice_date'), '')) IS NULL;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'record_kind', record_kind, 'source_row_number', row_no, 'record_key', record_key,
    'severity', severity, 'code', code, 'message', message
  ) ORDER BY row_no, code), '[]'::jsonb)
  INTO v_ref_issues FROM hp2_ref_issue;

  /* Run the pre-existing atomic validation first, even for a commit request. */
  IF v_normal_count > 0 THEN
    v_base_request := p_request - 'product_reference_snapshots';
    v_base_result := public.import_historical_procurement_base_v1(v_base_request, p_actor, true);
    v_base_summary := coalesce(v_base_result->'summary', '{}'::jsonb);
    v_base_issues := coalesce(v_base_result->'issues', '[]'::jsonb);
  END IF;
  v_issues := v_base_issues || v_ref_issues;

  SELECT count(*) FILTER (WHERE severity = 'ERROR'), count(*) FILTER (WHERE severity = 'WARNING'),
         count(DISTINCT CASE WHEN severity = 'ERROR' THEN coalesce(record_kind, '') || ':' || coalesce(source_row_number::text, record_key, '') END),
         count(DISTINCT CASE WHEN severity = 'WARNING' THEN coalesce(record_kind, '') || ':' || coalesce(source_row_number::text, record_key, '') END),
         count(DISTINCT CASE WHEN code IN ('HISTORY_VENDOR_UNMAPPED', 'HISTORY_MATERIAL_UNMAPPED') THEN coalesce(record_kind, '') || ':' || coalesce(source_row_number::text, record_key, '') END),
         count(DISTINCT CASE WHEN code IN ('HISTORY_UOM_CONVERSION_MISSING', 'HISTORY_MOVEMENT_EVENT_DATE_MISSING') THEN coalesce(record_kind, '') || ':' || coalesce(source_row_number::text, record_key, '') END)
    INTO v_error_count, v_warning_count, v_error_rows, v_warning_rows, v_unmapped_rows, v_quarantined_rows
  FROM jsonb_to_recordset(v_issues) AS i(record_kind text, source_row_number integer, record_key text, severity text, code text, message text);
  -- A row with any warning/error is not reported as analytically validated.
  -- Count the union once: a row carrying both an error and a warning must not
  -- be subtracted twice from the submitted-record total.
  SELECT greatest(0, v_total - count(DISTINCT coalesce(record_kind, '') || ':' || coalesce(source_row_number::text, record_key, '')))
    INTO v_validated_rows
  FROM jsonb_to_recordset(v_issues) AS i(record_kind text, source_row_number integer, record_key text, severity text, code text, message text)
  WHERE severity IN ('ERROR', 'WARNING');

  SELECT coalesce(jsonb_object_agg(uom, quantity), '{}'::jsonb) INTO v_uom_totals
  FROM (
    SELECT uom, sum(quantity) AS quantity
    FROM (
      SELECT upper(nullif(btrim(value->>'original_uom'), '')) AS uom,
             erp_history.try_numeric(coalesce(value->>'original_quantity', value->>'quantity')) AS quantity
      FROM jsonb_array_elements(v_lines || v_moves) value
    ) quantity_rows
    WHERE uom IS NOT NULL AND quantity IS NOT NULL
    GROUP BY uom
  ) u;

  v_base_summary := v_base_summary || jsonb_build_object(
    'submitted_count', v_total,
    'stored_count', CASE WHEN p_dry_run OR v_error_count > 0 THEN 0 ELSE v_total END,
    'validated_count', v_validated_rows,
    'unmapped_count', v_unmapped_rows,
    'quarantined_count', v_quarantined_rows,
    'error_count', v_error_count,
    'warning_count', v_warning_count,
    'quantities_by_uom', v_uom_totals,
    'product_reference_snapshots', jsonb_array_length(v_refs),
    'procurement_window', jsonb_build_object('from', '2024-09-01', 'to', '2026-08-31')
  );

  IF p_dry_run OR v_error_count > 0 OR (v_normal_count > 0 AND coalesce((v_base_result->>'committable')::boolean, false) = false) THEN
    RETURN jsonb_build_object('dry_run', p_dry_run, 'committed', false,
      'committable', v_error_count = 0 AND coalesce((v_base_result->>'committable')::boolean, true),
      'summary', v_base_summary, 'issues', v_issues, 'reconciliation', jsonb_build_object('source', 'HISTORICAL'));
  END IF;

  IF v_normal_count > 0 THEN
    v_base_result := public.import_historical_procurement_base_v1(v_base_request, p_actor, false);
    IF coalesce((v_base_result->>'idempotent_replay')::boolean, false) THEN
      RETURN v_base_result || jsonb_build_object('summary', v_base_summary, 'issues', v_issues, 'checksum', v_checksum);
    END IF;
    v_batch := nullif(v_base_result->>'batch_id', '')::uuid;
    v_status := coalesce(v_base_result->>'status', 'COMMITTED');
  ELSE
    IF v_checksum IS NOT NULL THEN
      SELECT id INTO v_existing FROM erp_history.import_batch
       WHERE company_id = v_company AND record_kind = 'PRODUCT_REFERENCE_SNAPSHOT' AND source_checksum = v_checksum
         AND status IN ('COMMITTED', 'COMMITTED_WITH_EXCEPTIONS')
       ORDER BY created_at DESC LIMIT 1;
      IF v_existing IS NOT NULL THEN
        RETURN jsonb_build_object('dry_run', false, 'committed', true, 'idempotent_replay', true,
          'batch_id', v_existing, 'status', 'COMMITTED', 'summary', v_base_summary, 'issues', v_issues, 'checksum', v_checksum);
      END IF;
    END IF;
    INSERT INTO erp_history.import_batch (company_id, record_kind, source_system, source_file_key, source_file_name,
      source_sheet_name, source_checksum, status, submitted_row_count, created_by, reconciliation)
    VALUES (v_company, 'PRODUCT_REFERENCE_SNAPSHOT', v_system, v_file, v_file_name, v_sheet, v_checksum,
      'COMMITTING', v_total, p_actor, v_base_summary)
    RETURNING id INTO v_batch;
    v_status := 'COMMITTED';
  END IF;

  IF jsonb_array_length(v_refs) > 0 THEN
    INSERT INTO erp_history.product_reference_snapshot AS t (
      company_id, first_import_batch_id, last_import_batch_id, source_system, source_file_key, source_file_name,
      source_sheet_name, source_row_number, source_record_key, source_extracted_at, supplier_name, vendor_code,
      vendor_id, item_name, item_category, item_type, material_code, material_id, source_uom, supply_type,
      source_prefix, source_lead_time_defaults, validation_status, source_payload, validation_metadata
    )
    SELECT v_company, v_batch, v_batch, v_system, v_file, v_file_name, v_sheet, row_no, record_key, v_extracted_at,
      supplier_name, vendor_code, vendor_id, item_name, item_category, item_type, material_code, material_id,
      source_uom, supply_type, source_prefix, source_lead_time_defaults, validation_status, payload,
      jsonb_build_object('snapshot_kind', 'UNDATED_CURRENT_REFERENCE', 'source_extracted_at', v_extracted_at)
    FROM hp2_ref
    ON CONFLICT (company_id, source_system, source_file_key, source_sheet_name, source_record_key) DO UPDATE SET
      last_import_batch_id = EXCLUDED.last_import_batch_id, source_file_name = EXCLUDED.source_file_name,
      source_row_number = EXCLUDED.source_row_number, source_extracted_at = EXCLUDED.source_extracted_at,
      supplier_name = EXCLUDED.supplier_name, vendor_code = EXCLUDED.vendor_code, vendor_id = EXCLUDED.vendor_id,
      item_name = EXCLUDED.item_name, item_category = EXCLUDED.item_category, item_type = EXCLUDED.item_type,
      material_code = EXCLUDED.material_code, material_id = EXCLUDED.material_id, source_uom = EXCLUDED.source_uom,
      supply_type = EXCLUDED.supply_type, source_prefix = EXCLUDED.source_prefix,
      source_lead_time_defaults = EXCLUDED.source_lead_time_defaults, validation_status = EXCLUDED.validation_status,
      source_payload = EXCLUDED.source_payload, validation_metadata = EXCLUDED.validation_metadata;
  END IF;

  IF v_normal_count > 0 THEN
    -- Keep source facts for rows without an actual business event, but make
    -- their exclusion explicit and reversible on corrective re-import.
    UPDATE erp_history.consignment_movement m
       SET validation_status = 'QUARANTINED'
     WHERE m.company_id = v_company AND m.source_system = v_system
       AND NOT m.cancellation_flag
       AND coalesce(m.inward_date, m.lr_date, m.boe_date, m.ata_port_date, m.atd_date, m.dispatch_date) IS NULL;

    UPDATE erp_history.consignment_movement m
       SET analytical_event_date = coalesce(m.inward_date, m.lr_date, m.boe_date, m.ata_port_date, m.atd_date, m.dispatch_date),
           analytical_window_included = m.validation_status = 'VALIDATED' AND NOT m.cancellation_flag
             AND coalesce(m.inward_date, m.lr_date, m.boe_date, m.ata_port_date, m.atd_date, m.dispatch_date)
                 BETWEEN DATE '2024-09-01' AND DATE '2026-08-31',
           invoice_date = coalesce(m.invoice_date, erp_history.try_date(nullif(btrim(m.source_payload->>'invoice_date'), ''))),
           boe_number = coalesce(m.boe_number, nullif(btrim(m.source_payload->>'boe_number'), '')),
           lr_number = coalesce(m.lr_number, nullif(btrim(m.source_payload->>'lr_number'), ''))
     WHERE m.company_id = v_company AND m.source_system = v_system;

    UPDATE erp_history.purchase_order_line l
       SET analytical_window_included = EXISTS (
             SELECT 1 FROM erp_history.purchase_order p
             WHERE p.id = l.purchase_order_id
               AND p.order_date BETWEEN DATE '2024-09-01' AND DATE '2026-08-31'
           ) OR EXISTS (
             SELECT 1 FROM erp_history.consignment_movement m
             WHERE m.purchase_order_line_id = l.id AND m.analytical_window_included
           ),
           dependency_outside_window = EXISTS (
             SELECT 1 FROM erp_history.consignment_movement m
             WHERE m.purchase_order_line_id = l.id AND m.analytical_window_included
           ) AND NOT EXISTS (
             SELECT 1 FROM erp_history.purchase_order p
             WHERE p.id = l.purchase_order_id AND p.order_date BETWEEN DATE '2024-09-01' AND DATE '2026-08-31'
           )
     WHERE l.company_id = v_company AND l.source_system = v_system;

    UPDATE erp_history.purchase_order p
       SET analytical_window_included = p.order_date BETWEEN DATE '2024-09-01' AND DATE '2026-08-31',
           dependency_outside_window = NOT (p.order_date BETWEEN DATE '2024-09-01' AND DATE '2026-08-31')
             AND EXISTS (
               SELECT 1 FROM erp_history.purchase_order_line l
               WHERE l.purchase_order_id = p.id AND l.analytical_window_included
             )
     WHERE p.company_id = v_company AND p.source_system = v_system;

  END IF;

  INSERT INTO erp_history.import_exception (import_batch_id, company_id, record_kind, source_file_key, source_sheet_name,
    source_row_number, source_line_key, exception_code, exception_message, source_payload, validation_metadata)
  SELECT v_batch, v_company, record_kind, v_file, v_sheet, row_no, coalesce(record_key, ''), code, message, payload,
    jsonb_build_object('severity', severity)
  FROM hp2_ref_issue WHERE severity = 'WARNING';

  IF v_normal_count = 0 THEN
    UPDATE erp_history.import_batch
       SET status = CASE WHEN v_warning_count > 0 THEN 'COMMITTED_WITH_EXCEPTIONS' ELSE 'COMMITTED' END,
           imported_row_count = v_total, exception_row_count = v_warning_count,
           committed_at = now(), reconciliation = v_base_summary
     WHERE id = v_batch;
    v_status := CASE WHEN v_warning_count > 0 THEN 'COMMITTED_WITH_EXCEPTIONS' ELSE 'COMMITTED' END;
  ELSE
    UPDATE erp_history.import_batch
       SET status = CASE WHEN v_warning_count > 0 THEN 'COMMITTED_WITH_EXCEPTIONS' ELSE status END,
           exception_row_count = greatest(exception_row_count, v_warning_count),
           reconciliation = coalesce(reconciliation, '{}'::jsonb) || v_base_summary
     WHERE id = v_batch;
    IF v_warning_count > 0 THEN v_status := 'COMMITTED_WITH_EXCEPTIONS'; END IF;
  END IF;

  RETURN jsonb_build_object('dry_run', false, 'committed', true, 'idempotent_replay', false,
    'batch_id', v_batch, 'status', v_status, 'summary', v_base_summary, 'issues', v_issues,
    'checksum', v_checksum, 'reconciliation', jsonb_build_object('source', 'HISTORICAL', 'live_supply_affected', false));
END
$fn$;

/* Lead-time samples are historical evidence only and only use in-window actual events. */
CREATE OR REPLACE FUNCTION public.history_lead_time_samples(p_company_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = pg_catalog, erp_history
AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'vendor_id', p.vendor_id, 'material_id', pl.material_id,
    'supply_type', coalesce(m.supply_type, p.supply_type), 'order_date', p.order_date,
    'dispatch_date', m.dispatch_date, 'etd_date', m.etd_date, 'atd_date', m.atd_date,
    'eta_port_date', m.eta_port_date, 'ata_port_date', m.ata_port_date, 'boe_date', m.boe_date,
    'lr_date', m.lr_date, 'inward_date', m.inward_date,
    'analytical_event_date', m.analytical_event_date, 'source', 'HISTORICAL'
  )), '[]'::jsonb)
  FROM erp_history.consignment_movement m
  JOIN erp_history.purchase_order_line pl ON pl.id = m.purchase_order_line_id
  JOIN erp_history.purchase_order p ON p.id = pl.purchase_order_id
  WHERE m.company_id = p_company_id AND m.analytical_window_included
    AND m.validation_status = 'VALIDATED' AND NOT m.cancellation_flag
    AND p.validation_status IN ('VALIDATED', 'UNMAPPED') AND NOT p.cancellation_flag;
$$;

REVOKE ALL ON FUNCTION public.import_historical_procurement_base_v1(jsonb, uuid, boolean),
  public.import_historical_procurement(jsonb, uuid, boolean), public.history_lead_time_samples(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_historical_procurement_base_v1(jsonb, uuid, boolean),
  public.import_historical_procurement(jsonb, uuid, boolean), public.history_lead_time_samples(uuid) TO service_role;

COMMIT;
