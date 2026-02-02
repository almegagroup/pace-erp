/*
 * File-ID: 4.1
 * File-Path: supabase/migrations/20260123101000_gate4_4_1_create_erp_users.sql
 * Gate: 4
 * Phase: 4
 * Domain: DB
 * Purpose: Create ERP user existence table (lifecycle only, no access)
 * Authority: Backend
 */

BEGIN;

-- =========================================================
-- ERP USERS (LIFECYCLE AUTHORITY ONLY)
-- =========================================================
-- This table represents ERP user existence and lifecycle state.
-- It does NOT grant access, roles, ACL, or context.
-- All access decisions occur in later Gates.

CREATE TABLE IF NOT EXISTS erp_core.users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Supabase Auth identity reference
    auth_user_id    UUID NOT NULL UNIQUE,

    -- ERP-visible user code (assigned ONLY after SA approval)
    user_code       TEXT UNIQUE,

    -- Lifecycle state (governed strictly by Gate-4 / ID-4)
    state           TEXT NOT NULL
                    CHECK (state IN ('PENDING', 'ACTIVE', 'REJECTED', 'DISABLED')),

    -- System metadata
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by      TEXT NOT NULL DEFAULT 'SYSTEM'
);

-- =========================================================
-- INDEXES (minimal, non-behavioural)
-- =========================================================
CREATE INDEX IF NOT EXISTS idx_erp_users_auth_user_id
    ON erp_core.users (auth_user_id);

CREATE INDEX IF NOT EXISTS idx_erp_users_state
    ON erp_core.users (state);

-- =========================================================
-- SECURITY POSTURE
-- =========================================================
-- Row Level Security is EXPECTED but NOT EXECUTED here.
-- Policies will be defined in later Gates.

ALTER TABLE erp_core.users ENABLE ROW LEVEL SECURITY;

-- No policies are added here by design.

COMMIT;
