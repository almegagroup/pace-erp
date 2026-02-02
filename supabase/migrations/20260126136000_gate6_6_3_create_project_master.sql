-- ============================================================
-- File-ID: ID-6.3
-- File-Path: supabase/migrations/20260126136000_gate6_6_3_create_project_master.sql
-- Gate: 6
-- Phase: 6
-- Domain: MASTER
-- Short_Name: Project master
-- Purpose: Canonical project registry scoped to company
-- Authority: Backend
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS erp_master.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  project_code text NOT NULL UNIQUE,
  project_name text NOT NULL,

  company_id uuid NOT NULL
    REFERENCES erp_master.companies(id)
    ON DELETE RESTRICT,

  status text NOT NULL DEFAULT 'ACTIVE',

  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL
);

COMMENT ON TABLE erp_master.projects IS
'Canonical project master. Scoped strictly to a single company.';

COMMIT;
