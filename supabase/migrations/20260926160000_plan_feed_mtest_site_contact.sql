/*
 * File-Path: supabase/migrations/20260926160000_plan_feed_mtest_site_contact.sql
 * Purpose: MTEST FO -- Site Contact Person + Contact Person Number, manually
 *          entered by the user at Create/Edit FO. Plain nullable text
 *          columns on plan_feed (not MTEST-scoped by a CHECK constraint --
 *          the frontend gates visibility to MTEST FOs, the backend simply
 *          stores whatever is sent).
 */

BEGIN;

ALTER TABLE erp_production.plan_feed
  ADD COLUMN IF NOT EXISTS site_contact_person text,
  ADD COLUMN IF NOT EXISTS site_contact_number text;

COMMIT;
