-- Plan Feed session (2026-09-02): FO Number becomes revisable (see
-- plan_feed.handlers.ts's updatePlanFeed() comment for why this is safe --
-- every real relationship keys off plan_feed.id, never fo_number), plus two
-- new confirmation-date fields captured after FO creation.
ALTER TABLE erp_production.plan_feed
  ADD COLUMN original_fo_number text,
  ADD COLUMN order_confirmation_date date,
  ADD COLUMN formula_confirmation_date date;

-- Backfill: every existing FO's "original" number is simply its current one --
-- nothing has been revised yet.
UPDATE erp_production.plan_feed SET original_fo_number = fo_number WHERE original_fo_number IS NULL;

NOTIFY pgrst, 'reload schema';
