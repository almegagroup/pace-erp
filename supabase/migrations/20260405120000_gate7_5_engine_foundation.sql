/*
 * File-ID: 7.5.11-7.5.12-7.5.18-7.5.20
 * File-Path: supabase/migrations/20260405120000_gate7_5_engine_foundation.sql
 * Gate: 7.5
 * Phase: Engine
 * Domain: Workflow
 * Purpose: Create workflow_requests & workflow_decisions with RLS & performance discipline
 * Authority: Backend
 */

BEGIN;

-- ============================================================
-- WORKFLOW REQUEST TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS acl.workflow_requests (
    request_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    company_id UUID NOT NULL
        REFERENCES erp_master.companies(id)
        ON DELETE CASCADE,

    project_id UUID NOT NULL
        REFERENCES erp_master.projects(id)
        ON DELETE RESTRICT,

    module_code TEXT NOT NULL
        REFERENCES acl.module_registry(module_code)
        ON DELETE RESTRICT,

    requester_auth_user_id UUID NOT NULL
        REFERENCES auth.users(id)
        ON DELETE CASCADE,

    acl_version_id UUID NOT NULL
        REFERENCES acl.acl_versions(acl_version_id)
        ON DELETE RESTRICT,

    approval_type TEXT NOT NULL
        CHECK (approval_type IN ('ANYONE','SEQUENTIAL','MUST_ALL')),

    current_state TEXT NOT NULL
        CHECK (current_state IN ('DRAFT','PENDING','APPROVED','REJECTED','CANCELLED')),

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID NOT NULL
        REFERENCES auth.users(id)
        ON DELETE RESTRICT
);

-- ============================================================
-- WORKFLOW DECISION TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS acl.workflow_decisions (
    decision_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    request_id UUID NOT NULL
        REFERENCES acl.workflow_requests(request_id)
        ON DELETE CASCADE,

    stage_number INTEGER NOT NULL CHECK (stage_number >= 1),

    approver_auth_user_id UUID NOT NULL
        REFERENCES auth.users(id)
        ON DELETE CASCADE,

    decision TEXT NOT NULL
        CHECK (decision IN ('APPROVED','REJECTED')),

    overridden_by UUID
        REFERENCES auth.users(id)
        ON DELETE SET NULL,

    decided_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- RLS ENABLE + FORCE
-- ============================================================

ALTER TABLE acl.workflow_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE acl.workflow_requests FORCE ROW LEVEL SECURITY;

ALTER TABLE acl.workflow_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE acl.workflow_decisions FORCE ROW LEVEL SECURITY;

-- ============================================================
-- BASIC READ POLICY (ACL enforced later via stepAcl)
-- ============================================================

CREATE POLICY workflow_requests_read_authenticated
ON acl.workflow_requests
FOR SELECT
TO authenticated
USING (TRUE);

CREATE POLICY workflow_decisions_read_authenticated
ON acl.workflow_decisions
FOR SELECT
TO authenticated
USING (TRUE);

-- ============================================================
-- PERFORMANCE INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_workflow_requests_company
ON acl.workflow_requests(company_id);

CREATE INDEX IF NOT EXISTS idx_workflow_requests_requester
ON acl.workflow_requests(requester_auth_user_id);

CREATE INDEX IF NOT EXISTS idx_workflow_decisions_request
ON acl.workflow_decisions(request_id);

CREATE INDEX IF NOT EXISTS idx_workflow_decisions_stage
ON acl.workflow_decisions(stage_number);

COMMIT;