-- ============================================================
-- File-ID: ID-6.5
-- File-Path: supabase/migrations/20260211101000_gate6_6_5_create_company_project_map.sql
-- Gate: 6
-- Phase: 6
-- Domain: MAP
-- Purpose: Bind projects to companies (operational scope)
-- Authority: Backend
-- ============================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS erp_map;

CREATE TABLE IF NOT EXISTS erp_map.company_projects (
  company_id uuid NOT NULL
    REFERENCES erp_master.companies(id)
    ON DELETE RESTRICT,

  project_id uuid NOT NULL
    REFERENCES erp_master.projects(id)
    ON DELETE RESTRICT,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pk_company_projects
    PRIMARY KEY (company_id, project_id)
);

COMMENT ON TABLE erp_map.company_projects IS
'Authoritative binding between companies and projects. Enables shared projects without data leakage.';

COMMIT;
