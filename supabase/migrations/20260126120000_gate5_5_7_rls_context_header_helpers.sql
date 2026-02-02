-- File-ID: 5.7
-- File-Path: supabase/migrations/20260126120000_gate5_5_7_rls_context_header_helpers.sql
-- Gate: 5
-- Phase: 5
-- Domain: DB
-- Purpose: RLS context alignment helpers (read context from request headers deterministically)
-- Authority: Backend

-- Ensure schema exists (created in Gate-0)
create schema if not exists erp_meta;

-- Read a specific request header from PostgREST-provided GUC.
-- PostgREST sets: current_setting('request.headers', true) as JSON.
create or replace function erp_meta.req_header(p_key text)
returns text
language sql
stable
as $$
  select
    (nullif(current_setting('request.headers', true), ''))::json ->> lower(p_key);
$$;

-- Typed helpers (UUID) with safe NULL behavior
create or replace function erp_meta.req_company_id()
returns uuid
language sql
stable
as $$
  select nullif(erp_meta.req_header('x-erp-company-id'), '')::uuid;
$$;

create or replace function erp_meta.req_project_id()
returns uuid
language sql
stable
as $$
  select nullif(erp_meta.req_header('x-erp-project-id'), '')::uuid;
$$;

create or replace function erp_meta.req_department_id()
returns uuid
language sql
stable
as $$
  select nullif(erp_meta.req_header('x-erp-department-id'), '')::uuid;
$$;

create or replace function erp_meta.req_is_admin()
returns boolean
language sql
stable
as $$
  select coalesce(nullif(erp_meta.req_header('x-erp-is-admin'), ''), 'false')::boolean;
$$;
