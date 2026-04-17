/*
 * File-ID: gate9.approval_bounds_1_3_restore
 * File-Path: supabase/migrations/20260417181000_gate9_approval_bounds_back_to_1_3.sql
 * Gate: 9
 * Phase: 9
 * Domain: APPROVAL
 * Purpose: Restore approval bounds to 1..3 after business clarification that min approver count is not fixed at 2.
 * Authority: DB
 */

BEGIN;

ALTER TABLE acl.module_registry
  ALTER COLUMN min_approvers SET DEFAULT 1,
  ALTER COLUMN max_approvers SET DEFAULT 3;

ALTER TABLE acl.module_registry
  DROP CONSTRAINT IF EXISTS module_registry_min_approvers_check,
  DROP CONSTRAINT IF EXISTS module_registry_max_approvers_check,
  DROP CONSTRAINT IF EXISTS ck_module_registry_approval_bounds,
  DROP CONSTRAINT IF EXISTS ck_module_registry_min_2_3,
  DROP CONSTRAINT IF EXISTS ck_module_registry_max_2_3;

ALTER TABLE acl.module_registry
  ADD CONSTRAINT ck_module_registry_min_1_3
    CHECK (min_approvers BETWEEN 1 AND 3),
  ADD CONSTRAINT ck_module_registry_max_1_3
    CHECK (max_approvers BETWEEN 1 AND 3),
  ADD CONSTRAINT ck_module_registry_approval_bounds
    CHECK (min_approvers <= max_approvers);

ALTER TABLE acl.resource_approval_policy
  ALTER COLUMN min_approvers SET DEFAULT 1,
  ALTER COLUMN max_approvers SET DEFAULT 3;

ALTER TABLE acl.resource_approval_policy
  DROP CONSTRAINT IF EXISTS resource_approval_policy_min_approvers_check,
  DROP CONSTRAINT IF EXISTS resource_approval_policy_max_approvers_check,
  DROP CONSTRAINT IF EXISTS ck_resource_approval_policy_bounds,
  DROP CONSTRAINT IF EXISTS ck_resource_approval_policy_min_2_3,
  DROP CONSTRAINT IF EXISTS ck_resource_approval_policy_max_2_3;

ALTER TABLE acl.resource_approval_policy
  ADD CONSTRAINT ck_resource_approval_policy_min_1_3
    CHECK (min_approvers BETWEEN 1 AND 3),
  ADD CONSTRAINT ck_resource_approval_policy_max_1_3
    CHECK (max_approvers BETWEEN 1 AND 3),
  ADD CONSTRAINT ck_resource_approval_policy_bounds
    CHECK (min_approvers <= max_approvers);

COMMIT;
