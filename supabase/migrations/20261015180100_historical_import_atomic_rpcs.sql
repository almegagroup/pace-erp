/*
 * Migration: 20261015180100_historical_import_atomic_rpcs
 * Purpose: one transactional RPC per historical import + set-based reads.
 *   Replaces the never-applied 20261015150100_historical_procurement_atomic_import
 *   (ChatGPT, agent/chatgpt) and the multi-request Production/FG-dispatch
 *   commit (Codex) — both could leave a partially written batch.
 *
 *   public.import_historical_procurement(request, actor, dry_run)
 *   public.import_historical_operations(request, actor, dry_run)
 *       Validation runs INSIDE the function, so dry-run and commit can never
 *       disagree. ERROR issues block the whole request (nothing is written);
 *       WARNING issues are stored as exceptions and the row is kept with a
 *       non-VALIDATED status. Masters are resolved here from codes — raw
 *       vendor_id / material_id from the payload are rejected.
 *   public.history_planning_actuals(company, from, to_exclusive)
 *   public.history_lead_time_samples(company)
 *       Aggregate/collect in SQL and return jsonb (no PostgREST 1,000-row cap).
 *
 * Isolation: these functions only SELECT from live ERP tables
 * (erp_inventory / erp_production / erp_procurement / erp_master) and only
 * write to erp_history. No stock, GRN, PO, CSN, invoice or GL row is touched.
 * Security: SECURITY INVOKER, EXECUTE granted to service_role only.
 */
BEGIN;

-- ── helpers ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION erp_history.try_date(p_value text)
RETURNS date LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
BEGIN
  IF p_value IS NULL OR p_value !~ '^\d{4}-\d{2}-\d{2}$' THEN RETURN NULL; END IF;
  RETURN p_value::date;
EXCEPTION WHEN others THEN RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION erp_history.try_numeric(p_value text)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
BEGIN
  IF p_value IS NULL OR btrim(p_value) = '' THEN RETURN NULL; END IF;
  RETURN btrim(p_value)::numeric;
EXCEPTION WHEN others THEN RETURN NULL;
END $$;

-- KG = 1, MT = 1000 (ERP fixed standard); anything else must be one fixed,
-- active material conversion directly to KG. Otherwise NULL (never guessed).
CREATE OR REPLACE FUNCTION erp_history.kg_factor(p_material_id uuid, p_uom text)
RETURNS numeric LANGUAGE plpgsql STABLE SET search_path = pg_catalog, erp_master AS $$
DECLARE v_uom text := upper(btrim(coalesce(p_uom, ''))); v_factor numeric; v_count integer;
BEGIN
  IF v_uom = 'KG' THEN RETURN 1; END IF;
  IF v_uom = 'MT' THEN RETURN 1000; END IF;
  IF p_material_id IS NULL OR v_uom = '' THEN RETURN NULL; END IF;
  SELECT count(DISTINCT conversion_factor), max(conversion_factor) INTO v_count, v_factor
  FROM erp_master.material_uom_conversion
  WHERE material_id = p_material_id AND upper(from_uom_code) = v_uom AND upper(to_uom_code) = 'KG'
    AND active AND NOT coalesce(variable_conversion, false) AND conversion_factor > 0;
  RETURN CASE WHEN v_count = 1 THEN v_factor ELSE NULL END;
END $$;

-- Company-active materials whose external_code (or, when allowed, pace_code)
-- equals the code exactly. Leading zeroes are significant: text only.
CREATE OR REPLACE FUNCTION erp_history.company_material_matches(p_company_id uuid, p_code text, p_allow_pace_code boolean)
RETURNS TABLE (material_id uuid, material_type text)
LANGUAGE sql STABLE SET search_path = pg_catalog, erp_master AS $$
  SELECT DISTINCT m.id, m.material_type
  FROM erp_master.material_master m
  JOIN erp_master.material_company_ext mc ON mc.material_id = m.id AND mc.company_id = p_company_id
   AND upper(coalesce(mc.status, '')) = 'ACTIVE'
  WHERE nullif(btrim(p_code), '') IS NOT NULL
    AND (m.external_code = btrim(p_code) OR (p_allow_pace_code AND m.pace_code = btrim(p_code)));
$$;

