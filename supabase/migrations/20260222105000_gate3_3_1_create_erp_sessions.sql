/*
 * File-ID: ID-3.1
 * File-Path: supabase/migrations/20260224100000_gate3_3_1_create_erp_sessions.sql
 * Gate: 3
 * Phase: 3
 * Domain: SESSION
 * Purpose: Canonical ERP session store (authoritative session lifecycle)
 * Authority: Backend
 */

BEGIN;

CREATE SCHEMA IF NOT EXISTS erp_core;

CREATE TABLE IF NOT EXISTS erp_core.sessions (
  session_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  auth_user_id   uuid NOT NULL,
  status         text NOT NULL
    CHECK (status IN ('CREATED', 'ACTIVE', 'IDLE', 'EXPIRED', 'REVOKED', 'DEAD')),

  created_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now(),

  expires_at     timestamptz NOT NULL,
  revoked_at     timestamptz NULL,

  revoked_reason text NULL
);

COMMENT ON TABLE erp_core.sessions IS
'Authoritative ERP session lifecycle table. Supabase Auth is identity only; ERP sessions control access.';

ALTER TABLE erp_core.sessions ENABLE ROW LEVEL SECURITY;

COMMIT;
