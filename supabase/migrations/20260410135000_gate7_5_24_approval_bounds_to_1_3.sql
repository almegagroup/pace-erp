/*
 * File-ID: 7.5.24
 * File-Path: supabase/migrations/20260410135000_gate7_5_24_approval_bounds_to_1_3.sql
 * Gate: 7.5
 * Phase: 7.5
 * Domain: ACL
 * Purpose: Expand approval policy bounds from 2-3 to 1-3 across module and resource approval law
 * Authority: Backend
 */

BEGIN;

ALTER TABLE acl.module_registry
  ALTER COLUMN min_approvers SET DEFAULT 1;

ALTER TABLE acl.module_registry
  DROP CONSTRAINT IF EXISTS chk_min_max_consistency;

ALTER TABLE acl.module_registry
  ADD CONSTRAINT chk_min_max_consistency
  CHECK (
    min_approvers BETWEEN 1 AND 3
    AND max_approvers BETWEEN 1 AND 3
    AND min_approvers <= max_approvers
  ) NOT VALID;

ALTER TABLE acl.module_registry
  VALIDATE CONSTRAINT chk_min_max_consistency;

COMMENT ON CONSTRAINT chk_min_max_consistency
ON acl.module_registry
IS 'Approver bounds locked between 1-3 and min <= max';

ALTER TABLE acl.resource_approval_policy
  ALTER COLUMN min_approvers SET DEFAULT 1;

ALTER TABLE acl.resource_approval_policy
  DROP CONSTRAINT IF EXISTS chk_resource_approval_min_max_consistency;

ALTER TABLE acl.resource_approval_policy
  ADD CONSTRAINT chk_resource_approval_min_max_consistency
  CHECK (
    min_approvers BETWEEN 1 AND 3
    AND max_approvers BETWEEN 1 AND 3
    AND min_approvers <= max_approvers
  ) NOT VALID;

ALTER TABLE acl.resource_approval_policy
  VALIDATE CONSTRAINT chk_resource_approval_min_max_consistency;

COMMIT;
