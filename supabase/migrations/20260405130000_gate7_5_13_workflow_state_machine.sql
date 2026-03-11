/*
 * File-ID: 7.5.13
 * File-Path: supabase/migrations/20260405130000_gate7_5_13_workflow_state_machine.sql
 * Gate: 7.5
 * Phase: 7.5
 * Domain: ENGINE
 * Purpose: Deterministic workflow state transition enforcement
 * Authority: Backend
 */

BEGIN;

-- ============================================================
-- WORKFLOW STATE MACHINE ENFORCEMENT
-- ------------------------------------------------------------
-- Enforces allowed transitions only.
-- Prevents illegal lifecycle mutation.
-- Structural guard only (no routing logic).
-- ============================================================

CREATE OR REPLACE FUNCTION acl.enforce_workflow_state_machine()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN

    -- If state is not changing, allow
    IF NEW.current_state = OLD.current_state THEN
        RETURN NEW;
    END IF;

    -- ------------------------------------------------------------
    -- Allowed transitions
    -- ------------------------------------------------------------

    -- DRAFT → PENDING or CANCELLED
    IF OLD.current_state = 'DRAFT'
       AND NEW.current_state IN ('PENDING', 'CANCELLED') THEN
        RETURN NEW;
    END IF;

    -- PENDING → APPROVED, REJECTED, CANCELLED
    IF OLD.current_state = 'PENDING'
       AND NEW.current_state IN ('APPROVED', 'REJECTED', 'CANCELLED') THEN
        RETURN NEW;
    END IF;

    -- Terminal states cannot transition
    IF OLD.current_state IN ('APPROVED', 'REJECTED', 'CANCELLED') THEN
        RAISE EXCEPTION
        'Illegal state transition from % to % (terminal state)',
        OLD.current_state,
        NEW.current_state;
    END IF;

    -- Any other transition is invalid
    RAISE EXCEPTION
    'Illegal workflow state transition from % to %',
    OLD.current_state,
    NEW.current_state;

END;
$$;

-- ============================================================
-- Attach Trigger
-- ============================================================

DROP TRIGGER IF EXISTS trg_enforce_workflow_state_machine
ON acl.workflow_requests;

CREATE TRIGGER trg_enforce_workflow_state_machine
BEFORE UPDATE ON acl.workflow_requests
FOR EACH ROW
EXECUTE FUNCTION acl.enforce_workflow_state_machine();

COMMENT ON FUNCTION acl.enforce_workflow_state_machine IS
'Deterministic state machine enforcement for workflow_requests. Prevents illegal lifecycle mutation.';

COMMIT;