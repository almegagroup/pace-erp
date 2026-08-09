/*
 * File-Path: supabase/migrations/20260808120000_po11_procurement_planning_workspace.sql
 * Purpose: PO11 monthly procurement planning workspace schema for ADMIX/HPS RM-PM planning.
 * Authority: Backend
 */

BEGIN;

CREATE TABLE IF NOT EXISTS erp_procurement.planning_sloc_group (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES erp_master.companies(id),
  group_name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_updated_by uuid NULL,
  last_updated_at timestamptz NULL,
  UNIQUE (company_id, group_name)
);

CREATE TABLE IF NOT EXISTS erp_procurement.planning_sloc_group_member (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sloc_group_id uuid NOT NULL REFERENCES erp_procurement.planning_sloc_group(id) ON DELETE CASCADE,
  storage_location_id uuid NOT NULL REFERENCES erp_inventory.storage_location_master(id),
  active boolean NOT NULL DEFAULT true,
  added_by uuid NOT NULL,
  added_at timestamptz NOT NULL DEFAULT now(),
  removed_by uuid NULL,
  removed_at timestamptz NULL,
  UNIQUE (sloc_group_id, storage_location_id)
);

CREATE TABLE IF NOT EXISTS erp_procurement.planning_item_group (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES erp_master.companies(id),
  group_name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_updated_by uuid NULL,
  last_updated_at timestamptz NULL,
  UNIQUE (company_id, group_name)
);

CREATE TABLE IF NOT EXISTS erp_procurement.procurement_monthly_plan (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES erp_master.companies(id),
  plan_month date NOT NULL,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
  carry_forward_from_plan_id uuid NULL REFERENCES erp_procurement.procurement_monthly_plan(id),
  closed_at timestamptz NULL,
  closed_by uuid NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_updated_by uuid NULL,
  last_updated_at timestamptz NULL,
  UNIQUE (company_id, plan_month)
);

CREATE TABLE IF NOT EXISTS erp_procurement.procurement_monthly_plan_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES erp_procurement.procurement_monthly_plan(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES erp_master.companies(id),
  material_id uuid NOT NULL REFERENCES erp_master.material_master(id),
  source_sloc_group_id uuid NULL REFERENCES erp_procurement.planning_sloc_group(id),
  planning_item_group_id uuid NULL REFERENCES erp_procurement.planning_item_group(id),
  excluded_from_dashboard boolean NOT NULL DEFAULT false,
  monthly_requirement_qty numeric(20,6) NOT NULL DEFAULT 0 CHECK (monthly_requirement_qty >= 0),
  safety_days numeric(12,3) NOT NULL DEFAULT 0 CHECK (safety_days >= 0),
  processing_time_days numeric(12,3) NOT NULL DEFAULT 0 CHECK (processing_time_days >= 0),
  lead_time_days numeric(12,3) NOT NULL DEFAULT 0 CHECK (lead_time_days >= 0),
  fixed_safety_stock_qty numeric(20,6) NULL CHECK (fixed_safety_stock_qty >= 0),
  fixed_replenishment_stock_qty numeric(20,6) NULL CHECK (fixed_replenishment_stock_qty >= 0),
  display_order int NOT NULL DEFAULT 0,
  auto_included boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_updated_by uuid NULL,
  last_updated_at timestamptz NULL,
  UNIQUE (plan_id, material_id)
);

