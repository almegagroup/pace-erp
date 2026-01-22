/*
 * File-ID: 0.6D
 * File-Path: supabase/migrations/20260122104000_gate0_0_6D_service_role_bypass.sql
 * Gate: 0
 * Phase: 0
 * Domain: DB
 * Purpose: Allow controlled DB access to backend service role
 * Authority: Backend
 */

BEGIN;

-- Allow backend service role to use ERP schemas
GRANT USAGE ON SCHEMA erp_core TO service_role;
GRANT USAGE ON SCHEMA erp_acl TO service_role;
GRANT USAGE ON SCHEMA erp_audit TO service_role;
GRANT USAGE ON SCHEMA erp_meta TO service_role;

-- Future tables: service role will have access automatically
ALTER DEFAULT PRIVILEGES IN SCHEMA erp_core
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA erp_acl
  GRANT SELECT, INSERT, UPDATE, UPDATE ON TABLES TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA erp_audit
  GRANT INSERT ON TABLES TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA erp_meta
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role;

COMMIT;
