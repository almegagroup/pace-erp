-- AC06 "Wastage %/OTHER" column -- business owner directive 2026-09-05, after
-- reverse-engineering a real manual costing worksheet (SKU 6763PH70599) that
-- reconciled to the last paisa against a Sales Order rate. The worksheet
-- applies a fixed multiplicative buffer on top of each item's approved AC06
-- rate before it feeds RMC/PMC: RM/INT get +0.5% (an assumed yield/wastage
-- factor applied to the whole dosage-weighted RM cost), PM/packaging items
-- get their own +5% (or, for the outer container itself -- barrels/drums --
-- a materially larger +10%, since unloading/handling loss is higher for a
-- bulky container than a label). This was never captured anywhere before --
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
