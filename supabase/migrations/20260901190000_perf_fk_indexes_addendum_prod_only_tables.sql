/*
 * File-Path: supabase/migrations/20260901190000_perf_fk_indexes_addendum_prod_only_tables.sql
 * Gate: PERF
 * Phase: POST-L2
 * Domain: DB / PERF
 * Purpose:
 *   Addendum to 20260901180000 -- 11 unindexed_foreign_keys findings that
 *   remained on PROD after that migration because the generator query for
 *   it was run against DEV, and these specific tables
 *   (erp_procurement.procurement_monthly_plan* + planning_sloc_group_member,
 *   erp_production.process_order.fg_stock_ledger_id,
 *   erp_production.process_order_line.stock_ledger_id) turned out to not
 *   exist in dev at all -- confirmed via information_schema.tables, zero
 *   rows. This is a real, previously-unknown dev/prod schema drift (these
 *   tables are Procurement Planning / PO11 workspace tables, created by
 *   20260808120000_po11_procurement_planning_workspace.sql, which IS
 *   recorded as applied in dev's own schema_migrations -- the DDL never
 *   actually took in dev, or was dropped after). Flagged here, not
 *   investigated further -- out of scope for this pass.
 *
 *   Every statement below is guarded with a to_regclass() existence check
 *   so this migration is a safe no-op on dev (table missing) and does the
 *   real fix on prod (table present) -- and will self-heal on dev too,
 *   automatically, whenever that drift eventually gets resolved.
 */

DO $$
BEGIN
  IF to_regclass('erp_procurement.planning_sloc_group_member') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_fk_planning_sloc_group_member_storage_location_id
      ON erp_procurement.planning_sloc_group_member (storage_location_id)';
  END IF;

  IF to_regclass('erp_procurement.procurement_monthly_plan') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_fk_procurement_monthly_plan_carry_forward_from_plan_id
      ON erp_procurement.procurement_monthly_plan (carry_forward_from_plan_id)';
  END IF;

  IF to_regclass('erp_procurement.procurement_monthly_plan_archive_group_config') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_fk_pmp_archive_group_config_planning_item_group_id
      ON erp_procurement.procurement_monthly_plan_archive_group_config (planning_item_group_id)';
  END IF;

  IF to_regclass('erp_procurement.procurement_monthly_plan_archive_line') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_fk_procurement_monthly_plan_archive_line_material_id
      ON erp_procurement.procurement_monthly_plan_archive_line (material_id)';
  END IF;

  IF to_regclass('erp_procurement.procurement_monthly_plan_group_config') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_fk_pmp_group_config_planning_item_group_id
      ON erp_procurement.procurement_monthly_plan_group_config (planning_item_group_id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_fk_procurement_monthly_plan_group_config_company_id
      ON erp_procurement.procurement_monthly_plan_group_config (company_id)';
  END IF;

  IF to_regclass('erp_procurement.procurement_monthly_plan_line') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_fk_procurement_monthly_plan_line_material_id
      ON erp_procurement.procurement_monthly_plan_line (material_id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_fk_procurement_monthly_plan_line_planning_item_group_id
      ON erp_procurement.procurement_monthly_plan_line (planning_item_group_id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_fk_procurement_monthly_plan_line_source_sloc_group_id
      ON erp_procurement.procurement_monthly_plan_line (source_sloc_group_id)';
  END IF;

  IF to_regclass('erp_production.process_order') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_fk_process_order_fg_stock_ledger_id
      ON erp_production.process_order (fg_stock_ledger_id)';
  END IF;

  IF to_regclass('erp_production.process_order_line') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_fk_process_order_line_stock_ledger_id
      ON erp_production.process_order_line (stock_ledger_id)';
  END IF;
END $$;
