/*
 * File-ID: 0.6B
 * File-Path: supabase/migrations/20260122102000_gate0_0_6B_enable_rls_globally.sql
 * Gate: 0
 * Phase: 0
 * Domain: DB
 * Purpose: Enable RLS expectation at database level
 * Authority: Backend
 */

BEGIN;

-- Ensure row level security is enforced where policies exist
ALTER DATABASE postgres SET row_security = ON;

COMMIT;