CREATE TABLE IF NOT EXISTS erp_procurement.procurement_monthly_plan_archive (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_plan_id uuid NOT NULL REFERENCES erp_procurement.procurement_monthly_plan(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES erp_master.companies(id),
  plan_month date NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now(),
  archived_by uuid NOT NULL,
  UNIQUE (source_plan_id)
);

CREATE TABLE IF NOT EXISTS erp_procurement.procurement_monthly_plan_archive_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id uuid NOT NULL REFERENCES erp_procurement.procurement_monthly_plan_archive(id) ON DELETE CASCADE,
  material_id uuid NOT NULL REFERENCES erp_master.material_master(id),
  material_code_snapshot text NULL,
  material_name_snapshot text NULL,
  base_uom_code_snapshot text NULL,
  source_sloc_group_name_snapshot text NULL,
  planning_item_group_name_snapshot text NULL,
  excluded_from_dashboard boolean NOT NULL DEFAULT false,
  monthly_requirement_qty numeric(20,6) NOT NULL DEFAULT 0,
  safety_days numeric(12,3) NOT NULL DEFAULT 0,
  processing_time_days numeric(12,3) NOT NULL DEFAULT 0,
  lead_time_days numeric(12,3) NOT NULL DEFAULT 0,
  fixed_safety_stock_qty numeric(20,6) NULL,
  fixed_replenishment_stock_qty numeric(20,6) NULL,
  available_stock_qty numeric(20,6) NOT NULL DEFAULT 0,
  trn_stock_qty numeric(20,6) NOT NULL DEFAULT 0,
  ge_stock_qty numeric(20,6) NOT NULL DEFAULT 0,
  qa_stock_qty numeric(20,6) NOT NULL DEFAULT 0,
  total_stock_qty numeric(20,6) NOT NULL DEFAULT 0,
  derived_safety_stock_qty numeric(20,6) NOT NULL DEFAULT 0,
  derived_replenishment_stock_qty numeric(20,6) NOT NULL DEFAULT 0,
  effective_safety_stock_qty numeric(20,6) NOT NULL DEFAULT 0,
  effective_replenishment_stock_qty numeric(20,6) NOT NULL DEFAULT 0,
  display_order int NOT NULL DEFAULT 0,
  UNIQUE (archive_id, material_id)
);

CREATE INDEX IF NOT EXISTS idx_po11_sloc_group_company
  ON erp_procurement.planning_sloc_group(company_id, group_name);

CREATE INDEX IF NOT EXISTS idx_po11_sloc_group_member_group
  ON erp_procurement.planning_sloc_group_member(sloc_group_id, active);

CREATE INDEX IF NOT EXISTS idx_po11_item_group_company
  ON erp_procurement.planning_item_group(company_id, group_name);

CREATE INDEX IF NOT EXISTS idx_po11_plan_company_month
  ON erp_procurement.procurement_monthly_plan(company_id, plan_month, status);

CREATE INDEX IF NOT EXISTS idx_po11_plan_line_plan
  ON erp_procurement.procurement_monthly_plan_line(plan_id, excluded_from_dashboard, display_order);

CREATE INDEX IF NOT EXISTS idx_po11_plan_line_material
  ON erp_procurement.procurement_monthly_plan_line(company_id, material_id);

CREATE INDEX IF NOT EXISTS idx_po11_archive_company_month
  ON erp_procurement.procurement_monthly_plan_archive(company_id, plan_month);

CREATE INDEX IF NOT EXISTS idx_po11_archive_line_archive
  ON erp_procurement.procurement_monthly_plan_archive_line(archive_id, display_order);

GRANT SELECT ON erp_procurement.planning_sloc_group TO authenticated;
GRANT SELECT ON erp_procurement.planning_sloc_group_member TO authenticated;
GRANT SELECT ON erp_procurement.planning_item_group TO authenticated;
GRANT SELECT ON erp_procurement.procurement_monthly_plan TO authenticated;
GRANT SELECT ON erp_procurement.procurement_monthly_plan_line TO authenticated;
GRANT SELECT ON erp_procurement.procurement_monthly_plan_archive TO authenticated;
GRANT SELECT ON erp_procurement.procurement_monthly_plan_archive_line TO authenticated;

GRANT ALL ON erp_procurement.planning_sloc_group TO service_role;
GRANT ALL ON erp_procurement.planning_sloc_group_member TO service_role;
GRANT ALL ON erp_procurement.planning_item_group TO service_role;
GRANT ALL ON erp_procurement.procurement_monthly_plan TO service_role;
GRANT ALL ON erp_procurement.procurement_monthly_plan_line TO service_role;
GRANT ALL ON erp_procurement.procurement_monthly_plan_archive TO service_role;
GRANT ALL ON erp_procurement.procurement_monthly_plan_archive_line TO service_role;

COMMIT;
