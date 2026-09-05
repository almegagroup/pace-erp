-- AC06 "Wastage %/OTHER" column -- business owner directive 2026-09-05, after
-- reverse-engineering a real manual costing worksheet (SKU 6763PH70599) that
-- reconciled to the last paisa against a Sales Order rate. The worksheet
-- stores the adjustment used on top of each item's approved AC06 rate before
-- it feeds RMC/PMC. Despite the legacy column name, the business meaning is
-- row-dependent: RM/INT and ordinary PM values are percentages, while a
-- Barrel's OTHER value is a flat currency amount per Barrel unit (for example,
-- 10 means Rs 10, never 10%). AC07 must read the stored monthly value and must
-- not hardcode a Barrel amount. This was never captured anywhere before --
-- AC06's own rate alone reproduced every RM line exactly, but the FG cost
-- computed from it undershot the real SO rate by ~0.35% until this factor
-- is included.
--
-- Stored per (month, material) line, same shape as `rate` -- carries forward
-- month to month (see ac06_workspace.handlers.ts's getMonth() carry-forward
-- read), and is also captured on the immutable per-month archive so a closed
-- month's report still shows the same figure.

ALTER TABLE erp_production.ac06_month_line
  ADD COLUMN IF NOT EXISTS wastage_other_pct numeric NOT NULL DEFAULT 0;

ALTER TABLE erp_production.ac06_month_archive_line
  ADD COLUMN IF NOT EXISTS wastage_other_pct numeric NOT NULL DEFAULT 0;

NOTIFY pgrst, 'reload schema';
