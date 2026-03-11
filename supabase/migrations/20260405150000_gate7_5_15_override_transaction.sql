/*
 * File-ID: 7.5.15
 * File-Path: supabase/migrations/20260405150000_gate7_5_15_override_transaction.sql
 * Gate: 7.5
 * Phase: Engine
 * Domain: Workflow
 * Purpose: Atomic transaction boundary for workflow decision processing
 * Authority: Backend
 */

CREATE OR REPLACE FUNCTION acl.process_workflow_decision_atomic(
    p_request_id UUID,
    p_actor UUID,
    p_stage_number INTEGER,
    p_decision TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_workflow RECORD;
BEGIN

    -- Lock workflow row
    SELECT *
    INTO v_workflow
    FROM acl.workflow_requests
    WHERE request_id = p_request_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'REQUEST_NOT_FOUND';
    END IF;

    IF v_workflow.current_state <> 'PENDING' THEN
        RAISE EXCEPTION 'INVALID_STATE';
    END IF;

    -- Insert decision
    INSERT INTO acl.workflow_decisions (
        request_id,
        stage_number,
        approver_auth_user_id,
        decision
    )
    VALUES (
        p_request_id,
        p_stage_number,
        p_actor,
        p_decision
    );

    -- Append audit log
    INSERT INTO erp_audit.workflow_events (
        request_id,
        company_id,
        module_code,
        event_type,
        stage_number,
        decision,
        previous_state,
        new_state,
        actor_auth_user_id
    )
    VALUES (
        v_workflow.request_id,
        v_workflow.company_id,
        v_workflow.module_code,
        'DECISION',
        p_stage_number,
        p_decision,
        v_workflow.current_state,
        v_workflow.current_state,
        p_actor
    );

END;
$$;