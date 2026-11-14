-- EXECUTED on prod 2026-11-14 (after a rehearsal run of this same script with v_rehearsal = true, which rolled back).
-- Result: 66 duplicate invoices, 67 lines, 67 stock documents and 67 P601 ledger rows deleted; 1,007,000 KG put back into 3 F001
-- UNRESTRICTED buckets (snapshot == ledger before and after); MATDOC counter CMP005 FY 2026-27 1044 -> 1043; SALES_INVOICE counter
-- unchanged at 9200004113 (newer valid invoices already sit above the removed numbers, so interior gaps stay).
-- 272 rows archived in erp_history.duplicate_pgi_cleanup_20261114. Kept for the record; do NOT re-run.
-- 2026-11-14 -- remove the 66 duplicate PGI/Invoice postings created by two overlapping SO02 Bulk Post runs (prod, CMP005).
-- Cause + guard: supabase/migrations/20261114120000_pgi_one_active_invoice_per_group_guard.sql
-- Business decision: DELETE the duplicates (no reversal pairs) and correct the counters.
--
-- One transaction, all-or-nothing. Every assertion below must hold or the whole thing rolls back.
-- false is replaced with true (rehearsal: ends with a deliberate exception, nothing changes) or false (real run).
DO $cleanup$
DECLARE
  v_rehearsal boolean := false;
  v_company   uuid := 'a828ea3a-a186-463e-92c2-1ac9767cfe69';  -- CMP005
  v_day       date := '2026-11-14';
  v_n int;
  v_q numeric;
  v_inv_before bigint; v_inv_after bigint;
  v_mat_series uuid; v_mat_before int; v_mat_after int;
  v_bad int;
  rec record;
  v_summary text := '';
