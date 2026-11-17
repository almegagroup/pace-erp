-- 2026-11-17 prod data fix (CMP005 receipts of CMP003 FG STOs). Run as ONE transaction; every guard below raises -> rollback.
--
-- A) November STOs (ASCS2627-0015 / -0016, LR 03 Nov / 12 Nov): GE 1000001300/1301 + GRN 2000001463/1464 were entered by
--    mistake -> deleted completely (gate entry, lines, gate exit, GRN, stock document + ledger), stock snapshot rolled back,
--    CSN back to TRN, STO lines back to OPEN, GE / GRN / MATDOC counters stepped back. Dispatch is untouched.
-- B) October STOs (ACS2627-0001, ASCS2627-0013, ASCS2627-0014): GE 1000001297/98/99 + their 11 GRNs re-dated to
--    LR date + 5 days in gate_entry, gate_exit_inbound, goods_receipt (grn_date + posting_date), stock_document
--    (posting_date + document_date), stock_ledger (posting_date), consignment_note (gate_entry_date + grn_date).
-- stock_ledger is append-only through two rules; they are dropped for this transaction and re-created identically.
-- NOTE: the before-image copy goes into erp_history.fg_sto_grn_cleanup_20261117 (id, source_table, source_key, row_data jsonb,
-- archived_at). That table was created by hand on prod only (no migration, by design -- this is a one-off MCP correction);
-- create it the same way before re-running this script anywhere else, and drop it once the backup is no longer needed.
BEGIN;

CREATE TEMP TABLE _ge_all ON COMMIT DROP AS
SELECT ge.id, ge.ge_number FROM erp_procurement.gate_entry ge
WHERE ge.ge_number IN ('1000001297','1000001298','1000001299','1000001300','1000001301');
CREATE TEMP TABLE _ge_del ON COMMIT DROP AS SELECT * FROM _ge_all WHERE ge_number IN ('1000001300','1000001301');
CREATE TEMP TABLE _ge_oct ON COMMIT DROP AS
SELECT a.id, a.ge_number, (max(c.lr_date) + 5) AS new_date
FROM _ge_all a JOIN erp_procurement.gate_entry_line l ON l.gate_entry_id = a.id
JOIN erp_procurement.consignment_note c ON c.id = l.csn_id
WHERE a.ge_number IN ('1000001297','1000001298','1000001299') GROUP BY a.id, a.ge_number;
CREATE TEMP TABLE _gr_del ON COMMIT DROP AS
SELECT r.id, r.grn_number, r.stock_document_id, r.stock_ledger_id, r.gate_entry_line_id FROM erp_procurement.goods_receipt r WHERE r.gate_entry_id IN (SELECT id FROM _ge_del);
CREATE TEMP TABLE _gr_oct ON COMMIT DROP AS
SELECT r.id, r.stock_document_id, o.new_date FROM erp_procurement.goods_receipt r JOIN _ge_oct o ON o.id = r.gate_entry_id;

