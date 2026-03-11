/*
 * File-ID: 7.5.1
 * File-Path: supabase/migrations/20260405101000_gate7_5_1_create_module_registry.sql
 * Gate: 7.5
 * Phase: 7.5
 * Domain: ACL
 * Purpose: Global module registry with intrinsic approval policy (Module-Level Authority Layer)
 * Authority: Backend
 */

BEGIN;

-- ============================================================
-- MODULE REGISTRY (GLOBAL AUTHORITY LAYER)
-- ------------------------------------------------------------
-- Purpose:
--   - Declare module identity globally
--   - Bind module to project (erp_master.projects)
--   - Declare intrinsic approval policy (GLOBAL, NOT per company)
--   - Enforce min/max approver structural constraints
--
-- Constitutional Compliance:
--   - Backend = Single Source of Truth
--   - Approval policy intrinsic to module
--   - No company-level override allowed
--   - Structural only (no execution logic)
-- ============================================================

CREATE TABLE IF NOT EXISTS acl.module_registry (
    module_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Global identity
    module_code TEXT NOT NULL UNIQUE,
    module_name TEXT NOT NULL,

    -- Project binding (existing project master)
    project_id UUID NOT NULL
        REFERENCES erp_master.projects(id)
        ON DELETE RESTRICT,

    -- Intrinsic approval policy (GLOBAL LAW)
    approval_required BOOLEAN NOT NULL DEFAULT FALSE,

    approval_type TEXT CHECK (
        approval_type IN ('ANYONE', 'SEQUENTIAL', 'MUST_ALL')
    ),

    -- Structural approver bounds (Execution enforced later)
    min_approvers SMALLINT NOT NULL DEFAULT 2
        CHECK (min_approvers BETWEEN 2 AND 3),

    max_approvers SMALLINT NOT NULL DEFAULT 3
        CHECK (max_approvers BETWEEN 2 AND 3),

    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID,

    -- Policy integrity rule
    CONSTRAINT chk_approval_type_when_required
        CHECK (
            (approval_required = FALSE AND approval_type IS NULL)
            OR
            (approval_required = TRUE AND approval_type IS NOT NULL)
        ),

    CONSTRAINT chk_min_max_consistency
        CHECK (min_approvers <= max_approvers)
);

-- ============================================================
-- RLS ENABLE + FORCE (Default DENY Philosophy)
-- ============================================================

ALTER TABLE acl.module_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE acl.module_registry FORCE ROW LEVEL SECURITY;

-- ============================================================
-- READ POLICY (Authenticated users may read registry)
-- Write operations remain backend-controlled
-- ============================================================

CREATE POLICY module_registry_read_authenticated
ON acl.module_registry
FOR SELECT
TO authenticated
USING (TRUE);

COMMENT ON TABLE acl.module_registry IS
'Global module registry declaring intrinsic approval policy and project binding. Company may enable/disable module but cannot override policy. Structural layer only (Gate-7.5 Phase-A).';

COMMIT;