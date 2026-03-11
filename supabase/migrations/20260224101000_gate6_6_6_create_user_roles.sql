/*
 * File-ID: ID-6.6
 * File-Path: supabase/migrations/20260224101000_gate6_6_6_create_user_roles.sql
 * Gate: 6
 * Phase: 6
 * Domain: ACL
 * Purpose: Assign exactly one canonical role per ERP user.
 * Authority: Backend
 */

BEGIN;

CREATE SCHEMA IF NOT EXISTS erp_acl;

CREATE TABLE IF NOT EXISTS erp_acl.user_roles (
  auth_user_id uuid PRIMARY KEY,

  role_code    text NOT NULL,
  role_rank    integer NOT NULL,

  assigned_by  uuid NOT NULL,
  assigned_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE erp_acl.user_roles IS
'Single-role authority per ERP user. Used by admin role assignment and self-lockout protection.';

ALTER TABLE erp_acl.user_roles ENABLE ROW LEVEL SECURITY;

COMMIT;
