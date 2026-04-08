/*
 * File-ID: 8.1.1
 * File-Path: supabase/migrations/20260403041000_gate8_1_1_precreate_erp_hr_schema.sql
 * Gate: 8
 * Phase: 8
 * Domain: HR
 * Purpose: Pre-create erp_hr schema before historical service_role grant migration runs.
 * Authority: Backend
 */

BEGIN;

CREATE SCHEMA IF NOT EXISTS erp_hr;

COMMIT;
