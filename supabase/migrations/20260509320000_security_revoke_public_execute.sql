/*
 * File-ID: SEC-2
 * File-Path: supabase/migrations/20260509320000_security_revoke_public_execute.sql
 * Gate: SECURITY
 * Phase: POST-L1
 * Domain: SECURITY
 * Purpose: Revoke EXECUTE from PUBLIC on PACE code generator functions.
 *          Prior migration only revoked from anon/authenticated directly,
 *          but those roles inherit from PUBLIC — so the warning persisted.
 *          Revoking from PUBLIC removes the inherited permission entirely.
 *          service_role is a superuser and is unaffected by this revoke.
 * Authority: Backend
 */

BEGIN;

-- ============================================================
-- Revoke EXECUTE from PUBLIC
-- This removes the default PostgreSQL grant that anon and
-- authenticated inherit. service_role (superuser) is unaffected.
-- ============================================================

REVOKE EXECUTE ON FUNCTION erp_master.generate_material_pace_code(text)
  FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION erp_master.generate_vendor_code()
  FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION erp_master.generate_customer_code()
  FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION erp_inventory.generate_doc_number(uuid, uuid, text)
  FROM PUBLIC;

COMMIT;