-- ---- guards (state must be exactly what was inspected) ----
DO $$
DECLARE v_csn_nov int; v_led int; v_snap record;
BEGIN
  IF (SELECT count(*) FROM _ge_all) <> 5 OR (SELECT count(*) FROM _ge_del) <> 2 OR (SELECT count(*) FROM _ge_oct) <> 3 THEN RAISE EXCEPTION 'GE set mismatch'; END IF;
  IF (SELECT count(*) FROM _gr_del) <> 2 OR (SELECT count(*) FROM _gr_oct) <> 11 THEN RAISE EXCEPTION 'GRN set mismatch'; END IF;
  IF (SELECT array_agg(grn_number ORDER BY grn_number) FROM _gr_del) <> ARRAY['2000001463','2000001464'] THEN RAISE EXCEPTION 'unexpected GRN numbers'; END IF;
  IF (SELECT max(grn_number) FROM erp_procurement.goods_receipt) <> '2000001464' OR (SELECT max(ge_number) FROM erp_procurement.gate_entry) <> '1000001301' THEN RAISE EXCEPTION 'GE/GRN are not the latest numbers'; END IF;
  IF (SELECT count(*) FROM _gr_oct WHERE new_date IS NULL) > 0 THEN RAISE EXCEPTION 'missing LR date'; END IF;
  SELECT count(*) INTO v_led FROM erp_inventory.stock_ledger WHERE stock_document_id IN (SELECT stock_document_id FROM _gr_del);
  IF v_led <> 2 THEN RAISE EXCEPTION 'expected 2 ledger rows, got %', v_led; END IF;
  IF EXISTS (SELECT 1 FROM erp_inventory.stock_ledger l WHERE l.stock_document_id IN (SELECT stock_document_id FROM _gr_del)
             AND EXISTS (SELECT 1 FROM erp_inventory.stock_ledger o WHERE o.company_id=l.company_id AND o.material_id=l.material_id AND o.storage_location_id=l.storage_location_id AND o.stock_type_code=l.stock_type_code AND o.ledger_seq > l.ledger_seq AND o.stock_document_id NOT IN (SELECT stock_document_id FROM _gr_del)))
  THEN RAISE EXCEPTION 'later ledger postings exist on the same bucket'; END IF;
  IF (SELECT count(*) FROM erp_procurement.goods_receipt_line WHERE grn_id IN (SELECT id FROM _gr_del)) > 0
     OR (SELECT count(*) FROM erp_procurement.inward_qa_document WHERE grn_id IN (SELECT id FROM _gr_del)) > 0
     OR (SELECT count(*) FROM erp_procurement.landed_cost WHERE grn_id IN (SELECT id FROM _gr_del)) > 0
     OR (SELECT count(*) FROM erp_procurement.return_to_vendor WHERE grn_id IN (SELECT id FROM _gr_del)) > 0
     OR (SELECT count(*) FROM erp_procurement.invoice_verification_line WHERE grn_id IN (SELECT id FROM _gr_del)) > 0
  THEN RAISE EXCEPTION 'downstream documents exist on a GRN to delete'; END IF;
END $$;

-- ---- archive (before any change) ----
INSERT INTO erp_history.fg_sto_grn_cleanup_20261117 (source_table, source_key, row_data)
SELECT 'gate_entry', ge_number, to_jsonb(g) FROM erp_procurement.gate_entry g WHERE g.id IN (SELECT id FROM _ge_all)
UNION ALL SELECT 'gate_entry_line', l.id::text, to_jsonb(l) FROM erp_procurement.gate_entry_line l WHERE l.gate_entry_id IN (SELECT id FROM _ge_all)
UNION ALL SELECT 'gate_exit_inbound', x.id::text, to_jsonb(x) FROM erp_procurement.gate_exit_inbound x WHERE x.gate_entry_id IN (SELECT id FROM _ge_all)
UNION ALL SELECT 'goods_receipt', r.grn_number, to_jsonb(r) FROM erp_procurement.goods_receipt r WHERE r.gate_entry_id IN (SELECT id FROM _ge_all)
UNION ALL SELECT 'stock_document', d.document_number, to_jsonb(d) FROM erp_inventory.stock_document d WHERE d.id IN (SELECT stock_document_id FROM _gr_del UNION SELECT stock_document_id FROM _gr_oct)
UNION ALL SELECT 'stock_ledger', l.ledger_seq::text, to_jsonb(l) FROM erp_inventory.stock_ledger l WHERE l.stock_document_id IN (SELECT stock_document_id FROM _gr_del UNION SELECT stock_document_id FROM _gr_oct)
UNION ALL SELECT 'consignment_note', c.csn_number, to_jsonb(c) FROM erp_procurement.consignment_note c WHERE c.gate_entry_id IN (SELECT id FROM _ge_all)
UNION ALL SELECT 'stock_transfer_order_line', sl.id::text, to_jsonb(sl) FROM erp_procurement.stock_transfer_order_line sl WHERE sl.id IN (SELECT sto_line_id FROM erp_procurement.gate_entry_line WHERE gate_entry_id IN (SELECT id FROM _ge_del))
UNION ALL SELECT 'stock_snapshot', s.id::text, to_jsonb(s) FROM erp_inventory.stock_snapshot s WHERE (s.company_id, s.storage_location_id, s.material_id, s.stock_type_code) IN (SELECT l.company_id, l.storage_location_id, l.material_id, l.stock_type_code FROM erp_inventory.stock_ledger l WHERE l.stock_document_id IN (SELECT stock_document_id FROM _gr_del)) AND s.batch_id IS NULL
UNION ALL SELECT 'document_number_series', doc_type, to_jsonb(s) FROM erp_procurement.document_number_series s WHERE doc_type IN ('GE','GRN')
UNION ALL SELECT 'number_series_counter', n.id::text, to_jsonb(n) FROM erp_inventory.number_series_counter n WHERE n.id = '4774b717-df08-467c-aad7-c4821361ff37';

