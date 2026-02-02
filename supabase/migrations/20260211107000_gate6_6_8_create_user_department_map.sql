-- ============================================================
-- File-ID: ID-6.8
-- File-Path: supabase/migrations/20260211107000_gate6_6_8_create_user_department_map.sql
-- Gate: 6
-- Phase: 6
-- Domain: MAP
-- Purpose: Bind user to HR department
-- Authority: Backend
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS erp_map.user_departments (
  auth_user_id uuid NOT NULL
    REFERENCES erp_core.users(auth_user_id)
    ON DELETE CASCADE,

  department_id uuid NOT NULL
    REFERENCES erp_master.departments(id)
    ON DELETE RESTRICT,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pk_user_departments
    PRIMARY KEY (auth_user_id, department_id)
);

COMMENT ON TABLE erp_map.user_departments IS
'HR binding between user and department.';

COMMIT;
