/*
 * File-ID: 27.28
 * File-Path: supabase/migrations/20260808103000_plan_feed_sales_order_link.sql
 * Gate: 27
 * Domain: PRODUCTION + PROCUREMENT
 * Purpose: Formalize optional Sales Order line -> Plan Feed linkage so FO cancel can
 *          safely release SO mappings and DO dependency checks can follow a stable key.
 * Authority: Backend
 */

BEGIN;

ALTER TABLE erp_procurement.sales_order_line
  ADD COLUMN IF NOT EXISTS plan_feed_id uuid NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sales_order_line_plan_feed_id_fkey'
  ) THEN
    ALTER TABLE erp_procurement.sales_order_line
      ADD CONSTRAINT sales_order_line_plan_feed_id_fkey
      FOREIGN KEY (plan_feed_id)
      REFERENCES erp_production.plan_feed(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_sol_plan_feed_id
  ON erp_procurement.sales_order_line (plan_feed_id)
  WHERE plan_feed_id IS NOT NULL;

COMMENT ON COLUMN erp_procurement.sales_order_line.plan_feed_id IS
'Optional formal FO link. Used so Plan Feed cancel/reactivate can safely unlink SO lines and enforce DO-first cancellation when an FO-backed SO line already flowed into Delivery Order.';

COMMIT;
