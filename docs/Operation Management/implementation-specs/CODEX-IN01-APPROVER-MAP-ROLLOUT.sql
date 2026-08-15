-- Purpose: R-04-compliant ACL / approver data rollout for IN01 (Physical Inventory / MI07).
-- This is NOT a migration. Run via MCP / direct SQL separately in each target DB after the
-- corresponding code deploy. Mechanism target: same approver_map-driven approval engine as
-- PO/STO, keyed to the PID submitter (`submitted_by`) rather than a local hardcoded role branch.
--
-- Locked business chain:
--   L1_AUDITOR submits -> L2_AUDITOR OR DIRECTOR approves
--   L2_AUDITOR submits -> DIRECTOR approves
--   DIRECTOR submits -> self approval allowed via blanket override in code
--
-- Precondition:
--   Backend code using approver_map for IN01 approve/reopen has been deployed first.

-- ============================================================
-- 1) Verify premise (do not skip)
-- ============================================================

-- Existing approval policy on IN01 approve
SELECT *
FROM acl.resource_approval_policy
WHERE resource_code = 'PROC_PI_LIST'
  AND action_code = 'APPROVE';

-- Existing IN01 approve approver rows
SELECT company_id, module_code, resource_code, action_code, scope_type,
       subject_role_code, approver_role_code, approver_work_context_id, approval_stage
FROM acl.approver_map
WHERE resource_code = 'PROC_PI_LIST'
  AND action_code = 'APPROVE'
ORDER BY company_id, approval_stage, subject_role_code, approver_role_code;

-- Existing user overrides touching IN01 (must be reviewed, not assumed harmless)
SELECT *
FROM acl.user_overrides
WHERE resource_code = 'PROC_PI_LIST';

-- ============================================================
-- 2) Approval policy (required by approver_map trigger)
-- ============================================================

INSERT INTO acl.resource_approval_policy (
  resource_code,
  action_code,
  approval_required,
  approval_type,
  min_approvers,
  max_approvers
)
VALUES ('PROC_PI_LIST', 'APPROVE', TRUE, 'ANYONE', 1, 3)
ON CONFLICT (resource_code, action_code) DO UPDATE
SET approval_required = EXCLUDED.approval_required,
    approval_type = EXCLUDED.approval_type,
    min_approvers = EXCLUDED.min_approvers,
    max_approvers = EXCLUDED.max_approvers;

-- ============================================================
-- 3) Replace IN01 SUBJECT_ROLE approver rows with the locked chain
-- ============================================================

DELETE FROM acl.approver_map
WHERE resource_code = 'PROC_PI_LIST'
  AND action_code = 'APPROVE'
  AND scope_type = 'SUBJECT_ROLE'
  AND subject_role_code IN ('L1_AUDITOR', 'L2_AUDITOR');

WITH pid_module AS (
  SELECT module_code
  FROM acl.module_resource_map
  WHERE resource_code = 'PROC_PI_LIST'
  LIMIT 1
),
director_seed AS (
  SELECT
    uwc.company_id,
    MIN(uwc.auth_user_id) AS director_user_id
  FROM erp_acl.user_work_contexts uwc
  JOIN erp_acl.user_roles ur
    ON ur.auth_user_id = uwc.auth_user_id
   AND ur.role_code = 'DIRECTOR'
  GROUP BY uwc.company_id
),
l2_auditor_ctx AS (
  SELECT
    uwc.company_id,
    MIN(uwc.work_context_id) AS approver_work_context_id
  FROM erp_acl.user_work_contexts uwc
  JOIN erp_acl.user_roles ur
    ON ur.auth_user_id = uwc.auth_user_id
   AND ur.role_code = 'L2_AUDITOR'
  JOIN erp_acl.work_contexts wc
    ON wc.work_context_id = uwc.work_context_id
   AND wc.company_id = uwc.company_id
   AND wc.is_active = TRUE
  GROUP BY uwc.company_id
)
INSERT INTO acl.approver_map (
  company_id,
  module_code,
  approval_stage,
  approver_role_code,
  approver_user_id,
  created_by,
  resource_code,
  action_code,
  scope_type,
  subject_user_id,
  subject_work_context_id,
  subject_role_code,
  approver_work_context_id
)
SELECT
  ds.company_id,
  pm.module_code,
  1,
  rows.approver_role_code,
  NULL,
  ds.director_user_id,
  'PROC_PI_LIST',
  'APPROVE',
  'SUBJECT_ROLE',
  NULL,
  NULL,
  rows.subject_role_code,
  rows.approver_work_context_id
FROM pid_module pm
JOIN director_seed ds
  ON TRUE
JOIN (
  SELECT
    lac.company_id,
    'L1_AUDITOR'::text AS subject_role_code,
    'L2_AUDITOR'::text AS approver_role_code,
    lac.approver_work_context_id
  FROM l2_auditor_ctx lac

  UNION ALL

  SELECT
    ds.company_id,
    'L1_AUDITOR'::text AS subject_role_code,
    'DIRECTOR'::text AS approver_role_code,
    NULL::uuid AS approver_work_context_id
  FROM director_seed ds

  UNION ALL

  SELECT
    ds.company_id,
    'L2_AUDITOR'::text AS subject_role_code,
    'DIRECTOR'::text AS approver_role_code,
    NULL::uuid AS approver_work_context_id
  FROM director_seed ds
) rows
  ON rows.company_id = ds.company_id;

-- ============================================================
-- 4) Verify exact final shape
-- ============================================================

SELECT company_id, subject_role_code, approver_role_code, approver_work_context_id, approval_stage
FROM acl.approver_map
WHERE resource_code = 'PROC_PI_LIST'
  AND action_code = 'APPROVE'
  AND scope_type = 'SUBJECT_ROLE'
ORDER BY company_id, subject_role_code, approver_role_code;

-- Expected:
--   L1_AUDITOR -> L2_AUDITOR
--   L1_AUDITOR -> DIRECTOR
--   L2_AUDITOR -> DIRECTOR
--
-- If a company has no active L2_AUDITOR work context yet, the first row will be absent there.
-- That is acceptable temporarily: code then still allows DIRECTOR via the inserted DIRECTOR row.

-- ============================================================
-- 5) Post-implementation checklist reminders (run separately)
-- ============================================================
--   a) new acl_versions row per touched company
--   b) capture_acl_version_source(new_version_id)
--   c) generate_acl_snapshot(new_version_id)
--   d) verify precomputed_acl_view on active version only
--   e) ACL-MASTER drift check
--   f) rebuild_acl_menu_snapshot for representative users
