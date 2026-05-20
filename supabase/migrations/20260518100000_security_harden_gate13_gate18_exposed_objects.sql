/*
 * File-ID: SEC-4
 * File-Path: supabase/migrations/20260518100000_security_harden_gate13_gate18_exposed_objects.sql
 * Gate: SECURITY
 * Phase: POST-L2
 * Domain: SECURITY
 * Purpose: Harden newly added Gate-13/Gate-16/Gate-18 exposed tables and SECURITY DEFINER functions.
 * Authority: Backend
 */

BEGIN;

-- ============================================================
-- PART 1: Enable RLS on newly added erp_master tables that are
-- exposed to PostgREST and intended to be backend-only.
-- service_role bypasses RLS; anon/authenticated get no direct
-- table access through deny-all policies below.
-- ============================================================

ALTER TABLE erp_master.payment_terms_master              ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_master.payment_terms_code_sequence       ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_master.port_master                       ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_master.port_code_sequence                ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_master.material_category_master          ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_master.material_category_assignment      ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_master.material_category_code_sequence   ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_master.port_plant_transit_master         ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_master.lead_time_master_import           ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_master.lead_time_master_domestic         ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_master.transporter_master                ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_master.transporter_code_sequence         ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_master.cha_master                        ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_master.cha_port_map                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_master.cha_code_sequence                 ENABLE ROW LEVEL SECURITY;

CREATE POLICY "backend_only" ON erp_master.payment_terms_master
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false);

CREATE POLICY "backend_only" ON erp_master.payment_terms_code_sequence
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false);

CREATE POLICY "backend_only" ON erp_master.port_master
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false);

CREATE POLICY "backend_only" ON erp_master.port_code_sequence
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false);

CREATE POLICY "backend_only" ON erp_master.material_category_master
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false);

CREATE POLICY "backend_only" ON erp_master.material_category_assignment
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false);

CREATE POLICY "backend_only" ON erp_master.material_category_code_sequence
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false);

CREATE POLICY "backend_only" ON erp_master.port_plant_transit_master
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false);

CREATE POLICY "backend_only" ON erp_master.lead_time_master_import
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false);

CREATE POLICY "backend_only" ON erp_master.lead_time_master_domestic
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false);

CREATE POLICY "backend_only" ON erp_master.transporter_master
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false);

CREATE POLICY "backend_only" ON erp_master.transporter_code_sequence
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false);

CREATE POLICY "backend_only" ON erp_master.cha_master
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false);

CREATE POLICY "backend_only" ON erp_master.cha_port_map
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false);

CREATE POLICY "backend_only" ON erp_master.cha_code_sequence
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false);

-- ============================================================
-- PART 2: Fix search_path on newly added SECURITY DEFINER
-- functions.
-- ============================================================

ALTER FUNCTION erp_master.generate_payment_terms_code()
  SET search_path = '';

ALTER FUNCTION erp_master.generate_port_code()
  SET search_path = '';

ALTER FUNCTION erp_master.generate_material_category_code()
  SET search_path = '';

ALTER FUNCTION erp_master.generate_transporter_code()
  SET search_path = '';

ALTER FUNCTION erp_master.generate_cha_code()
  SET search_path = '';

ALTER FUNCTION erp_procurement.generate_doc_number(text)
  SET search_path = '';

ALTER FUNCTION erp_procurement.generate_company_doc_number(uuid, text)
  SET search_path = '';

ALTER FUNCTION erp_inventory.post_stock_movement(
  text,
  date,
  date,
  text,
  uuid,
  uuid,
  uuid,
  uuid,
  numeric,
  text,
  numeric,
  text,
  text,
  uuid,
  uuid
)
  SET search_path = '';

-- ============================================================
-- PART 3: Revoke EXECUTE from PUBLIC/anon/authenticated for
-- backend-only SECURITY DEFINER functions. Re-grant only to
-- service_role.
-- ============================================================

REVOKE EXECUTE ON FUNCTION erp_master.generate_payment_terms_code()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION erp_master.generate_payment_terms_code()
  TO service_role;

REVOKE EXECUTE ON FUNCTION erp_master.generate_port_code()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION erp_master.generate_port_code()
  TO service_role;

REVOKE EXECUTE ON FUNCTION erp_master.generate_material_category_code()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION erp_master.generate_material_category_code()
  TO service_role;

REVOKE EXECUTE ON FUNCTION erp_master.generate_transporter_code()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION erp_master.generate_transporter_code()
  TO service_role;

REVOKE EXECUTE ON FUNCTION erp_master.generate_cha_code()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION erp_master.generate_cha_code()
  TO service_role;

REVOKE EXECUTE ON FUNCTION erp_procurement.generate_doc_number(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION erp_procurement.generate_doc_number(text)
  TO service_role;

REVOKE EXECUTE ON FUNCTION erp_procurement.generate_company_doc_number(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION erp_procurement.generate_company_doc_number(uuid, text)
  TO service_role;

REVOKE EXECUTE ON FUNCTION erp_inventory.post_stock_movement(
  text,
  date,
  date,
  text,
  uuid,
  uuid,
  uuid,
  uuid,
  numeric,
  text,
  numeric,
  text,
  text,
  uuid,
  uuid
)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION erp_inventory.post_stock_movement(
  text,
  date,
  date,
  text,
  uuid,
  uuid,
  uuid,
  uuid,
  numeric,
  text,
  numeric,
  text,
  text,
  uuid,
  uuid
)
  TO service_role;

COMMIT;
