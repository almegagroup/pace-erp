-- ============================================================
-- File-ID: ID-6.7
-- File-Path: supabase/migrations/20260211105000_gate6_6_7_create_user_project_map.sql
-- Gate: 6
-- Phase: 6
-- Domain: MAP
-- Purpose: Bind users to allowed projects
-- Authority: Backend
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS erp_map.user_projects (
  auth_user_id uuid NOT NULL
    REFERENCES erp_core.users(auth_user_id)
    ON DELETE CASCADE,

  project_id uuid NOT NULL
    REFERENCES erp_master.projects(id)
    ON DELETE RESTRICT,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pk_user_projects
    PRIMARY KEY (auth_user_id, project_id)
);

COMMENT ON TABLE erp_map.user_projects IS
'Defines project-level operational scope per user.';

COMMIT;
