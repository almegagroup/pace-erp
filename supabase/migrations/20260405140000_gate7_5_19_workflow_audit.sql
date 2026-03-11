/*
 * File-ID: 7.5.19
 * File-Path: supabase/migrations/20260405140000_gate7_5_19_workflow_audit.sql
 * Gate: 7.5
 * Phase: Engine
 * Domain: Workflow
 * Purpose: Immutable workflow audit trail
 * Authority: Backend
 */

BEGIN;

CREATE TABLE IF NOT EXISTS erp_audit.workflow_events (
    audit_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    request_id UUID NOT NULL,
    company_id UUID NOT NULL,
    module_code TEXT NOT NULL,

    event_type TEXT NOT NULL, -- DECISION, STATE_CHANGE, OVERRIDE

    stage_number INTEGER,
    decision TEXT, -- APPROVED / REJECTED

    previous_state TEXT,
    new_state TEXT,

    actor_auth_user_id UUID NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Append-only protection
ALTER TABLE erp_audit.workflow_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_audit.workflow_events FORCE ROW LEVEL SECURITY;

CREATE POLICY workflow_audit_read_authenticated
ON erp_audit.workflow_events
FOR SELECT
TO authenticated
USING (TRUE);

COMMIT;