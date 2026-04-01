/*
 * File-ID: 7.5.25
 * File-Path: supabase/migrations/20260410136000_gate7_5_25_fix_approval_bound_column_checks.sql
 * Gate: 7.5
 * Phase: 7.5
 * Domain: ACL
 * Purpose: Remove legacy column-level 2-3 approval bound checks and replace them with canonical 1-3 rules
 * Authority: Backend
 */

BEGIN;

ALTER TABLE acl.module_registry
  ALTER COLUMN min_approvers SET DEFAULT 1,
  ALTER COLUMN max_approvers SET DEFAULT 3;

ALTER TABLE acl.module_registry
  DROP CONSTRAINT IF EXISTS module_registry_min_approvers_check;

ALTER TABLE acl.module_registry
  DROP CONSTRAINT IF EXISTS module_registry_max_approvers_check;

ALTER TABLE acl.module_registry
  DROP CONSTRAINT IF EXISTS chk_min_max_consistency;

ALTER TABLE acl.module_registry
  ADD CONSTRAINT module_registry_min_approvers_check
  CHECK (min_approvers BETWEEN 1 AND 3) NOT VALID;

ALTER TABLE acl.module_registry
  VALIDATE CONSTRAINT module_registry_min_approvers_check;

ALTER TABLE acl.module_registry
  ADD CONSTRAINT module_registry_max_approvers_check
  CHECK (max_approvers BETWEEN 1 AND 3) NOT VALID;

ALTER TABLE acl.module_registry
  VALIDATE CONSTRAINT module_registry_max_approvers_check;

ALTER TABLE acl.module_registry
  ADD CONSTRAINT chk_min_max_consistency
  CHECK (min_approvers <= max_approvers) NOT VALID;

ALTER TABLE acl.module_registry
  VALIDATE CONSTRAINT chk_min_max_consistency;

COMMENT ON CONSTRAINT chk_min_max_consistency
ON acl.module_registry
IS 'Approver bounds locked between 1-3 and min <= max';

ALTER TABLE acl.resource_approval_policy
  ALTER COLUMN min_approvers SET DEFAULT 1,
  ALTER COLUMN max_approvers SET DEFAULT 3;

ALTER TABLE acl.resource_approval_policy
  DROP CONSTRAINT IF EXISTS resource_approval_policy_min_approvers_check;

ALTER TABLE acl.resource_approval_policy
  DROP CONSTRAINT IF EXISTS resource_approval_policy_max_approvers_check;

ALTER TABLE acl.resource_approval_policy
  DROP CONSTRAINT IF EXISTS chk_resource_approval_min_max_consistency;

ALTER TABLE acl.resource_approval_policy
  ADD CONSTRAINT resource_approval_policy_min_approvers_check
  CHECK (min_approvers BETWEEN 1 AND 3) NOT VALID;

ALTER TABLE acl.resource_approval_policy
  VALIDATE CONSTRAINT resource_approval_policy_min_approvers_check;

ALTER TABLE acl.resource_approval_policy
  ADD CONSTRAINT resource_approval_policy_max_approvers_check
  CHECK (max_approvers BETWEEN 1 AND 3) NOT VALID;

ALTER TABLE acl.resource_approval_policy
  VALIDATE CONSTRAINT resource_approval_policy_max_approvers_check;

ALTER TABLE acl.resource_approval_policy
  ADD CONSTRAINT chk_resource_approval_min_max_consistency
  CHECK (min_approvers <= max_approvers) NOT VALID;

ALTER TABLE acl.resource_approval_policy
  VALIDATE CONSTRAINT chk_resource_approval_min_max_consistency;

COMMIT;
