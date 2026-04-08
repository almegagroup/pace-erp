BEGIN;

CREATE SCHEMA IF NOT EXISTS erp_hr;

CREATE TABLE IF NOT EXISTS erp_hr.out_work_destinations (
  destination_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL
    REFERENCES erp_master.companies(id)
    ON DELETE CASCADE,
  destination_name TEXT NOT NULL,
  destination_address TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NULL,

  CONSTRAINT uq_out_work_destinations_company_name_address
    UNIQUE (company_id, destination_name, destination_address)
);

CREATE TABLE IF NOT EXISTS erp_hr.leave_requests (
  leave_request_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_request_id UUID NOT NULL UNIQUE
    REFERENCES acl.workflow_requests(request_id)
    ON DELETE CASCADE,
  requester_auth_user_id UUID NOT NULL
    REFERENCES auth.users(id)
    ON DELETE CASCADE,
  parent_company_id UUID NOT NULL
    REFERENCES erp_master.companies(id)
    ON DELETE CASCADE,
  from_date DATE NOT NULL,
  to_date DATE NOT NULL,
  total_days INTEGER NOT NULL
    CHECK (total_days >= 1),
  reason TEXT NOT NULL,
  cancelled_at TIMESTAMPTZ NULL,
  cancelled_by UUID NULL
    REFERENCES auth.users(id)
    ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL
    REFERENCES auth.users(id)
    ON DELETE RESTRICT,

  CONSTRAINT ck_leave_requests_date_span
    CHECK (to_date >= from_date)
);

CREATE TABLE IF NOT EXISTS erp_hr.out_work_requests (
  out_work_request_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_request_id UUID NOT NULL UNIQUE
    REFERENCES acl.workflow_requests(request_id)
    ON DELETE CASCADE,
  requester_auth_user_id UUID NOT NULL
    REFERENCES auth.users(id)
    ON DELETE CASCADE,
  parent_company_id UUID NOT NULL
    REFERENCES erp_master.companies(id)
    ON DELETE CASCADE,
  destination_id UUID NULL
    REFERENCES erp_hr.out_work_destinations(destination_id)
    ON DELETE SET NULL,
  destination_name TEXT NOT NULL,
  destination_address TEXT NOT NULL,
  from_date DATE NOT NULL,
  to_date DATE NOT NULL,
  total_days INTEGER NOT NULL
    CHECK (total_days >= 1),
  reason TEXT NOT NULL,
  cancelled_at TIMESTAMPTZ NULL,
  cancelled_by UUID NULL
    REFERENCES auth.users(id)
    ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL
    REFERENCES auth.users(id)
    ON DELETE RESTRICT,

  CONSTRAINT ck_out_work_requests_date_span
    CHECK (to_date >= from_date)
);

CREATE INDEX IF NOT EXISTS idx_leave_requests_requester
ON erp_hr.leave_requests (requester_auth_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_leave_requests_company
ON erp_hr.leave_requests (parent_company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_out_work_requests_requester
ON erp_hr.out_work_requests (requester_auth_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_out_work_requests_company
ON erp_hr.out_work_requests (parent_company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_out_work_destinations_company
ON erp_hr.out_work_destinations (company_id, is_active, destination_name);

ALTER TABLE erp_hr.out_work_destinations ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_hr.out_work_destinations FORCE ROW LEVEL SECURITY;

ALTER TABLE erp_hr.leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_hr.leave_requests FORCE ROW LEVEL SECURITY;

ALTER TABLE erp_hr.out_work_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_hr.out_work_requests FORCE ROW LEVEL SECURITY;

CREATE POLICY out_work_destinations_read_authenticated
ON erp_hr.out_work_destinations
FOR SELECT
TO authenticated
USING (TRUE);

CREATE POLICY leave_requests_read_authenticated
ON erp_hr.leave_requests
FOR SELECT
TO authenticated
USING (TRUE);

CREATE POLICY out_work_requests_read_authenticated
ON erp_hr.out_work_requests
FOR SELECT
TO authenticated
USING (TRUE);

ALTER TABLE acl.resource_approval_policy
  ALTER COLUMN min_approvers SET DEFAULT 1,
  ALTER COLUMN max_approvers SET DEFAULT 3;

ALTER TABLE acl.resource_approval_policy
  DROP CONSTRAINT IF EXISTS resource_approval_policy_min_approvers_check,
  DROP CONSTRAINT IF EXISTS resource_approval_policy_max_approvers_check,
  DROP CONSTRAINT IF EXISTS ck_resource_approval_policy_min_1_3,
  DROP CONSTRAINT IF EXISTS ck_resource_approval_policy_max_1_3;

ALTER TABLE acl.resource_approval_policy
  ADD CONSTRAINT ck_resource_approval_policy_min_1_3
    CHECK (min_approvers BETWEEN 1 AND 3),
  ADD CONSTRAINT ck_resource_approval_policy_max_1_3
    CHECK (max_approvers BETWEEN 1 AND 3);

WITH desired_policies AS (
  SELECT *
  FROM (
    VALUES
      ('HR_LEAVE_APPLY', 'WRITE', TRUE, 'ANYONE', 1, 3),
      ('HR_LEAVE_APPROVAL_INBOX', 'APPROVE', TRUE, 'ANYONE', 1, 3),
      ('HR_OUT_WORK_APPLY', 'WRITE', TRUE, 'ANYONE', 1, 3),
      ('HR_OUT_WORK_APPROVAL_INBOX', 'APPROVE', TRUE, 'ANYONE', 1, 3)
  ) AS rows(resource_code, action_code, approval_required, approval_type, min_approvers, max_approvers)
),
existing_resources AS (
  SELECT dp.*
  FROM desired_policies AS dp
  JOIN erp_menu.menu_master AS mm
    ON mm.resource_code = dp.resource_code
)
INSERT INTO acl.resource_approval_policy (
  resource_code,
  action_code,
  approval_required,
  approval_type,
  min_approvers,
  max_approvers,
  created_at,
  created_by
)
SELECT
  resource_code,
  action_code,
  approval_required,
  approval_type,
  min_approvers,
  max_approvers,
  now(),
  NULL
FROM existing_resources
ON CONFLICT (resource_code, action_code)
DO UPDATE SET
  approval_required = EXCLUDED.approval_required,
  approval_type = EXCLUDED.approval_type,
  min_approvers = EXCLUDED.min_approvers,
  max_approvers = EXCLUDED.max_approvers;

COMMIT;
