-- ============================================================
-- File-ID: ID-6.2
-- File-Path: supabase/migrations/20260126130000_gate6_6_2_create_company_master.sql
-- Gate: 6
-- Phase: 6
-- Domain: MASTER
-- Short_Name: Company master
-- Purpose: Canonical company master registry (foundation for Parent/Work company)
-- Authority: Backend
-- ============================================================

BEGIN;

create schema if not exists erp_master;

create table if not exists erp_master.companies (
  id uuid primary key default gen_random_uuid(),

  -- NOTE: company_code auto-generation will be added in next G2 steps.
  company_code text not null unique,
  company_name text not null,

  -- GST will be used for ApplyFlow fetch + caching later.
  gst_number text unique,

  -- State rules (ACTIVE/INACTIVE check + delete rules) will be added in ID-6.2A step.
  status text not null default 'ACTIVE',

  created_at timestamptz not null default now(),
  created_by uuid null
);

comment on table erp_master.companies is
'Canonical company master. Source of truth for company-scoped logic (Context + ACL).';

COMMIT;
