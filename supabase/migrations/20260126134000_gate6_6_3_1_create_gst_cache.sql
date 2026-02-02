-- ============================================================
-- File-ID: ID-6.3.1
-- File-Path: supabase/migrations/20260126134000_gate6_6_3_1_create_gst_cache.sql
-- Gate: 6
-- Phase: 6
-- Domain: CACHE
-- Short_Name: GST profile cache
-- Purpose: Cache external GST profiles to avoid repeated Applyflow API calls
-- Authority: Backend
-- ============================================================

BEGIN;

-- 1) Schema (idempotent)
CREATE SCHEMA IF NOT EXISTS erp_cache;

COMMENT ON SCHEMA erp_cache IS
'Cache layer for external facts (rebuildable, non-authoritative).';

-- 2) Cache table
CREATE TABLE IF NOT EXISTS erp_cache.gst_profiles (
  gst_number   text PRIMARY KEY,
  legal_name   text NOT NULL,
  trade_name   text NULL,
  status       text NOT NULL DEFAULT 'UNKNOWN',
  address      jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_payload  jsonb NOT NULL,
  source       text NOT NULL DEFAULT 'APPLYFLOW',
  fetched_at   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE erp_cache.gst_profiles IS
'Cached GST profiles fetched from Applyflow. External fact store; not ERP truth.';

-- 3) GST normalization invariant
ALTER TABLE erp_cache.gst_profiles
  ADD CONSTRAINT gst_profiles_gst_format_check
  CHECK (gst_number = upper(trim(gst_number)));

-- 4) Status allowlist (soft, extendable)
ALTER TABLE erp_cache.gst_profiles
  ADD CONSTRAINT gst_profiles_status_check
  CHECK (status IN ('ACTIVE', 'CANCELLED', 'UNKNOWN'));

-- 5) Fast lookup by GST
CREATE INDEX IF NOT EXISTS idx_gst_profiles_gst
  ON erp_cache.gst_profiles (gst_number);

COMMIT;
