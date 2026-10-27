-- Prod Disk IO budget warning (2026-10-27): two report paths scan far more
-- than they return.
--
-- 1. stock_ledger (company_id, posting_date)
--    history_planning_actuals() live legs and the PR24 posting-scoped lookup
--    filter by company + posting_date, but the only company index is
--    (company_id, material_id): CMP003 read 50k ledger rows to keep 3.3k.
--
-- 2. fg_dispatch_actual (company_id, dispatch_date)
--    history_planning_actuals() coverage query has no cancellation_flag
--    filter, so the partial date index cannot be used and it fell back to the
--    unique source-row index plus a date filter (~2.2s per call on prod).
--
-- Both tables are small (<100k rows); a plain CREATE INDEX holds its lock
-- only briefly.

CREATE INDEX IF NOT EXISTS ix_stock_ledger_company_posting_date
  ON erp_inventory.stock_ledger (company_id, posting_date);

DO $$
BEGIN
  IF to_regclass('erp_history.fg_dispatch_actual') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS ix_history_dispatch_company_date
      ON erp_history.fg_dispatch_actual (company_id, dispatch_date);
  END IF;
END $$;