-- ================= A) delete the November chains =================
-- A1 stock snapshot: back to the balance before the two receipts (only the receipts' own ledger rows are removed)
CREATE TEMP TABLE _snap_fix ON COMMIT DROP AS
SELECT s.id AS snap_id,
       s.quantity - sum(l.quantity) AS new_qty,
       s.value - sum(l.value)       AS new_value,
       (SELECT o.id FROM erp_inventory.stock_ledger o WHERE o.company_id=s.company_id AND o.material_id=s.material_id AND o.storage_location_id=s.storage_location_id AND o.stock_type_code=s.stock_type_code AND o.stock_document_id NOT IN (SELECT stock_document_id FROM _gr_del) ORDER BY o.ledger_seq DESC LIMIT 1) AS new_last_ledger
FROM erp_inventory.stock_ledger l
JOIN erp_inventory.stock_snapshot s ON s.company_id=l.company_id AND s.storage_location_id=l.storage_location_id AND s.material_id=l.material_id AND s.stock_type_code=l.stock_type_code AND s.batch_id IS NULL
WHERE l.stock_document_id IN (SELECT stock_document_id FROM _gr_del) AND l.direction = 'IN'
GROUP BY s.id, s.quantity, s.value, s.company_id, s.material_id, s.storage_location_id, s.stock_type_code;
UPDATE erp_inventory.stock_snapshot s
SET quantity = f.new_qty, value = f.new_value,
    valuation_rate = CASE WHEN f.new_qty > 0 THEN round(f.new_value / f.new_qty, 6) ELSE s.valuation_rate END,
    last_ledger_id = f.new_last_ledger, last_updated_at = now()
FROM _snap_fix f WHERE s.id = f.snap_id;

-- A2 CSN back to "in transit" (what the dispatch left it as)
UPDATE erp_procurement.consignment_note c
SET status = 'TRN', pre_ge_status = NULL, gate_entry_id = NULL, gate_entry_date = NULL, grn_id = NULL, grn_date = NULL,
    received_qty = NULL, total_received_qty = 0, last_updated_at = now()
WHERE c.gate_entry_id IN (SELECT id FROM _ge_del);

-- A3 STO lines: nothing received any more
UPDATE erp_procurement.stock_transfer_order_line sl
SET received_qty = 0, balance_qty = sl.quantity, line_status = 'OPEN', last_updated_at = now()
WHERE sl.id IN (SELECT sto_line_id FROM erp_procurement.gate_entry_line WHERE gate_entry_id IN (SELECT id FROM _ge_del));

-- A4 documents (children first)
DELETE FROM erp_procurement.goods_receipt WHERE id IN (SELECT id FROM _gr_del);
DELETE FROM erp_procurement.gate_exit_inbound WHERE gate_entry_id IN (SELECT id FROM _ge_del);
DELETE FROM erp_procurement.gate_entry_line WHERE gate_entry_id IN (SELECT id FROM _ge_del);
DELETE FROM erp_procurement.gate_entry WHERE id IN (SELECT id FROM _ge_del);
DROP RULE stock_ledger_no_delete ON erp_inventory.stock_ledger;
DELETE FROM erp_inventory.stock_ledger WHERE stock_document_id IN (SELECT stock_document_id FROM _gr_del);
CREATE RULE stock_ledger_no_delete AS ON DELETE TO erp_inventory.stock_ledger DO INSTEAD NOTHING;
DELETE FROM erp_inventory.stock_document WHERE id IN (SELECT stock_document_id FROM _gr_del);

-- A5 counters step back (these were the latest numbers; checked above)
UPDATE erp_procurement.document_number_series SET last_number = 1000001299 WHERE doc_type = 'GE'  AND last_number = 1000001301;
UPDATE erp_procurement.document_number_series SET last_number = 2000001462 WHERE doc_type = 'GRN' AND last_number = 2000001464;
UPDATE erp_inventory.number_series_counter SET last_number = 1094 WHERE id = '4774b717-df08-467c-aad7-c4821361ff37' AND last_number = 1096;

-- ================= B) October chains: LR date + 5 days =================
DROP RULE stock_ledger_no_update ON erp_inventory.stock_ledger;
UPDATE erp_procurement.gate_entry g SET ge_date = o.new_date, last_updated_at = now() FROM _ge_oct o WHERE g.id = o.id;
UPDATE erp_procurement.gate_exit_inbound x SET exit_date = o.new_date FROM _ge_oct o WHERE x.gate_entry_id = o.id;
UPDATE erp_procurement.goods_receipt r SET grn_date = g.new_date, posting_date = g.new_date, last_updated_at = now() FROM _gr_oct g WHERE r.id = g.id;
UPDATE erp_inventory.stock_document d SET posting_date = g.new_date, document_date = g.new_date FROM _gr_oct g WHERE d.id = g.stock_document_id;
UPDATE erp_inventory.stock_ledger l SET posting_date = g.new_date FROM _gr_oct g WHERE l.stock_document_id = g.stock_document_id;
UPDATE erp_procurement.consignment_note c SET gate_entry_date = o.new_date, grn_date = o.new_date, last_updated_at = now() FROM _ge_oct o WHERE c.gate_entry_id = o.id;
CREATE RULE stock_ledger_no_update AS ON UPDATE TO erp_inventory.stock_ledger DO INSTEAD NOTHING;

