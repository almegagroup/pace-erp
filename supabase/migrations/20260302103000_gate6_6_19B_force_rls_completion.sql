/*
 * File-ID: 6.19B
 * File-Path: supabase/migrations/20260302103000_gate6_6_19B_force_rls_completion.sql
 * Gate: 6
 * Phase: 6
 * Domain: DB
 * Purpose: Complete FORCE RLS enforcement across all ERP schemas
 * Authority: Backend
 */
 BEGIN;

-- ============================================================
-- COMPLETE FORCE RLS ENFORCEMENT (PHASE-A FINAL SEAL)
-- ============================================================
-- Ensures no ERP table remains without FORCE RLS.
-- Aligns with RLS Philosophy (Default DENY).
-- ============================================================

-- ACL
ALTER TABLE IF EXISTS erp_acl.user_roles
  FORCE ROW LEVEL SECURITY;

-- Audit
ALTER TABLE IF EXISTS erp_audit.signup_approvals
  FORCE ROW LEVEL SECURITY;

-- Cache (previously missing RLS)
ALTER TABLE IF EXISTS erp_cache.gst_profiles
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE IF EXISTS erp_cache.gst_profiles
  FORCE ROW LEVEL SECURITY;

COMMIT;