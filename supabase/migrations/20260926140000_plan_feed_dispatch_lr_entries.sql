/*
 * File-Path: supabase/migrations/20260926140000_plan_feed_dispatch_lr_entries.sql
 * Purpose: Per-dispatch Transporter Name / LR Number / LR Date tracking on
 *          Plan Feed (FO). One entry auto-appends per PGI'd dispatch (Sales
 *          Invoice posted for a Delivery Order under this FO), copied from
 *          that DO's own transporter_id/lr_number/lr_date -- a one-way,
 *          one-time copy. The user can freely add/edit/remove entries in
 *          Edit FO afterwards; this column is never read back into
 *          erp_procurement.delivery_challan, so editing it can never affect
 *          the DO or its Invoice.
 *          A plain jsonb array column (not a child table) since this is a
 *          small, per-FO, order-independent list with no relational query
 *          need of its own -- the Total Table already reads the plan_feed
 *          row directly, so this column comes along for free with zero new
 *          joins.
 */

BEGIN;

ALTER TABLE erp_production.plan_feed
  ADD COLUMN IF NOT EXISTS dispatch_lr_entries jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Atomic append (avoids a read-then-write race if two dispatches under the
-- same FO get PGI'd at nearly the same time) -- each entry is
-- {transporter_name, lr_number, lr_date, source_dc_id}.
CREATE OR REPLACE FUNCTION erp_production.append_plan_feed_dispatch_lr_entry(
  p_fo_id uuid,
  p_entry jsonb
)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE erp_production.plan_feed
  SET dispatch_lr_entries = dispatch_lr_entries || jsonb_build_array(p_entry)
  WHERE id = p_fo_id;
$$;

COMMIT;
