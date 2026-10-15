-- Historical Operations Data Foundation — post-migration / post-import checks
-- Read-only verification SQL. Run against DEV or PROD separately.

-- 1. No historical source crossed the hard cutover.
SELECT 'production_after_cutover' AS check_name, count(*) AS failures
FROM erp_history.production_actual WHERE production_date >= DATE '2026-10-01'
UNION ALL
SELECT 'dispatch_after_cutover', count(*)
FROM erp_history.fg_dispatch_actual WHERE dispatch_date >= DATE '2026-10-01';

-- 2. No invalid historical dispatch is counted as valid dispatched KG.
SELECT company_id, count(*) AS invalid_counted_rows
FROM erp_history.fg_dispatch_actual
WHERE (cancellation_flag OR validation_status <> 'VALIDATED' OR dispatch_date IS NULL)
  AND normalized_dispatched_kg IS NOT NULL
GROUP BY company_id;

-- 3. Source identity is unique, even across corrected re-imports.
SELECT company_id, source_system, source_file_key, source_sheet_name,
       source_row_number, source_line_key, count(*) AS duplicate_count
FROM erp_history.production_actual
GROUP BY 1,2,3,4,5,6 HAVING count(*) > 1
UNION ALL
SELECT company_id, source_system, source_file_key, source_sheet_name,
       source_row_number, source_line_key, count(*)
FROM erp_history.fg_dispatch_actual
GROUP BY 1,2,3,4,5,6 HAVING count(*) > 1;

-- 4. Reconcile each committed batch to the current source-row snapshot.
SELECT b.id, b.record_kind, b.source_file_key, b.source_sheet_name,
       b.submitted_row_count, b.imported_row_count, b.exception_row_count,
       b.normalized_kg_total, b.status, b.committed_at
FROM erp_history.import_batch b
ORDER BY b.created_at DESC;

-- 5. Historical history is isolated from operational stock: record the
--    pre/post counts of these operational tables during a test import. They
--    must be identical. This query is a snapshot aid, not a mutation.
SELECT
  (SELECT count(*) FROM erp_inventory.stock_ledger) AS stock_ledger_rows,
  (SELECT count(*) FROM erp_inventory.stock_document) AS stock_document_rows,
  (SELECT count(*) FROM erp_procurement.sales_invoice) AS sales_invoice_rows,
  (SELECT count(*) FROM erp_procurement.delivery_challan) AS delivery_order_rows;
