-- Phase 2 of the department-scoping fix (see migration 20260806110000 for Phase 1).
-- Existing prod rows have been backfilled via MCP (data change, not schema) with the
-- correct approver_work_context_id per resource/role. This constraint makes that
-- mandatory going forward for any NEW rank-based approver_map row: you cannot declare
-- "L2_MANAGER approves" without also declaring which department that L2_MANAGER must
-- belong to.
--
-- DIRECTOR is exempt: every handler that reads approver_map checks
-- hasBlanketApprovalOverride(ctx) BEFORE ever reaching matchesApprover(), so an
-- approver_role_code='DIRECTOR' row never actually gets evaluated by the
-- department-scope check -- DIRECTOR's authority is role-level, not department-bound,
-- by design.

ALTER TABLE acl.approver_map
  ADD CONSTRAINT approver_map_rank_based_requires_dept_scope
  CHECK (
    approver_role_code IS NULL
    OR approver_role_code = 'DIRECTOR'
    OR approver_work_context_id IS NOT NULL
  );
