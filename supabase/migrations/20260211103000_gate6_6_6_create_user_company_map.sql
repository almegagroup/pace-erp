-- ============================================================
-- File-ID: ID-6.6
-- File-Path: supabase/migrations/20260211103000_gate6_6_6_create_user_company_map.sql
-- Gate: 6
-- Phase: 6
-- Domain: MAP
-- Purpose: Bind ERP users to allowed companies
-- Authority: Backend
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS erp_map.user_companies (
  auth_user_id uuid NOT NULL
    REFERENCES erp_core.users(auth_user_id)
    ON DELETE CASCADE,

  company_id uuid NOT NULL
    REFERENCES erp_master.companies(id)
    ON DELETE RESTRICT,

  is_primary boolean NOT NULL DEFAULT false,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pk_user_companies
    PRIMARY KEY (auth_user_id, company_id)
);

COMMENT ON TABLE erp_map.user_companies IS
'Defines which companies a user can operate in. Assigned post-SA approval.';

COMMIT;
