/*
 * File-ID: 8.1.1B
 * File-Path: supabase/migrations/20260410143000_gate8_1_1B_grant_service_role_current_erp_hr.sql
 * Gate: 8
 * Phase: 8
 * Domain: HR
 * Purpose: Re-grant service_role access on current erp_hr schema objects after HR tables were created.
 * Authority: Backend
 */

BEGIN;

GRANT USAGE ON SCHEMA erp_hr TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE
ON ALL TABLES IN SCHEMA erp_hr
TO service_role;

GRANT USAGE, SELECT
ON ALL SEQUENCES IN SCHEMA erp_hr
TO service_role;

COMMIT;
