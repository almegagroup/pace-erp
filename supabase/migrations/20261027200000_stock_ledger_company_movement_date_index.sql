-- history_planning_actuals() live legs keep only P101/P102 (production) and
-- P601/P602 (dispatch) rows, ~7% of a company's ledger in the posting window.
-- (company_id, posting_date) still reads and discards ~44k heap rows per call
-- (prod CMP003: 1.3s). Leading with movement_type_code lets the scan touch only
-- the matching rows.
CREATE INDEX IF NOT EXISTS ix_stock_ledger_company_movement_date
  ON erp_inventory.stock_ledger (company_id, movement_type_code, posting_date);
