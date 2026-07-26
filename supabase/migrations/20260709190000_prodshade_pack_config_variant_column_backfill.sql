/*
 * Migration: 20260709190000_prodshade_pack_config_variant_column_backfill
 * Gate: 27.1
 * Purpose: Reconcile a real, confirmed MCP-vs-Migration violation found while
 *          preparing the first prod deploy (2026-07-26): erp_production.
 *          prodshade_pack_config's `company_id` column was DROPPED and a new
 *          `variant TEXT` column was ADDED directly on dev via MCP execute_sql
 *          at some point after the table's original CREATE (§83.17 design
 *          correction — Prodshade Pack Config stays GLOBAL, not company-scoped —
 *          see feasibility doc §83.15 2026-07-13). Neither change was ever
 *          captured in a migration file, so replaying migrations in order on a
 *          fresh database (prod) reaches 20260709191704's
 *          `CREATE UNIQUE INDEX ... COALESCE(variant, '')` before `variant`
 *          exists, and fails with "column \"variant\" does not exist".
 *
 *          This migration performs the same two changes, idempotently, so a
 *          fresh replay (prod) ends up with the exact same live structure dev
 *          already has. On dev itself this is a no-op (both guards already
 *          satisfied).
 *
 * ⚠️ Placed at 20260709190000, deliberately BEFORE 20260709191704, so it runs
 *    before the index-creation migration that depends on `variant` existing.
 */

BEGIN;

ALTER TABLE erp_production.prodshade_pack_config
  DROP COLUMN IF EXISTS company_id CASCADE;

ALTER TABLE erp_production.prodshade_pack_config
  ADD COLUMN IF NOT EXISTS variant TEXT;

COMMIT;