-- ── procurement import ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.import_historical_procurement(p_request jsonb, p_actor uuid, p_dry_run boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, erp_history, erp_master, pg_temp
AS $fn$
DECLARE
  v_company  uuid;
  v_system   text := coalesce(nullif(btrim(p_request->>'source_system'), ''), 'GOOGLE_SHEETS');
  v_file     text := nullif(btrim(p_request->>'source_file_key'), '');
  v_file_nm  text := nullif(btrim(p_request->>'source_file_name'), '');
  v_sheet    text := nullif(btrim(p_request->>'source_sheet_name'), '');
  v_checksum text := nullif(btrim(p_request->>'checksum'), '');
  v_headers  jsonb := coalesce(p_request->'purchase_orders', '[]'::jsonb);
  v_lines    jsonb := coalesce(p_request->'purchase_order_lines', '[]'::jsonb);
  v_moves    jsonb := coalesce(p_request->'consignment_movements', '[]'::jsonb);
  v_total    integer;
  v_batch    uuid;
  v_existing uuid;
  v_errors   integer;
  v_warnings integer;
  v_issues   jsonb;
  v_summary  jsonb;
BEGIN
  BEGIN v_company := nullif(p_request->>'company_id', '')::uuid;
  EXCEPTION WHEN others THEN RAISE EXCEPTION 'HISTORY_IMPORT_INVALID: company_id is not a valid id'; END;
  IF v_company IS NULL OR NOT EXISTS (SELECT 1 FROM erp_master.companies WHERE id = v_company) THEN
    RAISE EXCEPTION 'HISTORY_IMPORT_INVALID: company_id is required and must exist';
  END IF;
  IF p_actor IS NULL THEN RAISE EXCEPTION 'HISTORY_IMPORT_INVALID: actor is required'; END IF;
  IF v_file IS NULL OR v_sheet IS NULL THEN
    RAISE EXCEPTION 'HISTORY_IMPORT_INVALID: source_file_key and source_sheet_name are required';
  END IF;
  IF jsonb_typeof(v_headers) <> 'array' OR jsonb_typeof(v_lines) <> 'array' OR jsonb_typeof(v_moves) <> 'array' THEN
    RAISE EXCEPTION 'HISTORY_IMPORT_INVALID: purchase_orders, purchase_order_lines and consignment_movements must be arrays';
  END IF;
  v_total := jsonb_array_length(v_headers) + jsonb_array_length(v_lines) + jsonb_array_length(v_moves);
  IF v_total < 1 OR v_total > 500 THEN
    RAISE EXCEPTION 'HISTORY_IMPORT_BATCH_SIZE: send between 1 and 500 records per request (got %)', v_total;
  END IF;

  IF NOT p_dry_run AND v_checksum IS NOT NULL THEN
    SELECT id INTO v_existing FROM erp_history.import_batch
     WHERE company_id = v_company AND record_kind = 'PURCHASE_ORDER' AND source_checksum = v_checksum
       AND status IN ('COMMITTED', 'COMMITTED_WITH_EXCEPTIONS')
     ORDER BY created_at DESC LIMIT 1;
    IF v_existing IS NOT NULL THEN
      RETURN jsonb_build_object('dry_run', false, 'committed', true, 'idempotent_replay', true, 'batch_id', v_existing);
    END IF;
  END IF;

  DROP TABLE IF EXISTS hp_issue;
  CREATE TEMP TABLE hp_issue (record text, row_no integer, record_key text, severity text, code text, message text, payload jsonb) ON COMMIT DROP;

  -- headers
  DROP TABLE IF EXISTS hp_h, hp_l, hp_m;
  CREATE TEMP TABLE hp_h ON COMMIT DROP AS
  SELECT e.ord AS idx,
         CASE WHEN (e.v->>'source_row_number') ~ '^[0-9]+$' AND (e.v->>'source_row_number')::bigint BETWEEN 1 AND 2147483647
              THEN (e.v->>'source_row_number')::integer END AS row_no,
         nullif(btrim(e.v->>'external_po_number'), '') AS po,
         nullif(btrim(e.v->>'revised_po_number'), '') AS revised,
         nullif(btrim(e.v->>'order_date'), '') AS order_date_raw,
         erp_history.try_date(nullif(btrim(e.v->>'order_date'), '')) AS order_date,
         nullif(btrim(e.v->>'supplier_name'), '') AS supplier,
         nullif(btrim(e.v->>'vendor_code'), '') AS vendor_code,
         NULL::uuid AS vendor_id,
         upper(nullif(btrim(e.v->>'supply_type'), '')) AS supply_raw,
         CASE upper(nullif(btrim(e.v->>'supply_type'), '')) WHEN 'LOCAL' THEN 'LOCAL' WHEN 'DOMESTIC' THEN 'LOCAL' WHEN 'IMPORT' THEN 'IMPORT' END AS supply,
         nullif(btrim(e.v->>'payment_terms'), '') AS payment_terms,
         nullif(btrim(e.v->>'payment_days'), '') AS payment_days_raw,
         erp_history.try_numeric(e.v->>'payment_days') AS payment_days,
         nullif(btrim(e.v->>'currency_code'), '') AS currency,
         nullif(btrim(e.v->>'original_status'), '') AS original_status,
         e.v->'cancellation_flag' AS cancelled_raw,
         'VALIDATED'::text AS vstatus,
         e.v AS payload
  FROM jsonb_array_elements(v_headers) WITH ORDINALITY AS e(v, ord);

  INSERT INTO hp_issue SELECT 'PURCHASE_ORDER', row_no, po, 'ERROR', 'HISTORY_SOURCE_ROW_REQUIRED', 'source_row_number must be a positive integer.', payload FROM hp_h WHERE row_no IS NULL;
  INSERT INTO hp_issue SELECT 'PURCHASE_ORDER', row_no, po, 'ERROR', 'HISTORY_PO_NUMBER_REQUIRED', 'external_po_number is required.', payload FROM hp_h WHERE po IS NULL;
  INSERT INTO hp_issue SELECT 'PURCHASE_ORDER', h.row_no, h.po, 'ERROR', 'HISTORY_PO_DUPLICATE_IN_BATCH', 'The same external_po_number appears more than once in this request; send one header per PO.', h.payload
    FROM hp_h h WHERE h.po IS NOT NULL AND (SELECT count(*) FROM hp_h x WHERE x.po = h.po) > 1;
  INSERT INTO hp_issue SELECT 'PURCHASE_ORDER', row_no, po, 'ERROR', 'HISTORY_DATE_INVALID', 'order_date must be a real YYYY-MM-DD date.', payload FROM hp_h WHERE order_date_raw IS NOT NULL AND order_date IS NULL;
  INSERT INTO hp_issue SELECT 'PURCHASE_ORDER', row_no, po, 'ERROR', 'HISTORY_NUMBER_INVALID', 'payment_days must be a non-negative number.', payload FROM hp_h WHERE payment_days_raw IS NOT NULL AND (payment_days IS NULL OR payment_days < 0);
  INSERT INTO hp_issue SELECT 'PURCHASE_ORDER', row_no, po, 'ERROR', 'HISTORY_SUPPLY_TYPE_INVALID', 'supply_type must be LOCAL, DOMESTIC or IMPORT.', payload FROM hp_h WHERE supply_raw IS NOT NULL AND supply IS NULL;
  INSERT INTO hp_issue SELECT 'PURCHASE_ORDER', row_no, po, 'ERROR', 'HISTORY_BOOLEAN_INVALID', 'cancellation_flag must be true or false.', payload FROM hp_h WHERE cancelled_raw IS NOT NULL AND jsonb_typeof(cancelled_raw) NOT IN ('boolean', 'null');
  INSERT INTO hp_issue SELECT 'PURCHASE_ORDER', row_no, po, 'ERROR', 'HISTORY_RAW_ID_NOT_ACCEPTED', 'Send vendor_code, not vendor_id; ids are resolved by the server.', payload FROM hp_h WHERE payload ? 'vendor_id';

  UPDATE hp_h h SET vendor_id = v.id
  FROM erp_master.vendor_master v
  JOIN erp_master.vendor_company_map vc ON vc.vendor_id = v.id AND vc.company_id = v_company AND vc.active
  WHERE h.vendor_code IS NOT NULL AND v.vendor_code = h.vendor_code;
  INSERT INTO hp_issue SELECT 'PURCHASE_ORDER', row_no, po, 'ERROR', 'HISTORY_VENDOR_NOT_FOUND', 'vendor_code ' || vendor_code || ' is not an active vendor of this company.', payload FROM hp_h WHERE vendor_code IS NOT NULL AND vendor_id IS NULL;
  UPDATE hp_h SET vstatus = 'UNMAPPED' WHERE vendor_code IS NULL AND supplier IS NOT NULL;
  INSERT INTO hp_issue SELECT 'PURCHASE_ORDER', row_no, po, 'WARNING', 'HISTORY_VENDOR_UNMAPPED', 'Supplier has no vendor_code; kept as UNMAPPED and excluded from vendor analytics.', payload FROM hp_h WHERE vendor_code IS NULL AND supplier IS NOT NULL;

  -- lines
  CREATE TEMP TABLE hp_l ON COMMIT DROP AS
  SELECT e.ord AS idx,
         CASE WHEN (e.v->>'source_row_number') ~ '^[0-9]+$' AND (e.v->>'source_row_number')::bigint BETWEEN 1 AND 2147483647
              THEN (e.v->>'source_row_number')::integer END AS row_no,
         nullif(btrim(e.v->>'external_po_number'), '') AS po,
         nullif(btrim(e.v->>'external_line_reference'), '') AS line_ref,
         nullif(btrim(e.v->>'material_code'), '') AS material_code,
         NULL::uuid AS material_id,
         0 AS match_count,
         nullif(btrim(e.v->>'item_description'), '') AS item_description,
         nullif(btrim(e.v->>'original_quantity'), '') AS qty_raw,
         erp_history.try_numeric(e.v->>'original_quantity') AS qty,
         upper(nullif(btrim(e.v->>'original_uom'), '')) AS uom,
         nullif(btrim(e.v->>'unit_rate'), '') AS rate_raw,
         erp_history.try_numeric(e.v->>'unit_rate') AS rate,
         NULL::numeric AS kg,
         NULL::uuid AS existing_po_id,
         false AS parent_in_batch,
         'VALIDATED'::text AS vstatus,
         e.v AS payload
  FROM jsonb_array_elements(v_lines) WITH ORDINALITY AS e(v, ord);

  INSERT INTO hp_issue SELECT 'PURCHASE_ORDER', row_no, line_ref, 'ERROR', 'HISTORY_SOURCE_ROW_REQUIRED', 'source_row_number must be a positive integer.', payload FROM hp_l WHERE row_no IS NULL;
  INSERT INTO hp_issue SELECT 'PURCHASE_ORDER', row_no, line_ref, 'ERROR', 'HISTORY_LINE_IDENTITY_REQUIRED', 'external_po_number and external_line_reference are required.', payload FROM hp_l WHERE po IS NULL OR line_ref IS NULL;
  INSERT INTO hp_issue SELECT 'PURCHASE_ORDER', l.row_no, l.line_ref, 'ERROR', 'HISTORY_LINE_DUPLICATE_IN_BATCH', 'The same PO + line reference appears more than once in this request.', l.payload
    FROM hp_l l WHERE l.po IS NOT NULL AND l.line_ref IS NOT NULL AND (SELECT count(*) FROM hp_l x WHERE x.po = l.po AND x.line_ref = l.line_ref) > 1;
  INSERT INTO hp_issue SELECT 'PURCHASE_ORDER', row_no, line_ref, 'ERROR', 'HISTORY_NUMBER_INVALID', 'original_quantity / unit_rate must be non-negative numbers.', payload
    FROM hp_l WHERE (qty_raw IS NOT NULL AND (qty IS NULL OR qty < 0)) OR (rate_raw IS NOT NULL AND (rate IS NULL OR rate < 0));
  INSERT INTO hp_issue SELECT 'PURCHASE_ORDER', row_no, line_ref, 'ERROR', 'HISTORY_RAW_ID_NOT_ACCEPTED', 'Send material_code, not material_id; ids are resolved by the server.', payload FROM hp_l WHERE payload ? 'material_id';

  UPDATE hp_l l SET parent_in_batch = true WHERE EXISTS (SELECT 1 FROM hp_h h WHERE h.po = l.po);
  UPDATE hp_l l SET existing_po_id = p.id FROM erp_history.purchase_order p
   WHERE NOT l.parent_in_batch AND p.company_id = v_company AND p.source_system = v_system AND p.external_po_number = l.po;
  INSERT INTO hp_issue SELECT 'PURCHASE_ORDER', row_no, line_ref, 'ERROR', 'HISTORY_PO_HEADER_UNRESOLVED', 'No PO header ' || coalesce(po, '?') || ' in this request or in an earlier committed batch of this source system.', payload
    FROM hp_l WHERE po IS NOT NULL AND NOT parent_in_batch AND existing_po_id IS NULL;

  UPDATE hp_l l SET match_count = m.cnt, material_id = CASE WHEN m.cnt = 1 THEN m.one END
  FROM (SELECT l2.idx, count(*) AS cnt, (array_agg(mm.material_id))[1] AS one
        FROM hp_l l2 CROSS JOIN LATERAL erp_history.company_material_matches(v_company, l2.material_code, true) mm
        GROUP BY l2.idx) m
  WHERE m.idx = l.idx;
  INSERT INTO hp_issue SELECT 'PURCHASE_ORDER', row_no, line_ref, 'ERROR', 'HISTORY_MATERIAL_AMBIGUOUS', 'material_code ' || material_code || ' matches more than one active material of this company.', payload FROM hp_l WHERE match_count > 1;
  UPDATE hp_l SET vstatus = 'UNMAPPED' WHERE material_id IS NULL AND match_count <= 1;
  INSERT INTO hp_issue SELECT 'PURCHASE_ORDER', row_no, line_ref, 'WARNING', 'HISTORY_MATERIAL_UNMAPPED',
    CASE WHEN material_code IS NULL THEN 'No material_code; kept as UNMAPPED.' ELSE 'material_code ' || material_code || ' is not an active material of this company; kept as UNMAPPED.' END, payload
    FROM hp_l WHERE material_id IS NULL AND match_count = 0;
  UPDATE hp_l SET kg = round(qty * erp_history.kg_factor(material_id, uom), 6) WHERE material_id IS NOT NULL AND qty IS NOT NULL AND uom IS NOT NULL;
  INSERT INTO hp_issue SELECT 'PURCHASE_ORDER', row_no, line_ref, 'WARNING', 'HISTORY_UOM_CONVERSION_MISSING', 'No verified fixed conversion from ' || uom || ' to KG; normalized_kg left empty.', payload
    FROM hp_l WHERE material_id IS NOT NULL AND qty IS NOT NULL AND uom IS NOT NULL AND kg IS NULL;

  -- movements
  CREATE TEMP TABLE hp_m ON COMMIT DROP AS
  SELECT e.ord AS idx,
         CASE WHEN (e.v->>'source_row_number') ~ '^[0-9]+$' AND (e.v->>'source_row_number')::bigint BETWEEN 1 AND 2147483647
              THEN (e.v->>'source_row_number')::integer END AS row_no,
         nullif(btrim(e.v->>'source_record_key'), '') AS record_key,
         nullif(btrim(e.v->>'external_po_number'), '') AS po,
         nullif(btrim(e.v->>'external_line_reference'), '') AS line_ref,
         NULL::uuid AS existing_line_id,
         NULL::uuid AS line_material_id,
         false AS parent_in_batch,
         upper(nullif(btrim(e.v->>'supply_type'), '')) AS supply_raw,
         CASE upper(nullif(btrim(e.v->>'supply_type'), '')) WHEN 'LOCAL' THEN 'LOCAL' WHEN 'DOMESTIC' THEN 'LOCAL' WHEN 'IMPORT' THEN 'IMPORT' END AS supply,
         nullif(btrim(e.v->>'original_quantity'), '') AS qty_raw,
         erp_history.try_numeric(e.v->>'original_quantity') AS qty,
         upper(nullif(btrim(e.v->>'original_uom'), '')) AS uom,
         NULL::numeric AS kg,
         e.v->'cancellation_flag' AS cancelled_raw,
         'VALIDATED'::text AS vstatus,
         e.v AS payload
  FROM jsonb_array_elements(v_moves) WITH ORDINALITY AS e(v, ord);

  INSERT INTO hp_issue SELECT 'CONSIGNMENT_MOVEMENT', row_no, record_key, 'ERROR', 'HISTORY_SOURCE_ROW_REQUIRED', 'source_row_number must be a positive integer.', payload FROM hp_m WHERE row_no IS NULL;
  INSERT INTO hp_issue SELECT 'CONSIGNMENT_MOVEMENT', row_no, record_key, 'ERROR', 'HISTORY_SOURCE_RECORD_KEY_REQUIRED', 'source_record_key (a stable id for this movement) is required.', payload FROM hp_m WHERE record_key IS NULL;
  INSERT INTO hp_issue SELECT 'CONSIGNMENT_MOVEMENT', m.row_no, m.record_key, 'ERROR', 'HISTORY_MOVEMENT_DUPLICATE_IN_BATCH', 'The same source_record_key appears more than once in this request.', m.payload
    FROM hp_m m WHERE m.record_key IS NOT NULL AND (SELECT count(*) FROM hp_m x WHERE x.record_key = m.record_key) > 1;
  INSERT INTO hp_issue SELECT 'CONSIGNMENT_MOVEMENT', row_no, record_key, 'ERROR', 'HISTORY_LINE_IDENTITY_REQUIRED', 'external_po_number and external_line_reference are required.', payload FROM hp_m WHERE po IS NULL OR line_ref IS NULL;
  INSERT INTO hp_issue SELECT 'CONSIGNMENT_MOVEMENT', m.row_no, m.record_key, 'ERROR', 'HISTORY_DATE_INVALID', k.key || ' must be a real YYYY-MM-DD date.', m.payload
    FROM hp_m m CROSS JOIN unnest(ARRAY['dispatch_date','etd_date','atd_date','eta_port_date','ata_port_date','boe_date','lr_date','inward_date']) AS k(key)
    WHERE nullif(btrim(m.payload->>k.key), '') IS NOT NULL AND erp_history.try_date(btrim(m.payload->>k.key)) IS NULL;
  INSERT INTO hp_issue SELECT 'CONSIGNMENT_MOVEMENT', row_no, record_key, 'ERROR', 'HISTORY_NUMBER_INVALID', 'original_quantity must be a non-negative number.', payload FROM hp_m WHERE qty_raw IS NOT NULL AND (qty IS NULL OR qty < 0);
  INSERT INTO hp_issue SELECT 'CONSIGNMENT_MOVEMENT', row_no, record_key, 'ERROR', 'HISTORY_SUPPLY_TYPE_INVALID', 'supply_type must be LOCAL, DOMESTIC or IMPORT.', payload FROM hp_m WHERE supply_raw IS NOT NULL AND supply IS NULL;
  INSERT INTO hp_issue SELECT 'CONSIGNMENT_MOVEMENT', row_no, record_key, 'ERROR', 'HISTORY_BOOLEAN_INVALID', 'cancellation_flag must be true or false.', payload FROM hp_m WHERE cancelled_raw IS NOT NULL AND jsonb_typeof(cancelled_raw) NOT IN ('boolean', 'null');

  UPDATE hp_m m SET parent_in_batch = true, line_material_id = l.material_id
  FROM hp_l l WHERE l.po = m.po AND l.line_ref = m.line_ref;
  UPDATE hp_m m SET existing_line_id = pl.id, line_material_id = pl.material_id
  FROM erp_history.purchase_order_line pl JOIN erp_history.purchase_order p ON p.id = pl.purchase_order_id
  WHERE NOT m.parent_in_batch AND p.company_id = v_company AND p.source_system = v_system
    AND p.external_po_number = m.po AND pl.external_line_reference = m.line_ref;
  INSERT INTO hp_issue SELECT 'CONSIGNMENT_MOVEMENT', row_no, record_key, 'ERROR', 'HISTORY_PO_LINE_UNRESOLVED', 'No PO line ' || coalesce(po, '?') || ' / ' || coalesce(line_ref, '?') || ' in this request or in an earlier committed batch.', payload
    FROM hp_m WHERE po IS NOT NULL AND line_ref IS NOT NULL AND NOT parent_in_batch AND existing_line_id IS NULL;
  UPDATE hp_m SET kg = round(qty * erp_history.kg_factor(line_material_id, uom), 6) WHERE line_material_id IS NOT NULL AND qty IS NOT NULL AND uom IS NOT NULL;
  INSERT INTO hp_issue SELECT 'CONSIGNMENT_MOVEMENT', row_no, record_key, 'WARNING', 'HISTORY_UOM_CONVERSION_MISSING', 'No verified KG conversion (or the PO line material is unmapped); normalized_kg left empty.', payload
    FROM hp_m WHERE qty IS NOT NULL AND uom IS NOT NULL AND kg IS NULL;

  SELECT count(*) FILTER (WHERE severity = 'ERROR'), count(*) FILTER (WHERE severity = 'WARNING'),
         coalesce(jsonb_agg(jsonb_build_object('record_kind', record, 'source_row_number', row_no, 'record_key', record_key,
           'severity', severity, 'code', code, 'message', message) ORDER BY record, row_no), '[]'::jsonb)
    INTO v_errors, v_warnings, v_issues FROM hp_issue;
  v_summary := jsonb_build_object('purchase_orders', jsonb_array_length(v_headers), 'purchase_order_lines', jsonb_array_length(v_lines),
    'consignment_movements', jsonb_array_length(v_moves), 'error_count', v_errors, 'warning_count', v_warnings);

  IF p_dry_run OR v_errors > 0 THEN
    RETURN jsonb_build_object('dry_run', p_dry_run, 'committed', false, 'committable', v_errors = 0, 'summary', v_summary, 'issues', v_issues);
  END IF;

  -- ── commit (same transaction: any failure below rolls everything back) ──
  INSERT INTO erp_history.import_batch (company_id, record_kind, source_system, source_file_key, source_file_name,
    source_sheet_name, source_checksum, status, submitted_row_count, created_by, reconciliation)
  VALUES (v_company, 'PURCHASE_ORDER', v_system, v_file, v_file_nm, v_sheet, v_checksum, 'COMMITTING', v_total, p_actor, v_summary)
  RETURNING id INTO v_batch;

  INSERT INTO erp_history.purchase_order AS t (company_id, first_import_batch_id, last_import_batch_id, source_system,
    source_file_key, source_sheet_name, source_row_number, external_po_number, revised_po_number, order_date,
    supplier_name, vendor_code, vendor_id, supply_type, payment_terms, payment_days, currency_code, original_status,
    cancellation_flag, validation_status, source_payload)
  SELECT v_company, v_batch, v_batch, v_system, v_file, v_sheet, row_no, po, revised, order_date, supplier, vendor_code,
         vendor_id, supply, payment_terms, payment_days, currency, original_status,
         CASE WHEN jsonb_typeof(cancelled_raw) = 'boolean' THEN (cancelled_raw)::boolean ELSE false END, vstatus, payload
  FROM hp_h
  ON CONFLICT (company_id, source_system, external_po_number) DO UPDATE SET
    last_import_batch_id = EXCLUDED.last_import_batch_id, source_file_key = EXCLUDED.source_file_key,
    source_sheet_name = EXCLUDED.source_sheet_name, source_row_number = EXCLUDED.source_row_number,
    revised_po_number = EXCLUDED.revised_po_number, order_date = EXCLUDED.order_date, supplier_name = EXCLUDED.supplier_name,
    vendor_code = EXCLUDED.vendor_code, vendor_id = EXCLUDED.vendor_id, supply_type = EXCLUDED.supply_type,
    payment_terms = EXCLUDED.payment_terms, payment_days = EXCLUDED.payment_days, currency_code = EXCLUDED.currency_code,
    original_status = EXCLUDED.original_status, cancellation_flag = EXCLUDED.cancellation_flag,
    validation_status = EXCLUDED.validation_status, source_payload = EXCLUDED.source_payload;

  INSERT INTO erp_history.purchase_order_line AS t (purchase_order_id, company_id, first_import_batch_id, last_import_batch_id,
    source_system, source_file_key, source_sheet_name, source_row_number, external_line_reference, material_code,
    material_id, item_description, original_quantity, original_uom, normalized_kg, unit_rate, validation_status, source_payload)
  SELECT p.id, v_company, v_batch, v_batch, v_system, v_file, v_sheet, l.row_no, l.line_ref, l.material_code,
         l.material_id, l.item_description, l.qty, l.uom, l.kg, l.rate, l.vstatus, l.payload
  FROM hp_l l JOIN erp_history.purchase_order p
    ON p.company_id = v_company AND p.source_system = v_system AND p.external_po_number = l.po
  ON CONFLICT (purchase_order_id, external_line_reference) DO UPDATE SET
    last_import_batch_id = EXCLUDED.last_import_batch_id, source_file_key = EXCLUDED.source_file_key,
    source_sheet_name = EXCLUDED.source_sheet_name, source_row_number = EXCLUDED.source_row_number,
    material_code = EXCLUDED.material_code, material_id = EXCLUDED.material_id, item_description = EXCLUDED.item_description,
    original_quantity = EXCLUDED.original_quantity, original_uom = EXCLUDED.original_uom, normalized_kg = EXCLUDED.normalized_kg,
    unit_rate = EXCLUDED.unit_rate, validation_status = EXCLUDED.validation_status, source_payload = EXCLUDED.source_payload;

  INSERT INTO erp_history.consignment_movement AS t (company_id, purchase_order_line_id, first_import_batch_id, last_import_batch_id,
    source_system, source_file_key, source_sheet_name, source_row_number, source_record_key, consignment_reference,
    invoice_number, bl_number, mdn_number, supply_type, dispatch_date, etd_date, atd_date, eta_port_date, ata_port_date,
    boe_date, lr_date, inward_date, original_quantity, original_uom, normalized_kg, cancellation_flag, validation_status, source_payload)
  SELECT v_company, pl.id, v_batch, v_batch, v_system, v_file, v_sheet, m.row_no, m.record_key,
         nullif(btrim(m.payload->>'consignment_reference'), ''), nullif(btrim(m.payload->>'invoice_number'), ''),
         nullif(btrim(m.payload->>'bl_number'), ''), nullif(btrim(m.payload->>'mdn_number'), ''), m.supply,
         erp_history.try_date(btrim(m.payload->>'dispatch_date')), erp_history.try_date(btrim(m.payload->>'etd_date')),
         erp_history.try_date(btrim(m.payload->>'atd_date')), erp_history.try_date(btrim(m.payload->>'eta_port_date')),
         erp_history.try_date(btrim(m.payload->>'ata_port_date')), erp_history.try_date(btrim(m.payload->>'boe_date')),
         erp_history.try_date(btrim(m.payload->>'lr_date')), erp_history.try_date(btrim(m.payload->>'inward_date')),
         m.qty, m.uom, m.kg, CASE WHEN jsonb_typeof(m.cancelled_raw) = 'boolean' THEN (m.cancelled_raw)::boolean ELSE false END, m.vstatus, m.payload
  FROM hp_m m
  JOIN erp_history.purchase_order p ON p.company_id = v_company AND p.source_system = v_system AND p.external_po_number = m.po
  JOIN erp_history.purchase_order_line pl ON pl.purchase_order_id = p.id AND pl.external_line_reference = m.line_ref
  ON CONFLICT (company_id, source_system, source_record_key) DO UPDATE SET
    purchase_order_line_id = EXCLUDED.purchase_order_line_id, last_import_batch_id = EXCLUDED.last_import_batch_id,
    source_file_key = EXCLUDED.source_file_key, source_sheet_name = EXCLUDED.source_sheet_name,
    source_row_number = EXCLUDED.source_row_number, consignment_reference = EXCLUDED.consignment_reference,
    invoice_number = EXCLUDED.invoice_number, bl_number = EXCLUDED.bl_number, mdn_number = EXCLUDED.mdn_number,
    supply_type = EXCLUDED.supply_type, dispatch_date = EXCLUDED.dispatch_date, etd_date = EXCLUDED.etd_date,
    atd_date = EXCLUDED.atd_date, eta_port_date = EXCLUDED.eta_port_date, ata_port_date = EXCLUDED.ata_port_date,
    boe_date = EXCLUDED.boe_date, lr_date = EXCLUDED.lr_date, inward_date = EXCLUDED.inward_date,
    original_quantity = EXCLUDED.original_quantity, original_uom = EXCLUDED.original_uom, normalized_kg = EXCLUDED.normalized_kg,
    cancellation_flag = EXCLUDED.cancellation_flag, validation_status = EXCLUDED.validation_status, source_payload = EXCLUDED.source_payload;

  INSERT INTO erp_history.import_exception (import_batch_id, company_id, record_kind, source_file_key, source_sheet_name,
    source_row_number, source_line_key, exception_code, exception_message, source_payload, validation_metadata)
  SELECT v_batch, v_company, record, v_file, v_sheet, row_no, coalesce(record_key, ''), code, message, payload,
         jsonb_build_object('severity', severity)
  FROM hp_issue;

  UPDATE erp_history.import_batch
     SET status = CASE WHEN v_warnings > 0 THEN 'COMMITTED_WITH_EXCEPTIONS' ELSE 'COMMITTED' END,
         imported_row_count = v_total, exception_row_count = v_warnings, committed_at = now()
   WHERE id = v_batch;

  RETURN jsonb_build_object('dry_run', false, 'committed', true, 'idempotent_replay', false, 'batch_id', v_batch,
    'status', CASE WHEN v_warnings > 0 THEN 'COMMITTED_WITH_EXCEPTIONS' ELSE 'COMMITTED' END,
    'summary', v_summary, 'issues', v_issues);
END
$fn$;

-- ── production / FG dispatch import ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.import_historical_operations(p_request jsonb, p_actor uuid, p_dry_run boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, erp_history, erp_master, pg_temp
AS $fn$
DECLARE
  v_company  uuid;
  v_kind     text := upper(nullif(btrim(p_request->>'record_kind'), ''));
  v_system   text := coalesce(nullif(btrim(p_request->>'source_system'), ''), 'HISTORICAL_FILE');
  v_file     text := nullif(btrim(p_request->>'source_file_key'), '');
  v_file_nm  text := nullif(btrim(p_request->>'source_file_name'), '');
  v_sheet    text := nullif(btrim(p_request->>'source_sheet_name'), '');
  v_checksum text := nullif(btrim(p_request->>'checksum'), '');
  v_rows     jsonb := coalesce(p_request->'rows', '[]'::jsonb);
  v_date_key text;
  v_batch    uuid;
  v_existing uuid;
  v_errors   integer;
  v_issue_ct integer;
  v_stored   integer;
  v_kg       numeric;
  v_issues   jsonb;
  v_rowinfo  jsonb;
  v_summary  jsonb;
BEGIN
  BEGIN v_company := nullif(p_request->>'company_id', '')::uuid;
  EXCEPTION WHEN others THEN RAISE EXCEPTION 'HISTORY_IMPORT_INVALID: company_id is not a valid id'; END;
  IF v_company IS NULL OR NOT EXISTS (SELECT 1 FROM erp_master.companies WHERE id = v_company) THEN
    RAISE EXCEPTION 'HISTORY_IMPORT_INVALID: company_id is required and must exist';
  END IF;
  IF p_actor IS NULL THEN RAISE EXCEPTION 'HISTORY_IMPORT_INVALID: actor is required'; END IF;
  IF v_kind NOT IN ('PRODUCTION', 'FG_DISPATCH') OR v_kind IS NULL THEN
    RAISE EXCEPTION 'HISTORY_IMPORT_INVALID: record_kind must be PRODUCTION or FG_DISPATCH';
  END IF;
  IF v_file IS NULL OR v_sheet IS NULL THEN
    RAISE EXCEPTION 'HISTORY_IMPORT_INVALID: source_file_key and source_sheet_name are required';
  END IF;
  IF jsonb_typeof(v_rows) <> 'array' OR jsonb_array_length(v_rows) < 1 OR jsonb_array_length(v_rows) > 2000 THEN
    RAISE EXCEPTION 'HISTORY_IMPORT_BATCH_SIZE: send between 1 and 2000 rows per request';
  END IF;
  v_date_key := CASE v_kind WHEN 'PRODUCTION' THEN 'production_date' ELSE 'dispatch_date' END;

  IF NOT p_dry_run AND v_checksum IS NOT NULL THEN
    SELECT id INTO v_existing FROM erp_history.import_batch
     WHERE company_id = v_company AND record_kind = v_kind AND source_checksum = v_checksum
       AND status IN ('COMMITTED', 'COMMITTED_WITH_EXCEPTIONS')
     ORDER BY created_at DESC LIMIT 1;
    IF v_existing IS NOT NULL THEN
      RETURN jsonb_build_object('dry_run', false, 'committed', true, 'idempotent_replay', true, 'batch_id', v_existing);
    END IF;
  END IF;

  DROP TABLE IF EXISTS ho_issue, ho_r;
  CREATE TEMP TABLE ho_issue (idx bigint, row_no integer, line_key text, severity text, code text, message text, payload jsonb) ON COMMIT DROP;
  CREATE TEMP TABLE ho_r ON COMMIT DROP AS
  SELECT e.ord AS idx,
         CASE WHEN (e.v->>'source_row_number') ~ '^[0-9]+$' AND (e.v->>'source_row_number')::bigint BETWEEN 1 AND 2147483647
              THEN (e.v->>'source_row_number')::integer END AS row_no,
         coalesce(btrim(e.v->>'source_line_key'), '') AS line_key,
         jsonb_typeof(e.v->'external_sku') AS sku_type,
         CASE WHEN jsonb_typeof(e.v->'external_sku') = 'string' THEN nullif(btrim(e.v->>'external_sku'), '') END AS sku,
         nullif(btrim(e.v->>v_date_key), '') AS date_raw,
         erp_history.try_date(nullif(btrim(e.v->>v_date_key), '')) AS event_date,
         nullif(btrim(coalesce(e.v->>'original_quantity', e.v->>'quantity')), '') AS qty_raw,
         erp_history.try_numeric(coalesce(e.v->>'original_quantity', e.v->>'quantity')) AS qty,
         upper(nullif(btrim(coalesce(e.v->>'original_uom', e.v->>'uom')), '')) AS uom,
         NULL::uuid AS material_id,
         0 AS match_count,
         NULL::numeric AS kg,
         (v_kind = 'FG_DISPATCH' AND (coalesce(e.v->'cancellation_flag', 'false'::jsonb) = 'true'::jsonb OR coalesce(e.v->'is_cancelled', 'false'::jsonb) = 'true'::jsonb
           OR upper(coalesce(e.v->>'original_dispatch_status', e.v->>'dispatch_status', '')) IN ('CANCELLED', 'CANCELED'))) AS cancelled,
         'VALIDATED'::text AS vstatus,
         false AS storable,
         e.v AS payload
  FROM jsonb_array_elements(v_rows) WITH ORDINALITY AS e(v, ord);

  -- Batch-blocking errors.
  INSERT INTO ho_issue SELECT r.idx, r.row_no, r.line_key, 'ERROR', 'HISTORY_DUPLICATE_SOURCE_ROW', 'The same source_row_number + source_line_key appears more than once in this request.', r.payload
    FROM ho_r r WHERE r.row_no IS NOT NULL AND (SELECT count(*) FROM ho_r x WHERE x.row_no = r.row_no AND x.line_key = r.line_key) > 1;
  INSERT INTO ho_issue SELECT idx, row_no, line_key, 'ERROR', 'HISTORY_RAW_ID_NOT_ACCEPTED', 'Send external_sku, not material_id; ids are resolved by the server.', payload FROM ho_r WHERE payload ? 'material_id';

  -- Row-level problems: kept as exceptions; the row is stored (when it has a
  -- source identity and SKU) with status QUARANTINED / UNMAPPED.
  INSERT INTO ho_issue SELECT idx, row_no, line_key, 'WARNING', 'HISTORY_SOURCE_ROW_REQUIRED', 'source_row_number must be a positive integer; row not stored.', payload FROM ho_r WHERE row_no IS NULL;
  INSERT INTO ho_issue SELECT idx, row_no, line_key, 'WARNING', 'HISTORY_SKU_MUST_BE_TEXT', 'external_sku must be sent as text so leading zeroes are kept; row not stored.', payload FROM ho_r WHERE sku_type IS DISTINCT FROM 'string' AND sku_type IS NOT NULL AND sku_type <> 'null';
  INSERT INTO ho_issue SELECT idx, row_no, line_key, 'WARNING', 'HISTORY_SKU_REQUIRED', 'external_sku is required; row not stored.', payload FROM ho_r WHERE sku IS NULL AND (sku_type IS NULL OR sku_type IN ('string', 'null'));
  INSERT INTO ho_issue SELECT idx, row_no, line_key, 'WARNING', 'HISTORY_UNKNOWN_SKU', 'SKU 00000000000 must be mapped manually.', payload FROM ho_r WHERE sku = '00000000000';
  INSERT INTO ho_issue SELECT idx, row_no, line_key, 'WARNING', 'HISTORY_DATE_INVALID', v_date_key || ' must be a real date on or before 2026-09-30 (ERP posted data is used from 2026-10-01).', payload
    FROM ho_r WHERE event_date IS NULL OR event_date > DATE '2026-09-30';
  INSERT INTO ho_issue SELECT idx, row_no, line_key, 'WARNING', 'HISTORY_QUANTITY_INVALID', 'original_quantity must be a non-negative number.', payload FROM ho_r WHERE qty IS NULL OR qty < 0;
  INSERT INTO ho_issue SELECT idx, row_no, line_key, 'WARNING', 'HISTORY_UOM_REQUIRED', 'original_uom is required.', payload FROM ho_r WHERE uom IS NULL;

  UPDATE ho_r r SET match_count = m.cnt, material_id = CASE WHEN m.cnt = 1 THEN m.one END
  FROM (SELECT r2.idx, count(*) AS cnt, (array_agg(mm.material_id))[1] AS one
        FROM ho_r r2 CROSS JOIN LATERAL erp_history.company_material_matches(v_company, r2.sku, false) mm
        WHERE r2.sku IS NOT NULL AND r2.sku <> '00000000000'
        GROUP BY r2.idx) m
  WHERE m.idx = r.idx;
  INSERT INTO ho_issue SELECT idx, row_no, line_key, 'WARNING', 'HISTORY_SKU_UNMAPPED',
    CASE WHEN match_count > 1 THEN 'external_sku matches more than one active material of this company.'
         ELSE 'external_sku has no active material (external_code) for this company.' END, payload
    FROM ho_r WHERE sku IS NOT NULL AND sku <> '00000000000' AND material_id IS NULL;
  UPDATE ho_r SET kg = round(qty * erp_history.kg_factor(material_id, uom), 6)
   WHERE material_id IS NOT NULL AND qty IS NOT NULL AND qty >= 0 AND uom IS NOT NULL;
  INSERT INTO ho_issue SELECT idx, row_no, line_key, 'WARNING', 'HISTORY_UOM_CONVERSION_MISSING', 'No verified fixed conversion from ' || uom || ' to KG for the mapped material.', payload
    FROM ho_r WHERE material_id IS NOT NULL AND qty IS NOT NULL AND qty >= 0 AND uom IS NOT NULL AND kg IS NULL;

  UPDATE ho_r r SET storable = (r.row_no IS NOT NULL AND r.sku IS NOT NULL),
    vstatus = CASE
      WHEN EXISTS (SELECT 1 FROM ho_issue i WHERE i.idx = r.idx AND i.code IN ('HISTORY_UNKNOWN_SKU', 'HISTORY_DATE_INVALID',
        'HISTORY_QUANTITY_INVALID', 'HISTORY_UOM_REQUIRED', 'HISTORY_UOM_CONVERSION_MISSING')) THEN 'QUARANTINED'
      WHEN r.material_id IS NULL THEN 'UNMAPPED'
      ELSE 'VALIDATED' END;

  SELECT count(*) FILTER (WHERE severity = 'ERROR'), count(*),
         coalesce(jsonb_agg(jsonb_build_object('source_row_number', row_no, 'source_line_key', line_key, 'severity', severity,
           'code', code, 'message', message) ORDER BY idx), '[]'::jsonb)
    INTO v_errors, v_issue_ct, v_issues FROM ho_issue;
  SELECT coalesce(sum(kg) FILTER (WHERE vstatus = 'VALIDATED' AND NOT cancelled), 0), count(*) FILTER (WHERE storable),
         coalesce(jsonb_agg(jsonb_build_object('source_row_number', row_no, 'source_line_key', line_key, 'external_sku', sku,
           'validation_status', vstatus, 'normalized_kg', kg, 'cancelled', cancelled, 'stored', storable) ORDER BY idx), '[]'::jsonb)
    INTO v_kg, v_stored, v_rowinfo FROM ho_r;
  v_summary := jsonb_build_object('submitted_row_count', jsonb_array_length(v_rows), 'storable_row_count', v_stored,
    'error_count', v_errors, 'exception_count', v_issue_ct - v_errors, 'validated_kg_total', v_kg,
    'validated_row_count', (SELECT count(*) FROM ho_r WHERE storable AND vstatus = 'VALIDATED'),
    'unmapped_row_count', (SELECT count(*) FROM ho_r WHERE storable AND vstatus = 'UNMAPPED'),
    'quarantined_row_count', (SELECT count(*) FROM ho_r WHERE storable AND vstatus = 'QUARANTINED'),
    'cancelled_row_count', (SELECT count(*) FROM ho_r WHERE cancelled));

  IF p_dry_run OR v_errors > 0 THEN
    RETURN jsonb_build_object('dry_run', p_dry_run, 'committed', false, 'committable', v_errors = 0,
      'summary', v_summary, 'issues', v_issues, 'rows', v_rowinfo);
  END IF;

  INSERT INTO erp_history.import_batch (company_id, record_kind, source_system, source_file_key, source_file_name,
    source_sheet_name, source_checksum, status, submitted_row_count, created_by, reconciliation)
  VALUES (v_company, v_kind, v_system, v_file, v_file_nm, v_sheet, v_checksum, 'COMMITTING', jsonb_array_length(v_rows), p_actor, v_summary)
  RETURNING id INTO v_batch;

  IF v_kind = 'PRODUCTION' THEN
    INSERT INTO erp_history.production_actual (company_id, first_import_batch_id, last_import_batch_id, source_system,
      source_file_key, source_sheet_name, source_row_number, source_line_key, source_production_date, production_date,
      plant_source_id, external_sku, material_id, prodshade, product_description, shift, machine, stroke_reference,
      process_order_reference, original_quantity, original_uom, normalized_kg, validation_status, source_payload, validation_metadata)
    SELECT v_company, v_batch, v_batch, v_system, v_file, v_sheet, row_no, line_key, date_raw,
           CASE WHEN event_date <= DATE '2026-09-30' THEN event_date END,
           nullif(btrim(coalesce(payload->>'plant_id', payload->>'plant')), ''), sku, material_id,
           nullif(btrim(payload->>'prodshade'), ''), nullif(btrim(payload->>'product_description'), ''),
           nullif(btrim(payload->>'shift'), ''), nullif(btrim(payload->>'machine'), ''),
           nullif(btrim(coalesce(payload->>'stroke_reference', payload->>'stroke')), ''),
           nullif(btrim(coalesce(payload->>'process_order_reference', payload->>'po_reference')), ''),
           CASE WHEN qty >= 0 THEN qty END, uom, kg, vstatus, payload,
           jsonb_build_object('issues', (SELECT coalesce(jsonb_agg(code), '[]'::jsonb) FROM ho_issue i WHERE i.idx = r.idx))
    FROM ho_r r WHERE storable
    ON CONFLICT (company_id, source_system, source_file_key, source_sheet_name, source_row_number, source_line_key) DO UPDATE SET
      last_import_batch_id = EXCLUDED.last_import_batch_id, source_production_date = EXCLUDED.source_production_date,
      production_date = EXCLUDED.production_date, plant_source_id = EXCLUDED.plant_source_id, external_sku = EXCLUDED.external_sku,
      material_id = EXCLUDED.material_id, prodshade = EXCLUDED.prodshade, product_description = EXCLUDED.product_description,
      shift = EXCLUDED.shift, machine = EXCLUDED.machine, stroke_reference = EXCLUDED.stroke_reference,
      process_order_reference = EXCLUDED.process_order_reference, original_quantity = EXCLUDED.original_quantity,
      original_uom = EXCLUDED.original_uom, normalized_kg = EXCLUDED.normalized_kg, validation_status = EXCLUDED.validation_status,
      source_payload = EXCLUDED.source_payload, validation_metadata = EXCLUDED.validation_metadata;
  ELSE
    INSERT INTO erp_history.fg_dispatch_actual (company_id, first_import_batch_id, last_import_batch_id, source_system,
      source_file_key, source_sheet_name, source_row_number, source_line_key, source_dispatch_date, dispatch_date,
      external_sku, material_id, product_description, dispatch_category, mdn, invoice_number, order_reference, consignee,
      depot_code, original_quantity, original_uom, normalized_dispatched_kg, original_dispatch_status, cancellation_flag,
      stock_posting_status, stock_posting_evidence, validation_status, source_payload, validation_metadata)
    SELECT v_company, v_batch, v_batch, v_system, v_file, v_sheet, row_no, line_key, date_raw,
           CASE WHEN event_date <= DATE '2026-09-30' THEN event_date END, sku, material_id,
           nullif(btrim(payload->>'product_description'), ''),
           CASE upper(btrim(coalesce(payload->>'dispatch_category', ''))) WHEN 'DIRECT' THEN 'DIRECT' WHEN 'DEPOT' THEN 'DEPOT' END,
           nullif(btrim(payload->>'mdn'), ''), nullif(btrim(payload->>'invoice_number'), ''),
           nullif(btrim(payload->>'order_reference'), ''), nullif(btrim(payload->>'consignee'), ''),
           nullif(btrim(payload->>'depot_code'), ''), CASE WHEN qty >= 0 THEN qty END, uom, kg,
           nullif(btrim(coalesce(payload->>'original_dispatch_status', payload->>'dispatch_status')), ''), cancelled,
           CASE upper(btrim(coalesce(payload->>'stock_posting_status', ''))) WHEN 'POSTED' THEN 'POSTED' WHEN 'NOT_POSTED' THEN 'NOT_POSTED' ELSE 'UNKNOWN' END,
           CASE WHEN jsonb_typeof(payload->'stock_posting_evidence') = 'object' THEN payload->'stock_posting_evidence' ELSE '{}'::jsonb END,
           vstatus, payload,
           jsonb_build_object('issues', (SELECT coalesce(jsonb_agg(code), '[]'::jsonb) FROM ho_issue i WHERE i.idx = r.idx))
    FROM ho_r r WHERE storable
    ON CONFLICT (company_id, source_system, source_file_key, source_sheet_name, source_row_number, source_line_key) DO UPDATE SET
      last_import_batch_id = EXCLUDED.last_import_batch_id, source_dispatch_date = EXCLUDED.source_dispatch_date,
      dispatch_date = EXCLUDED.dispatch_date, external_sku = EXCLUDED.external_sku, material_id = EXCLUDED.material_id,
      product_description = EXCLUDED.product_description, dispatch_category = EXCLUDED.dispatch_category, mdn = EXCLUDED.mdn,
      invoice_number = EXCLUDED.invoice_number, order_reference = EXCLUDED.order_reference, consignee = EXCLUDED.consignee,
      depot_code = EXCLUDED.depot_code, original_quantity = EXCLUDED.original_quantity, original_uom = EXCLUDED.original_uom,
      normalized_dispatched_kg = EXCLUDED.normalized_dispatched_kg, original_dispatch_status = EXCLUDED.original_dispatch_status,
      cancellation_flag = EXCLUDED.cancellation_flag, stock_posting_status = EXCLUDED.stock_posting_status,
      stock_posting_evidence = EXCLUDED.stock_posting_evidence, validation_status = EXCLUDED.validation_status,
      source_payload = EXCLUDED.source_payload, validation_metadata = EXCLUDED.validation_metadata;
  END IF;

  INSERT INTO erp_history.import_exception (import_batch_id, company_id, record_kind, source_file_key, source_sheet_name,
    source_row_number, source_line_key, exception_code, exception_message, source_payload, validation_metadata)
  SELECT v_batch, v_company, v_kind, v_file, v_sheet, row_no, line_key, code, message, payload, jsonb_build_object('severity', severity)
  FROM ho_issue;

  UPDATE erp_history.import_batch
     SET status = CASE WHEN v_issue_ct > 0 THEN 'COMMITTED_WITH_EXCEPTIONS' ELSE 'COMMITTED' END,
         imported_row_count = v_stored, exception_row_count = v_issue_ct, normalized_kg_total = v_kg, committed_at = now()
   WHERE id = v_batch;

  RETURN jsonb_build_object('dry_run', false, 'committed', true, 'idempotent_replay', false, 'batch_id', v_batch,
    'status', CASE WHEN v_issue_ct > 0 THEN 'COMMITTED_WITH_EXCEPTIONS' ELSE 'COMMITTED' END,
    'summary', v_summary, 'issues', v_issues);
END
$fn$;

-- ── PO21 actuals read ──────────────────────────────────────────────────────
-- Historical (erp_history, dates < 2026-10-01) + ERP posted (>= 2026-10-01):
--   PRODUCTION = FG stock_ledger P101 (+) / P102 (-) of MTS Process POs (SKU-wise)
--   DISPATCH   = FG stock_ledger P601 (+) / P602 (-) of MTS sales-invoice lines
-- Only KG ledger quantities are summed; others are counted, never converted.
CREATE OR REPLACE FUNCTION public.history_planning_actuals(p_company_id uuid, p_from date, p_to_exclusive date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = pg_catalog, erp_history, erp_inventory, erp_production, erp_procurement, erp_master
AS $fn$
DECLARE
  v_cut date := DATE '2026-10-01';
  v_hist_to date := least(p_to_exclusive, v_cut);
  v_live_from date := greatest(p_from, v_cut);
  v_rows jsonb; v_cov jsonb; v_open integer; v_non_kg integer;
BEGIN
  WITH hist AS (
    SELECT date_trunc('month', production_date)::date AS month, material_id, 'PRODUCTION' AS metric, 'HISTORICAL' AS source,
           sum(normalized_kg) AS qty
    FROM erp_history.production_actual
    WHERE company_id = p_company_id AND validation_status = 'VALIDATED' AND material_id IS NOT NULL
      AND production_date >= p_from AND production_date < v_hist_to
    GROUP BY 1, 2
    UNION ALL
    SELECT date_trunc('month', dispatch_date)::date, material_id, 'DISPATCH', 'HISTORICAL', sum(normalized_dispatched_kg)
    FROM erp_history.fg_dispatch_actual
    WHERE company_id = p_company_id AND validation_status = 'VALIDATED' AND NOT cancellation_flag AND material_id IS NOT NULL
      AND dispatch_date >= p_from AND dispatch_date < v_hist_to
    GROUP BY 1, 2
  ), live_prod AS (
    SELECT date_trunc('month', l.posting_date)::date AS month, l.material_id, 'PRODUCTION' AS metric, 'ERP_LIVE' AS source,
           sum(CASE WHEN l.direction = 'IN' THEN l.quantity ELSE -l.quantity END) AS qty
    FROM erp_inventory.stock_ledger l
    JOIN erp_inventory.stock_document d ON d.id = l.stock_document_id AND d.reference_document_type = 'PROC_PO'
    JOIN erp_production.process_order po ON po.id = d.reference_document_id AND po.po_type = 'MTS'
    JOIN erp_master.material_master mm ON mm.id = l.material_id AND mm.material_type = 'FG'
    WHERE l.company_id = p_company_id AND l.movement_type_code IN ('P101', 'P102') AND upper(l.base_uom_code) = 'KG'
      AND l.posting_date >= v_live_from AND l.posting_date < p_to_exclusive
    GROUP BY 1, 2
  ), live_disp AS (
    SELECT date_trunc('month', l.posting_date)::date AS month, l.material_id, 'DISPATCH' AS metric, 'ERP_LIVE' AS source,
           sum(CASE WHEN l.direction = 'OUT' THEN l.quantity ELSE -l.quantity END) AS qty
    FROM erp_inventory.stock_ledger l
    JOIN erp_inventory.stock_document d ON d.id = l.stock_document_id
     AND d.reference_document_type IN ('SALES_INVOICE', 'VDC_SALES_INVOICE')
    WHERE l.company_id = p_company_id AND l.movement_type_code IN ('P601', 'P602') AND upper(l.base_uom_code) = 'KG'
      AND l.posting_date >= v_live_from AND l.posting_date < p_to_exclusive
      AND EXISTS (SELECT 1 FROM erp_procurement.sales_invoice_line sl
                  JOIN erp_procurement.sales_order_line so ON so.id = sl.so_line_id
                  WHERE sl.invoice_id = d.reference_document_id AND sl.material_id = l.material_id AND upper(so.fg_type) = 'MTS')
    GROUP BY 1, 2
  ), allr AS (SELECT * FROM hist UNION ALL SELECT * FROM live_prod UNION ALL SELECT * FROM live_disp)
  SELECT coalesce(jsonb_agg(jsonb_build_object('month', a.month, 'material_id', a.material_id, 'material_type', mm.material_type,
           'metric', a.metric, 'source', a.source, 'qty', round(a.qty, 6))), '[]'::jsonb)
    INTO v_rows
  FROM allr a JOIN erp_master.material_master mm ON mm.id = a.material_id;

  -- Coverage = months with at least one VALIDATED imported row (history) or
  -- months the ERP was live and already started (ERP posted data is complete).
  SELECT jsonb_build_object(
    'PRODUCTION', coalesce((SELECT jsonb_agg(DISTINCT date_trunc('month', production_date)::date) FROM erp_history.production_actual
       WHERE company_id = p_company_id AND validation_status = 'VALIDATED' AND production_date >= p_from AND production_date < v_hist_to), '[]'::jsonb),
    'DISPATCH', coalesce((SELECT jsonb_agg(DISTINCT date_trunc('month', dispatch_date)::date) FROM erp_history.fg_dispatch_actual
       WHERE company_id = p_company_id AND validation_status = 'VALIDATED' AND dispatch_date >= p_from AND dispatch_date < v_hist_to), '[]'::jsonb),
    'ERP_LIVE', coalesce((SELECT jsonb_agg(g::date) FROM generate_series(date_trunc('month', v_live_from), date_trunc('month', least(p_to_exclusive - 1, current_date)), interval '1 month') g
       WHERE v_live_from < p_to_exclusive AND v_live_from <= current_date), '[]'::jsonb))
    INTO v_cov;

  SELECT count(*) INTO v_open FROM erp_history.import_exception
   WHERE company_id = p_company_id AND record_kind IN ('PRODUCTION', 'FG_DISPATCH') AND resolved_at IS NULL;
  SELECT count(*) INTO v_non_kg FROM erp_inventory.stock_ledger l
   JOIN erp_master.material_master mm ON mm.id = l.material_id AND mm.material_type = 'FG'
   WHERE l.company_id = p_company_id AND l.movement_type_code IN ('P101', 'P102', 'P601', 'P602') AND upper(l.base_uom_code) <> 'KG'
     AND l.posting_date >= v_live_from AND l.posting_date < p_to_exclusive;

  RETURN jsonb_build_object('cutover', v_cut, 'rows', v_rows, 'coverage', v_cov,
    'open_history_exceptions', v_open, 'live_non_kg_rows_excluded', v_non_kg);
END
$fn$;

-- ── lead-time samples (aggregated in TypeScript by tested logic) ────────────
CREATE OR REPLACE FUNCTION public.history_lead_time_samples(p_company_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = pg_catalog, erp_history
AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'vendor_id', p.vendor_id, 'material_id', pl.material_id,
    'supply_type', coalesce(m.supply_type, p.supply_type), 'order_date', p.order_date,
    'dispatch_date', m.dispatch_date, 'etd_date', m.etd_date, 'atd_date', m.atd_date, 'ata_port_date', m.ata_port_date,
    'boe_date', m.boe_date, 'lr_date', m.lr_date, 'inward_date', m.inward_date)), '[]'::jsonb)
  FROM erp_history.consignment_movement m
  JOIN erp_history.purchase_order_line pl ON pl.id = m.purchase_order_line_id
  JOIN erp_history.purchase_order p ON p.id = pl.purchase_order_id
  WHERE m.company_id = p_company_id AND m.validation_status = 'VALIDATED' AND NOT m.cancellation_flag
    AND p.validation_status IN ('VALIDATED', 'UNMAPPED') AND NOT p.cancellation_flag;
$$;

REVOKE ALL ON FUNCTION erp_history.try_date(text), erp_history.try_numeric(text), erp_history.kg_factor(uuid, text),
  erp_history.company_material_matches(uuid, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_history.try_date(text), erp_history.try_numeric(text), erp_history.kg_factor(uuid, text),
  erp_history.company_material_matches(uuid, text, boolean) TO service_role;
REVOKE ALL ON FUNCTION public.import_historical_procurement(jsonb, uuid, boolean), public.import_historical_operations(jsonb, uuid, boolean),
  public.history_planning_actuals(uuid, date, date), public.history_lead_time_samples(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_historical_procurement(jsonb, uuid, boolean), public.import_historical_operations(jsonb, uuid, boolean),
  public.history_planning_actuals(uuid, date, date), public.history_lead_time_samples(uuid) TO service_role;

COMMIT;
