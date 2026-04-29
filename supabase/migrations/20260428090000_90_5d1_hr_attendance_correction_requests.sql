-- =============================================================================
-- Migration: 20260428090000_90_5d1_hr_attendance_correction_requests
-- Phase:     5-D-1  (HR Attendance — Correction Approval Workflow)
-- Goal:      Create erp_hr.attendance_correction_requests table.
--            HR submits a correction request → goes through the approval workflow
--            engine → Plant Manager (or designated approver) approves →
--            only then is the employee_day_records row updated.
--
--            This replaces the direct manualCorrectDayRecord path for the
--            primary UI flow. The existing handler remains as an internal/SA
--            emergency path only.
--
-- Design:    HR_ATTENDANCE_FULL_DESIGN.md § Entity 7 + Phase 5-D
-- Plan:      HR_ATTENDANCE_PROGRESS_LOG.md § Phase 5-D-1
-- =============================================================================


-- =============================================================================
-- SECTION 1 — erp_hr.attendance_correction_requests
-- =============================================================================

CREATE TABLE erp_hr.attendance_correction_requests (
  correction_request_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Workflow linkage (same engine as leave / out_work)
  workflow_request_id         UUID NOT NULL UNIQUE
                                REFERENCES acl.workflow_requests(request_id),

  -- The HR person who submitted the correction
  requester_auth_user_id      UUID NOT NULL REFERENCES auth.users(id),

  -- Company scope
  parent_company_id           UUID NOT NULL REFERENCES erp_master.companies(id),

  -- The employee whose day record needs correcting
  target_employee_id          UUID NOT NULL REFERENCES auth.users(id),

  -- The calendar date to correct
  target_date                 DATE NOT NULL,

  -- What status HR is requesting
  requested_status            TEXT NOT NULL
                                CHECK (requested_status IN ('PRESENT', 'ABSENT', 'MISS_PUNCH')),

  -- Snapshot of the current declared_status at submission time (for display / audit)
  -- NULL means no existing day record existed for that date at submission time
  previous_status             TEXT
                                CHECK (previous_status IS NULL OR previous_status IN (
                                  'PRESENT', 'LEAVE', 'OUT_WORK',
                                  'HOLIDAY', 'WEEK_OFF', 'ABSENT', 'MISS_PUNCH'
                                )),

  -- Mandatory reason from HR
  correction_note             TEXT NOT NULL,

  -- Cancellation (if HR cancels before approval decision)
  cancelled_at                TIMESTAMPTZ,
  cancelled_by                UUID REFERENCES auth.users(id),

  -- Lifecycle
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by                  UUID NOT NULL REFERENCES auth.users(id)
);


-- =============================================================================
-- SECTION 2 — Indexes
-- =============================================================================

-- Primary lookup by approver / inbox: all pending corrections for a company
CREATE INDEX idx_att_correction_company_date
  ON erp_hr.attendance_correction_requests (parent_company_id, target_date DESC);

-- HR's own submitted requests list
CREATE INDEX idx_att_correction_requester
  ON erp_hr.attendance_correction_requests (requester_auth_user_id, parent_company_id);

-- Lookup by target employee (for day record enrichment / history)
CREATE INDEX idx_att_correction_target_employee
  ON erp_hr.attendance_correction_requests (target_employee_id, parent_company_id, target_date DESC);


-- =============================================================================
-- SECTION 3 — RLS
-- =============================================================================

ALTER TABLE erp_hr.attendance_correction_requests ENABLE ROW LEVEL SECURITY;

-- Default deny (all operations blocked for non-service-role)
-- Backend always uses serviceRoleClient — this is a safety net only
CREATE POLICY "att_correction_requests_deny_all"
  ON erp_hr.attendance_correction_requests
  FOR ALL
  TO authenticated
  USING (FALSE);
