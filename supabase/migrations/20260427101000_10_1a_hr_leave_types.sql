-- =============================================================================
-- Migration: 20260427101000_10_1a_hr_leave_types
-- Phase:     1-A  (HR Attendance — Leave Types)
-- Goal:      Create erp_hr.leave_types table, attach leave_type_id to
--            erp_hr.leave_requests, seed 5 default types per company, backfill
--            existing requests with GEN type, then enforce NOT NULL.
-- Design:    HR_ATTENDANCE_FULL_DESIGN.md
-- Plan:      HR_ATTENDANCE_IMPLEMENTATION_PLAN.md § Phase 1-A
-- =============================================================================


-- ---------------------------------------------------------------------------
-- Step 1 — Create erp_hr.leave_types
-- ---------------------------------------------------------------------------

CREATE TABLE erp_hr.leave_types (
  leave_type_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             UUID NOT NULL REFERENCES erp_master.companies(id),
  type_code              TEXT NOT NULL,
  type_name              TEXT NOT NULL,
  is_paid                BOOLEAN NOT NULL DEFAULT TRUE,
  requires_document      BOOLEAN NOT NULL DEFAULT FALSE,
  max_days_per_year      INTEGER,
  carry_forward_allowed  BOOLEAN NOT NULL DEFAULT FALSE,
  is_active              BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order             INTEGER NOT NULL DEFAULT 0,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by             UUID REFERENCES auth.users(id),
  UNIQUE (company_id, type_code)
);

CREATE INDEX idx_leave_types_company
  ON erp_hr.leave_types (company_id, is_active, sort_order);

ALTER TABLE erp_hr.leave_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY leave_types_read_authenticated ON erp_hr.leave_types
  FOR SELECT TO authenticated USING (TRUE);


-- ---------------------------------------------------------------------------
-- Step 2 — Add leave_type_id + applied_by_auth_user_id to leave_requests
--           (nullable first — NOT NULL enforced after backfill in Step 5)
-- ---------------------------------------------------------------------------

ALTER TABLE erp_hr.leave_requests
  ADD COLUMN leave_type_id           UUID REFERENCES erp_hr.leave_types(leave_type_id),
  ADD COLUMN applied_by_auth_user_id UUID REFERENCES auth.users(id);


-- ---------------------------------------------------------------------------
-- Step 3 — Seed 5 default leave types for every existing company
-- ---------------------------------------------------------------------------

INSERT INTO erp_hr.leave_types
  (company_id, type_code, type_name, is_paid, requires_document, carry_forward_allowed, sort_order)
SELECT
  company_id,
  unnest(ARRAY['GEN', 'CL',            'SL',          'EL',            'LOP'         ]) AS type_code,
  unnest(ARRAY['General Leave',
               'Casual Leave',
               'Sick Leave',
               'Earned Leave',
               'Loss of Pay'                                                            ]) AS type_name,
  unnest(ARRAY[TRUE,  TRUE,             TRUE,          TRUE,            FALSE          ]) AS is_paid,
  unnest(ARRAY[FALSE, FALSE,            TRUE,          FALSE,           FALSE          ]) AS requires_document,
  unnest(ARRAY[FALSE, FALSE,            FALSE,         TRUE,            FALSE          ]) AS carry_forward_allowed,
  unnest(ARRAY[0,     1,                2,             3,               4              ]) AS sort_order
FROM erp_master.companies
ON CONFLICT (company_id, type_code) DO NOTHING;


-- ---------------------------------------------------------------------------
-- Step 4 — Backfill: assign GEN type to all existing leave_requests
-- ---------------------------------------------------------------------------

UPDATE erp_hr.leave_requests lr
SET leave_type_id = (
  SELECT lt.leave_type_id
  FROM erp_hr.leave_types lt
  WHERE lt.company_id = lr.parent_company_id
    AND lt.type_code  = 'GEN'
  LIMIT 1
)
WHERE lr.leave_type_id IS NULL;


-- ---------------------------------------------------------------------------
-- Step 5 — Enforce NOT NULL on leave_type_id (backfill must be complete above)
-- ---------------------------------------------------------------------------

ALTER TABLE erp_hr.leave_requests
  ALTER COLUMN leave_type_id SET NOT NULL;
