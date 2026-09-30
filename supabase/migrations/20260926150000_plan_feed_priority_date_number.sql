/*
 * File-Path: supabase/migrations/20260926150000_plan_feed_priority_date_number.sql
 * Purpose: Plan Feed "Prioritize" feature -- Priority Date + Priority Number
 *          on each FO (MTO/HPS only, business-owner-set dispatch priority).
 *          A (company, priority_date, priority_number) pair must be unique --
 *          the same date cannot have two FOs both claiming the same priority
 *          rank. Partial unique index (only enforced once both values are
 *          set) so FOs with no priority assigned yet never collide.
 */

BEGIN;

ALTER TABLE erp_production.plan_feed
  ADD COLUMN IF NOT EXISTS priority_date date,
  ADD COLUMN IF NOT EXISTS priority_number integer CHECK (priority_number IS NULL OR priority_number > 0);

CREATE UNIQUE INDEX IF NOT EXISTS ux_plan_feed_priority_date_number
  ON erp_production.plan_feed (company_id, priority_date, priority_number)
  WHERE priority_date IS NOT NULL AND priority_number IS NOT NULL;

COMMIT;