BEGIN
  -- 0. Lock the two counters first: a concurrent posting waits, so no number can be issued under our feet.
  SELECT last_number INTO v_inv_before FROM erp_procurement.document_number_series WHERE doc_type = 'SALES_INVOICE' FOR UPDATE;
  SELECT id INTO v_mat_series FROM erp_inventory.number_series_master
   WHERE company_id = v_company AND section_id IS NULL AND document_type = 'MATDOC' AND active LIMIT 1;
  SELECT last_number INTO v_mat_before FROM erp_inventory.number_series_counter
   WHERE series_id = v_mat_series AND financial_year = '2026-27' FOR UPDATE;
  IF v_inv_before IS NULL OR v_mat_before IS NULL THEN RAISE EXCEPTION 'ABORT: counters not found'; END IF;

  -- 1. The duplicates: DOs with >1 POSTED invoice, both created today; the LATER invoice of each pair is the extra.
  CREATE TEMP TABLE tmp_extra ON COMMIT DROP AS
  WITH dup AS (
    SELECT dc_id FROM erp_procurement.sales_invoice
    WHERE company_id = v_company AND status = 'POSTED' AND dc_id IS NOT NULL
      AND (created_at AT TIME ZONE 'Asia/Kolkata')::date = v_day
    GROUP BY dc_id HAVING count(*) > 1)
  SELECT DISTINCT ON (i.dc_id) i.id AS invoice_id, i.dc_id, i.invoice_number
  FROM erp_procurement.sales_invoice i JOIN dup ON dup.dc_id = i.dc_id
  WHERE i.status = 'POSTED' AND i.company_id = v_company
  ORDER BY i.dc_id, i.created_at DESC, i.invoice_number DESC;

  SELECT count(*) INTO v_n FROM tmp_extra;
  IF v_n <> 66 THEN RAISE EXCEPTION 'ABORT: expected 66 extra invoices, found %', v_n; END IF;

  -- every DO has exactly 2 active invoices, and the two are identical in item / qty / rate / total
  SELECT count(*) INTO v_bad FROM (
    SELECT e.dc_id FROM tmp_extra e
    WHERE (SELECT count(*) FROM erp_procurement.sales_invoice s WHERE s.dc_id = e.dc_id AND s.status IN ('DRAFT','POSTED')) <> 2
       OR (SELECT string_agg(l.material_id::text||':'||l.quantity::text||':'||l.rate::text||':'||l.line_total::text||':'||coalesce(l.dc_line_id::text,''), '|' ORDER BY l.material_id, l.quantity, l.dc_line_id)
             FROM erp_procurement.sales_invoice_line l WHERE l.invoice_id = e.invoice_id)
       IS DISTINCT FROM
          (SELECT string_agg(l.material_id::text||':'||l.quantity::text||':'||l.rate::text||':'||l.line_total::text||':'||coalesce(l.dc_line_id::text,''), '|' ORDER BY l.material_id, l.quantity, l.dc_line_id)
             FROM erp_procurement.sales_invoice_line l
            WHERE l.invoice_id = (SELECT s.id FROM erp_procurement.sales_invoice s WHERE s.dc_id = e.dc_id AND s.status = 'POSTED' AND s.id <> e.invoice_id))
  ) x;
  IF v_bad <> 0 THEN RAISE EXCEPTION 'ABORT: % duplicate pair(s) are not identical / not exactly two', v_bad; END IF;

  CREATE TEMP TABLE tmp_extra_doc ON COMMIT DROP AS
    SELECT d.* FROM erp_inventory.stock_document d JOIN tmp_extra e
      ON d.reference_document_type = 'SALES_INVOICE' AND d.reference_document_id = e.invoice_id;
  CREATE TEMP TABLE tmp_extra_ledger ON COMMIT DROP AS
    SELECT l.* FROM erp_inventory.stock_ledger l JOIN tmp_extra_doc d ON d.id = l.stock_document_id;

  SELECT count(*) INTO v_n FROM erp_procurement.sales_invoice_line WHERE invoice_id IN (SELECT invoice_id FROM tmp_extra);
  IF v_n <> 67 THEN RAISE EXCEPTION 'ABORT: expected 67 invoice lines, found %', v_n; END IF;
  SELECT count(*) INTO v_n FROM tmp_extra_doc;
  IF v_n <> 67 THEN RAISE EXCEPTION 'ABORT: expected 67 stock documents, found %', v_n; END IF;
  SELECT count(*), sum(quantity) INTO v_n, v_q FROM tmp_extra_ledger;
  IF v_n <> 67 OR v_q <> 1007000 THEN RAISE EXCEPTION 'ABORT: expected 67 ledger rows / 1007000 qty, found % / %', v_n, v_q; END IF;
  IF EXISTS (SELECT 1 FROM tmp_extra_ledger WHERE movement_type_code <> 'P601' OR upper(direction) <> 'OUT') THEN
    RAISE EXCEPTION 'ABORT: a duplicate ledger row is not a P601 OUT';
  END IF;
  -- nothing else may hang off these rows
  IF EXISTS (SELECT 1 FROM erp_procurement.delivery_challan_line WHERE stock_document_id IN (SELECT id FROM tmp_extra_doc))
     OR EXISTS (SELECT 1 FROM erp_production.dispatch_reco WHERE invoice_id IN (SELECT invoice_id FROM tmp_extra))
     OR EXISTS (SELECT 1 FROM erp_procurement.sales_invoice_additional_cost_line WHERE invoice_id IN (SELECT invoice_id FROM tmp_extra))
     OR EXISTS (SELECT 1 FROM erp_procurement.sales_return_item WHERE invoice_id IN (SELECT invoice_id FROM tmp_extra)) THEN
    RAISE EXCEPTION 'ABORT: something else references a duplicate invoice / stock document';
  END IF;

  -- 2. The stock buckets these rows drained; lock them and prove snapshot == ledger BEFORE touching anything.
  CREATE TEMP TABLE tmp_bucket ON COMMIT DROP AS
    SELECT DISTINCT company_id, storage_location_id, material_id, stock_type_code FROM tmp_extra_ledger;
  PERFORM 1 FROM erp_inventory.stock_snapshot s JOIN tmp_bucket b
    ON s.company_id = b.company_id AND s.storage_location_id = b.storage_location_id AND s.material_id = b.material_id AND s.stock_type_code = b.stock_type_code
   WHERE s.batch_id IS NULL FOR UPDATE OF s;
  SELECT count(*) INTO v_n FROM tmp_bucket;
  IF v_n <> 3 THEN RAISE EXCEPTION 'ABORT: expected 3 stock buckets, found %', v_n; END IF;
  FOR rec IN
    SELECT s.quantity AS sq, (SELECT sum(l.posted_quantity) FROM erp_inventory.stock_ledger l
             WHERE l.company_id = b.company_id AND l.storage_location_id = b.storage_location_id AND l.material_id = b.material_id AND l.stock_type_code = b.stock_type_code) AS lq
    FROM tmp_bucket b JOIN erp_inventory.stock_snapshot s
      ON s.company_id = b.company_id AND s.storage_location_id = b.storage_location_id AND s.material_id = b.material_id AND s.stock_type_code = b.stock_type_code AND s.batch_id IS NULL
  LOOP
    IF abs(rec.sq - coalesce(rec.lq, 0)) > 0.0005 THEN RAISE EXCEPTION 'ABORT: snapshot % <> ledger % before the clean-up', rec.sq, rec.lq; END IF;
  END LOOP;

  -- 3. Archive everything first (recoverable), including before-images of what gets edited.
  INSERT INTO erp_history.duplicate_pgi_cleanup_20261114 (source_table, source_key, row_data)
    SELECT 'sales_invoice', i.id::text, to_jsonb(i) FROM erp_procurement.sales_invoice i WHERE i.id IN (SELECT invoice_id FROM tmp_extra);
  INSERT INTO erp_history.duplicate_pgi_cleanup_20261114 (source_table, source_key, row_data)
    SELECT 'sales_invoice_line', l.id::text, to_jsonb(l) FROM erp_procurement.sales_invoice_line l WHERE l.invoice_id IN (SELECT invoice_id FROM tmp_extra);
  INSERT INTO erp_history.duplicate_pgi_cleanup_20261114 (source_table, source_key, row_data)
    SELECT 'stock_document', d.id::text, to_jsonb(d) FROM tmp_extra_doc d;
  INSERT INTO erp_history.duplicate_pgi_cleanup_20261114 (source_table, source_key, row_data)
    SELECT 'stock_ledger', l.id::text, to_jsonb(l) FROM tmp_extra_ledger l;
  INSERT INTO erp_history.duplicate_pgi_cleanup_20261114 (source_table, source_key, row_data)
    SELECT 'stock_snapshot_before', s.id::text, to_jsonb(s)
    FROM erp_inventory.stock_snapshot s JOIN tmp_bucket b
      ON s.company_id = b.company_id AND s.storage_location_id = b.storage_location_id AND s.material_id = b.material_id AND s.stock_type_code = b.stock_type_code AND s.batch_id IS NULL;
  INSERT INTO erp_history.duplicate_pgi_cleanup_20261114 (source_table, source_key, row_data)
    VALUES ('counter_before', 'SALES_INVOICE', jsonb_build_object('last_number', v_inv_before)),
           ('counter_before', 'MATDOC:CMP005:2026-27', jsonb_build_object('series_id', v_mat_series, 'last_number', v_mat_before));

  -- 4. Give the stock (and value) back. A P601 is an OUT, so posted_* are negative: subtracting them adds the quantity back.
  UPDATE erp_inventory.stock_snapshot s
  SET quantity = s.quantity + t.q,
      value = s.value + t.v,
      last_ledger_id = (SELECT l.id FROM erp_inventory.stock_ledger l
                         WHERE l.company_id = s.company_id AND l.storage_location_id = s.storage_location_id
                           AND l.material_id = s.material_id AND l.stock_type_code = s.stock_type_code
                           AND l.id NOT IN (SELECT id FROM tmp_extra_ledger)
                         ORDER BY l.ledger_seq DESC LIMIT 1),
      last_updated_at = now()
  FROM (SELECT company_id, storage_location_id, material_id, stock_type_code, sum(-posted_quantity) AS q, sum(-posted_value) AS v
        FROM tmp_extra_ledger GROUP BY 1,2,3,4) t
  WHERE s.company_id = t.company_id AND s.storage_location_id = t.storage_location_id AND s.material_id = t.material_id
    AND s.stock_type_code = t.stock_type_code AND s.batch_id IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 3 THEN RAISE EXCEPTION 'ABORT: expected to update 3 snapshots, updated %', v_n; END IF;

  -- 5. Delete. stock_ledger is append-only by rule: lift the delete rule for this transaction only, then put it back.
  DROP RULE stock_ledger_no_delete ON erp_inventory.stock_ledger;
  DELETE FROM erp_inventory.stock_ledger WHERE id IN (SELECT id FROM tmp_extra_ledger);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  CREATE RULE stock_ledger_no_delete AS ON DELETE TO erp_inventory.stock_ledger DO INSTEAD NOTHING;
  IF v_n <> 67 THEN RAISE EXCEPTION 'ABORT: expected to delete 67 ledger rows, deleted %', v_n; END IF;

  DELETE FROM erp_inventory.stock_document WHERE id IN (SELECT id FROM tmp_extra_doc);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 67 THEN RAISE EXCEPTION 'ABORT: expected to delete 67 stock documents, deleted %', v_n; END IF;

  DELETE FROM erp_procurement.sales_invoice_line WHERE invoice_id IN (SELECT invoice_id FROM tmp_extra);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 67 THEN RAISE EXCEPTION 'ABORT: expected to delete 67 invoice lines, deleted %', v_n; END IF;

  DELETE FROM erp_procurement.sales_invoice WHERE id IN (SELECT invoice_id FROM tmp_extra);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 66 THEN RAISE EXCEPTION 'ABORT: expected to delete 66 invoices, deleted %', v_n; END IF;

  -- 6. Counters: back to the highest number that still exists. (Gaps between surviving numbers cannot be reclaimed.)
  SELECT max(invoice_number::bigint) INTO v_inv_after FROM erp_procurement.sales_invoice WHERE invoice_number ~ '^[0-9]+$';
  SELECT max(document_number::int) INTO v_mat_after FROM erp_inventory.stock_document
   WHERE company_id = v_company AND document_year = '2026-27' AND document_number ~ '^[0-9]{1,8}$';
  IF v_inv_after IS NULL OR v_mat_after IS NULL THEN RAISE EXCEPTION 'ABORT: could not find surviving maximum numbers'; END IF;
  IF v_inv_after > v_inv_before OR v_mat_after > v_mat_before THEN RAISE EXCEPTION 'ABORT: surviving number is above the counter (% / %)', v_inv_after, v_mat_after; END IF;
  UPDATE erp_procurement.document_number_series SET last_number = v_inv_after WHERE doc_type = 'SALES_INVOICE';
  UPDATE erp_inventory.number_series_counter SET last_number = v_mat_after WHERE series_id = v_mat_series AND financial_year = '2026-27';

  -- 7. Prove the result.
  SELECT count(*) INTO v_bad FROM tmp_extra e
   WHERE (SELECT count(*) FROM erp_procurement.sales_invoice s WHERE s.dc_id = e.dc_id AND s.status = 'POSTED') <> 1;
  IF v_bad <> 0 THEN RAISE EXCEPTION 'ABORT: % delivery order(s) do not have exactly one POSTED invoice afterwards', v_bad; END IF;
  FOR rec IN
    SELECT s.quantity AS sq, (SELECT sum(l.posted_quantity) FROM erp_inventory.stock_ledger l
             WHERE l.company_id = b.company_id AND l.storage_location_id = b.storage_location_id AND l.material_id = b.material_id AND l.stock_type_code = b.stock_type_code) AS lq
    FROM tmp_bucket b JOIN erp_inventory.stock_snapshot s
      ON s.company_id = b.company_id AND s.storage_location_id = b.storage_location_id AND s.material_id = b.material_id AND s.stock_type_code = b.stock_type_code AND s.batch_id IS NULL
  LOOP
    IF abs(rec.sq - coalesce(rec.lq, 0)) > 0.0005 THEN RAISE EXCEPTION 'ABORT: snapshot % <> ledger % after the clean-up', rec.sq, rec.lq; END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_rules WHERE schemaname = 'erp_inventory' AND tablename = 'stock_ledger' AND rulename = 'stock_ledger_no_delete') THEN
    RAISE EXCEPTION 'ABORT: stock_ledger_no_delete rule was not restored';
  END IF;

  v_summary := format('invoices deleted=66, lines=67, stock_documents=67, ledger=67, qty restored=1007000 in 3 buckets; SALES_INVOICE counter %s -> %s; MATDOC counter %s -> %s; archive rows=%s',
    v_inv_before, v_inv_after, v_mat_before, v_mat_after, (SELECT count(*) FROM erp_history.duplicate_pgi_cleanup_20261114));
  IF v_rehearsal THEN
    RAISE EXCEPTION 'REHEARSAL OK (rolled back, nothing changed): %', v_summary;
  END IF;
  RAISE NOTICE 'CLEANUP DONE: %', v_summary;
END
$cleanup$;
