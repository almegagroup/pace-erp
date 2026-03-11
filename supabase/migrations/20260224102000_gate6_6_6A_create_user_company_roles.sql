  /*
  * File-ID: ID-6.6A
  * File-Path: supabase/migrations/20260224102000_gate6_6_6A_create_user_company_roles.sql
  * Gate: 6
  * Phase: 6
  * Domain: MAP
  * Purpose: Resolve ERP user → company context deterministically.
  * Authority: Backend
  */

  BEGIN;

  CREATE SCHEMA IF NOT EXISTS erp_map;

  CREATE TABLE IF NOT EXISTS erp_map.user_company_roles (
    auth_user_id uuid NOT NULL,
    company_id   uuid NOT NULL,

    role_code    text NOT NULL,

    assigned_at  timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (auth_user_id, company_id)
  );

  COMMENT ON TABLE erp_map.user_company_roles IS
  'Context resolution table for Gate-5. Maps ERP user to allowed company scope.';

  ALTER TABLE erp_map.user_company_roles ENABLE ROW LEVEL SECURITY;

  COMMIT;
