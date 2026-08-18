-- Stock Ledger: signed "posted" quantity/value columns (business owner-locked design,
-- 2026-08-18 sign-convention discussion). See feasibility doc Section 124.
--
-- erp_inventory.stock_ledger stores quantity/value as always-positive, with direction
-- (IN/OUT) as a separate column -- correct for human-readable display (existing reports
-- like PR24/PR14/IN02 keep working unchanged), but a plain SUM(quantity)/SUM(value) across
-- mixed IN+OUT rows silently adds instead of netting, which is exactly the wrong answer for
-- any future Dispatch/Costing/Reco report.
--
-- Fix: two GENERATED ALWAYS ... STORED columns that fold direction into the sign
-- automatically, for every row past and future -- no backfill, no per-report CASE WHEN ever
-- needed again. quantity/value themselves are untouched; every existing consumer keeps
-- reading the unsigned columns exactly as before.

ALTER TABLE erp_inventory.stock_ledger
  ADD COLUMN posted_quantity numeric GENERATED ALWAYS AS (
    CASE WHEN direction = 'OUT' THEN -quantity ELSE quantity END
  ) STORED,
  ADD COLUMN posted_value numeric GENERATED ALWAYS AS (
    CASE WHEN direction = 'OUT' THEN -value ELSE value END
  ) STORED;

COMMENT ON COLUMN erp_inventory.stock_ledger.posted_quantity IS
  'Signed quantity (negative for OUT, positive for IN) -- derived from quantity+direction. Use SUM(posted_quantity) for any net/running-balance/Reco calculation instead of quantity+direction case logic.';
COMMENT ON COLUMN erp_inventory.stock_ledger.posted_value IS
  'Signed value (negative for OUT, positive for IN) -- derived from value+direction. Use SUM(posted_value) for any net/running-balance/Reco calculation instead of value+direction case logic.';
