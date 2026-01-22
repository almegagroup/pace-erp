/*
 * File-ID: 0.6C
 * File-Path: supabase/migrations/20260122103000_gate0_0_6C_default_deny_policies.sql
 * Gate: 0
 * Phase: 0
 * Domain: DB
 * Purpose: Enforce default-deny RLS posture for ERP schemas
 * Authority: Backend
 */

BEGIN;

-- Ensure RLS is enabled by default on future tables
ALTER SCHEMA erp_core OWNER TO postgres;
ALTER SCHEMA erp_acl OWNER TO postgres;
ALTER SCHEMA erp_audit OWNER TO postgres;
ALTER SCHEMA erp_meta OWNER TO postgres;

-- Revoke all default privileges from public roles
REVOKE ALL ON SCHEMA erp_core FROM PUBLIC;
REVOKE ALL ON SCHEMA erp_acl FROM PUBLIC;
REVOKE ALL ON SCHEMA erp_audit FROM PUBLIC;
REVOKE ALL ON SCHEMA erp_meta FROM PUBLIC;

-- Explicitly revoke usage from anon and authenticated roles
REVOKE USAGE ON SCHEMA erp_core FROM anon, authenticated;
REVOKE USAGE ON SCHEMA erp_acl FROM anon, authenticated;
REVOKE USAGE ON SCHEMA erp_audit FROM anon, authenticated;
REVOKE USAGE ON SCHEMA erp_meta FROM anon, authenticated;

COMMIT;
