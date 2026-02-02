-- ============================================================
-- File-ID: ID-6.4
-- File-Path: supabase/migrations/20260126138000_gate6_6_4_create_department_master.sql
-- Gate: 6
-- Phase: 6
-- Domain: MASTER
-- Short_Name: Department master
-- Purpose: Canonical department registry scoped to company
-- Authority: Backend
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS erp_master.departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  department_code text NOT NULL UNIQUE,
  department_name text NOT NULL,

  company_id uuid NOT NULL
    REFERENCES erp_master.companies(id)
    ON DELETE RESTRICT,

  status text NOT NULL DEFAULT 'ACTIVE',

  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL
);

COMMENT ON TABLE erp_master.departments IS
'Canonical department master. HR scope. Company-bound.';

COMMIT;
