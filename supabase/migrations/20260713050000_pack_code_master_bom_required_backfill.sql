/*
 * Migration: 20260713050000_pack_code_master_bom_required_backfill
 * Gate: 27.15/27.22
 * Purpose: Reconcile another confirmed MCP-vs-Migration violation, found
 *          while preparing the first prod deploy (2026-07-26):
 *          erp_production.pack_code_master.bom_required and .description
 *          were added directly on dev via MCP execute_sql (§83.15 Pack BOM
 *          design — bom_required drives whether a Pack BOM's PM lines are
 *          mandatory) and never captured in any migration file. Replaying
 *          migrations in order on a fresh database (prod) reaches
 *          20260713050328_gate27_22_pack_bom_full_rebuild_fixed_order3.sql's
 *          INSERT into pack_code_master (which lists bom_required) before
 *          the column exists, and fails with
 *          "column \"bom_required\" of relation \"pack_code_master\" does not exist".
 *
 * ⚠️ Placed at 20260713050000, deliberately BEFORE 20260713050328.
 */

BEGIN;

ALTER TABLE erp_production.pack_code_master
  ADD COLUMN IF NOT EXISTS bom_required BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE erp_production.pack_code_master
  ADD COLUMN IF NOT EXISTS description TEXT;

COMMIT;
