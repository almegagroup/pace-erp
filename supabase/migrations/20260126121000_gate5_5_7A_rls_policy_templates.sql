-- File-ID: 5.7A
-- File-Path: supabase/migrations/20260126121000_gate5_5_7A_rls_policy_templates.sql
-- Gate: 5
-- Phase: 5
-- Domain: DB
-- Purpose: RLS policy templates for context mismatch block (row-level deny)
-- Authority: Backend

-- IMPORTANT:
-- This file intentionally contains TEMPLATE patterns.
-- You will APPLY them to real business tables when those tables exist.
-- Keeping it as a migration locks the contract and removes ambiguity.

-- ===============
-- TEMPLATE 1: Company-scoped table
-- ===============
-- Policy condition (USING):
--   erp_meta.req_is_admin() = true
--   OR (<table>.company_id = erp_meta.req_company_id())
--
-- If req_company_id() is NULL => comparison yields NULL => row denied => zero rows (safe).

-- ===============
-- TEMPLATE 2: Project-scoped table
-- ===============
-- Policy condition (USING):
--   erp_meta.req_is_admin() = true
--   OR (<table>.project_id = erp_meta.req_project_id())

-- ===============
-- TEMPLATE 3: Department-scoped table
-- ===============
-- Policy condition (USING):
--   erp_meta.req_is_admin() = true
--   OR (<table>.department_id = erp_meta.req_department_id())

-- NOTES:
-- 1) Enable + Force RLS per table:
--    alter table <schema>.<table> enable row level security;
--    alter table <schema>.<table> force row level security;
--
-- 2) Context mismatch block is automatic:
--    mismatch => policy returns false => row not visible (no error thrown).
