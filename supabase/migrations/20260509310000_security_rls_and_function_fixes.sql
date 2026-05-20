/*
 * File-ID: SEC-1
 * File-Path: supabase/migrations/20260509310000_security_rls_and_function_fixes.sql
 * Gate: SECURITY
 * Phase: POST-L1
 * Domain: SECURITY
 * Purpose: Enable RLS on all erp_master tables. Fix function search_path.
 *          Revoke anon/authenticated execute on PACE code generator functions.
 * Authority: Backend
 */

BEGIN;

-- ============================================================
-- PART 1: Enable RLS on all erp_master tables
-- service_role bypasses RLS — backend continues to work.
-- anon and authenticated are blocked from direct PostgREST access.
-- ============================================================

ALTER TABLE erp_master.uom_master                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_master.material_master              ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_master.material_uom_conversion      ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_master.material_company_ext         ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_master.material_plant_ext           ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_master.material_category_group      ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_master.material_category_group_member ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_master.vendor_master                ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_master.vendor_company_map           ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_master.vendor_payment_terms_log     ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_master.vendor_material_info         ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_master.customer_master              ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_master.customer_company_map         ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_master.material_code_sequence       ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_master.vendor_code_sequence         ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_master.customer_code_sequence       ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_master.cost_center_master           ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_master.machine_master               ENABLE ROW LEVEL SECURITY;

-- Also lock down erp_inventory tables (defence in depth)
ALTER TABLE erp_inventory.movement_type_master      ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_inventory.stock_type_master         ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_inventory.storage_location_master   ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_inventory.storage_location_plant_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_inventory.location_transfer_rule    ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_inventory.number_series_master      ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_inventory.number_series_counter     ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_inventory.stock_document            ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_inventory.stock_ledger              ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_inventory.stock_snapshot            ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- PART 2: Fix search_path on all SECURITY DEFINER functions
-- Prevents search_path injection attacks.
-- All function bodies already use fully-qualified schema.table references.
-- ============================================================

ALTER FUNCTION erp_master.generate_material_pace_code(p_material_type text)
  SET search_path = '';

ALTER FUNCTION erp_master.generate_vendor_code()
  SET search_path = '';

ALTER FUNCTION erp_master.generate_customer_code()
  SET search_path = '';

ALTER FUNCTION erp_inventory.generate_doc_number(uuid, uuid, text)
  SET search_path = '';

-- ============================================================
-- PART 3: Revoke EXECUTE from anon and authenticated roles
-- These functions should only be callable by service_role (backend).
-- Prevents code sequence manipulation via direct PostgREST RPC calls.
-- ============================================================

REVOKE EXECUTE ON FUNCTION erp_master.generate_material_pace_code(text)
  FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION erp_master.generate_vendor_code()
  FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION erp_master.generate_customer_code()
  FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION erp_inventory.generate_doc_number(uuid, uuid, text)
  FROM anon, authenticated;

COMMIT;
