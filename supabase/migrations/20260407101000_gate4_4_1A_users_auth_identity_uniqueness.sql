/*
 * File-ID: 4.1A
 * File-Path: supabase/migrations/20260407101000_gate4_4_1A_users_auth_identity_uniqueness.sql
 * Gate: 4
 * Phase: 4
 * Domain: DB
 * Purpose: Enforce single ERP lifecycle record per Supabase identity
 * Authority: Backend
 */

BEGIN;

-- =========================================================
-- ERP USER AUTH IDENTITY UNIQUENESS
-- =========================================================
-- Ensures that a single Supabase Auth identity
-- can map to only one ERP lifecycle record.
--
-- Prevents race-condition duplicate signup requests.

ALTER TABLE erp_core.users
ADD CONSTRAINT users_auth_user_id_unique
UNIQUE (auth_user_id);

-- =========================================================
-- NOTE
-- =========================================================
-- Although auth_user_id already has a UNIQUE constraint
-- in the base schema, this migration explicitly formalizes
-- the invariant as part of Gate-4 lifecycle enforcement.
--
-- This ensures deterministic schema evolution across
-- environments and protects against accidental drift.

COMMIT;