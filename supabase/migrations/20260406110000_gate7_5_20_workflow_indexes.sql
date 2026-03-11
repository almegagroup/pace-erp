/*
 * File-ID: 7.5.20
 * File-Path: supabase/migrations/20260406110000_gate7_5_20_workflow_performance_indexes.sql
 * Gate: 7.5
 * Phase: Engine
 * Domain: Workflow
 * Purpose: Add deterministic performance indexes for workflow engine
 * Authority: Backend
 */

BEGIN;

-- ============================================================
-- 1️⃣ workflow_requests primary lookup
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_workflow_requests_request_id
ON acl.workflow_requests (request_id);


-- ============================================================
-- 2️⃣ workflow_decisions request lookup
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_workflow_decisions_request_id
ON acl.workflow_decisions (request_id);


-- ============================================================
-- 3️⃣ Duplicate decision prevention efficiency
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_workflow_decisions_unique_stage
ON acl.workflow_decisions (
    request_id,
    stage_number,
    approver_auth_user_id
);


-- ============================================================
-- 4️⃣ Stage ordering & override efficiency
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_workflow_decisions_stage
ON acl.workflow_decisions (
    request_id,
    stage_number
);

COMMIT;