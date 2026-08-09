/*
 * File-Path: supabase/migrations/20260809133000_po11_month_group_config.sql
 * Purpose: Add month-scoped PO11 item-group planning config and archive snapshot tables.
 * Authority: Backend
 */

BEGIN;

CREATE TABLE IF NOT EXISTS erp_procurement.procurement_monthly_plan_group_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES erp_procurement.procurement_monthly_plan(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES erp_master.companies(id),
  planning_item_group_id uuid NOT NULL REFERENCES erp_procurement.planning_item_group(id) ON DELETE CASCADE,
  monthly_requirement_qty numeric(20,6) NOT NULL DEFAULT 0 CHECK (monthly_requirement_qty >= 0),
  safety_days numeric(12,3) NOT NULL DEFAULT 0 CHECK (safety_days >= 0),
  processing_time_days numeric(12,3) NOT NULL DEFAULT 0 CHECK (processing_time_days >= 0),
  lead_time_days numeric(12,3) NOT NULL DEFAULT 0 CHECK (lead_time_days >= 0),
  fixed_safety_stock_qty numeric(20,6) NULL CHECK (fixed_safety_stock_qty >= 0),
  fixed_replenishment_stock_qty numeric(20,6) NULL CHECK (fixed_replenishment_stock_qty >= 0),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_updated_by uuid NULL,
  last_updated_at timestamptz NULL,
  UNIQUE (plan_id, planning_item_group_id)
);

CREATE TABLE IF NOT EXISTS erp_procurement.procurement_monthly_plan_archive_group_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id uuid NOT NULL REFERENCES erp_procurement.procurement_monthly_plan_archive(id) ON DELETE CASCADE,
  planning_item_group_id uuid NULL REFERENCES erp_procurement.planning_item_group(id) ON DELETE SET NULL,
  planning_item_group_name_snapshot text NOT NULL,
  monthly_requirement_qty numeric(20,6) NOT NULL DEFAULT 0,
  safety_days numeric(12,3) NOT NULL DEFAULT 0,
  processing_time_days numeric(12,3) NOT NULL DEFAULT 0,
  lead_time_days numeric(12,3) NOT NULL DEFAULT 0,
  fixed_safety_stock_qty numeric(20,6) NULL,
  fixed_replenishment_stock_qty numeric(20,6) NULL,
  UNIQUE (archive_id, planning_item_group_name_snapshot)
);

CREATE INDEX IF NOT EXISTS idx_po11_plan_group_config_plan
  ON erp_procurement.procurement_monthly_plan_group_config(plan_id, planning_item_group_id);

CREATE INDEX IF NOT EXISTS idx_po11_archive_group_config_archive
  ON erp_procurement.procurement_monthly_plan_archive_group_config(archive_id, planning_item_group_name_snapshot);

GRANT SELECT ON erp_procurement.procurement_monthly_plan_group_config TO authenticated;
GRANT SELECT ON erp_procurement.procurement_monthly_plan_archive_group_config TO authenticated;

GRANT ALL ON erp_procurement.procurement_monthly_plan_group_config TO service_role;
GRANT ALL ON erp_procurement.procurement_monthly_plan_archive_group_config TO service_role;

COMMIT;
