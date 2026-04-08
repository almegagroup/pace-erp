/*
 * File-ID: 8.1.1A
 * File-Path: supabase/migrations/20260403042000_gate8_1_1A_grant_service_role_erp_hr.sql
 * Gate: 8
 * Phase: 8
 * Domain: HR
 * Purpose: Grant explicit backend service_role access to erp_hr after HR schema creation.
 * Authority: Backend
 */

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.schemata
    WHERE schema_name = 'erp_hr'
  ) THEN
    GRANT USAGE ON SCHEMA erp_hr TO service_role;

    GRANT SELECT, INSERT, UPDATE, DELETE
    ON ALL TABLES IN SCHEMA erp_hr
    TO service_role;

    GRANT USAGE, SELECT
    ON ALL SEQUENCES IN SCHEMA erp_hr
    TO service_role;

    ALTER DEFAULT PRIVILEGES IN SCHEMA erp_hr
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role;

    ALTER DEFAULT PRIVILEGES IN SCHEMA erp_hr
      GRANT USAGE, SELECT ON SEQUENCES TO service_role;
  END IF;
END
$$;

COMMIT;
