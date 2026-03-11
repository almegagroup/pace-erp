-- ============================================================
-- File-ID: ID-6.8B
-- File-Path: supabase/migrations/20260402102000_gate6_6_8B_user_single_department_rule.sql
-- Gate: 6
-- Phase: 6
-- Domain: MAP
-- Purpose: Enforce One User → One Department (SAP-Style HR Identity)
-- Authority: Database
-- Idempotent: YES
-- ============================================================

BEGIN;

------------------------------------------------------------
-- 1️⃣ Drop Existing Unique Index (safe re-run)
------------------------------------------------------------

DROP INDEX IF EXISTS erp_map.uq_user_single_department;

------------------------------------------------------------
-- 2️⃣ Enforce Strict Single Department Rule
------------------------------------------------------------

CREATE UNIQUE INDEX uq_user_single_department
ON erp_map.user_departments (auth_user_id);

COMMENT ON INDEX erp_map.uq_user_single_department IS
'Ensures one user can belong to only one department (SAP-style deterministic HR identity).';

COMMIT;