-- ---- post-checks ----
DO $$
DECLARE v_bad int;
BEGIN
  IF (SELECT count(*) FROM pg_rules WHERE schemaname='erp_inventory' AND tablename='stock_ledger') <> 2 THEN RAISE EXCEPTION 'ledger rules not restored'; END IF;
  IF EXISTS (SELECT 1 FROM erp_procurement.gate_entry WHERE ge_number IN ('1000001300','1000001301')) THEN RAISE EXCEPTION 'GE not deleted'; END IF;
  IF EXISTS (SELECT 1 FROM erp_procurement.goods_receipt WHERE grn_number IN ('2000001463','2000001464')) THEN RAISE EXCEPTION 'GRN not deleted'; END IF;
  SELECT count(*) INTO v_bad FROM erp_procurement.goods_receipt r JOIN erp_procurement.gate_entry g ON g.id=r.gate_entry_id
   WHERE g.ge_number IN ('1000001297','1000001298','1000001299') AND (r.grn_date <> g.ge_date OR r.posting_date <> g.ge_date);
  IF v_bad > 0 THEN RAISE EXCEPTION 'GRN/GE date mismatch'; END IF;
  -- snapshot must equal the ledger for every bucket touched
  SELECT count(*) INTO v_bad FROM erp_inventory.stock_snapshot s
   WHERE s.id IN (SELECT snap_id FROM _snap_fix)
     AND abs(s.quantity - (SELECT coalesce(sum(CASE WHEN l.direction='IN' THEN l.quantity ELSE -l.quantity END),0) FROM erp_inventory.stock_ledger l WHERE l.company_id=s.company_id AND l.material_id=s.material_id AND l.storage_location_id=s.storage_location_id AND l.stock_type_code=s.stock_type_code)) > 0.0001;
  IF v_bad > 0 THEN RAISE EXCEPTION 'snapshot does not match ledger'; END IF;
END $$;

COMMIT;
