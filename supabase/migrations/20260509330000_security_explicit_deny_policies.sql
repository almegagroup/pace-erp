/*
 * File-ID: SEC-3
 * File-Path: supabase/migrations/20260509330000_security_explicit_deny_policies.sql
 * Gate: SECURITY
 * Phase: POST-L1
 * Domain: SECURITY
 * Purpose: Add explicit DENY ALL policies on all RLS-enabled tables.
 *          This silences the rls_enabled_no_policy INFO linter warning
 *          and documents the intent: these tables are backend-only.
 *          service_role bypasses RLS entirely and is unaffected.
 *          anon and authenticated have zero access by design.
 * Authority: Backend
 */

BEGIN;

-- ============================================================
-- erp_master tables — deny all for anon + authenticated
-- ============================================================

CREATE POLICY "backend_only" ON erp_master.uom_master
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false);

CREATE POLICY "backend_only" ON erp_master.material_master
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false);

CREATE POLICY "backend_only" ON erp_master.material_uom_conversion
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false);

CREATE POLICY "backend_only" ON erp_master.material_company_ext
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false);

CREATE POLICY "backend_only" ON erp_master.material_plant_ext
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false);

CREATE POLICY "backend_only" ON erp_master.material_category_group
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false);

CREATE POLICY "backend_only" ON erp_master.material_category_group_member
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false);

CREATE POLICY "backend_only" ON erp_master.vendor_master
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false);

CREATE POLICY "backend_only" ON erp_master.vendor_company_map
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false);

CREATE POLICY "backend_only" ON erp_master.vendor_payment_terms_log
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false);

CREATE POLICY "backend_only" ON erp_master.vendor_material_info
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false);

CREATE POLICY "backend_only" ON erp_master.customer_master
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false);

CREATE POLICY "backend_only" ON erp_master.customer_company_map
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false);

CREATE POLICY "backend_only" ON erp_master.material_code_sequence
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false);

CREATE POLICY "backend_only" ON erp_master.vendor_code_sequence
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false);

CREATE POLICY "backend_only" ON erp_master.customer_code_sequence
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false);

CREATE POLICY "backend_only" ON erp_master.cost_center_master
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false);

CREATE POLICY "backend_only" ON erp_master.machine_master
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false);

-- ============================================================
-- erp_inventory tables — deny all for anon + authenticated
-- ============================================================

CREATE POLICY "backend_only" ON erp_inventory.movement_type_master
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false);

CREATE POLICY "backend_only" ON erp_inventory.stock_type_master
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false);

CREATE POLICY "backend_only" ON erp_inventory.storage_location_master
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false);

CREATE POLICY "backend_only" ON erp_inventory.storage_location_plant_map
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false);

CREATE POLICY "backend_only" ON erp_inventory.location_transfer_rule
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false);

CREATE POLICY "backend_only" ON erp_inventory.number_series_master
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false);

CREATE POLICY "backend_only" ON erp_inventory.number_series_counter
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false);

CREATE POLICY "backend_only" ON erp_inventory.stock_document
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false);

CREATE POLICY "backend_only" ON erp_inventory.stock_ledger
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false);

CREATE POLICY "backend_only" ON erp_inventory.stock_snapshot
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false);

COMMIT;
