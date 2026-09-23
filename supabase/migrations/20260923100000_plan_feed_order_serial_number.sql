/*
 * File-Path: supabase/migrations/20260923100000_plan_feed_order_serial_number.sql
 * Purpose: Plan Feed gets a manual-entry "Order Serial Number" field, shown in the
 *          Total Table immediately before FO Number. Same convention as
 *          original_fo_number/order_confirmation_date (20260902100000): free-text,
 *          user-entered at Create, editable at Edit FO, never system-derived.
 * Authority: Backend
 */

ALTER TABLE erp_production.plan_feed
  ADD COLUMN IF NOT EXISTS order_serial_number text;
