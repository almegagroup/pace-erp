/*
 * File-ID: gate9.approval_bounds_2_3
 * File-Path: supabase/migrations/20260417173000_gate9_approval_bounds_back_to_2_3.sql
 * Gate: 9
 * Phase: 9
 * Domain: APPROVAL
 * Purpose: Re-align approval count bounds with ACL SSOT so approval chains stay between 2 and 3 approvers.
 * Authority: DB
 */

BEGIN;

UPDATE acl.module_registry
SET
  min_approvers = GREATEST(COALESCE(min_approvers, 2), 2),
  max_approvers = GREATEST(COALESCE(max_approvers, 3), 2)
WHERE min_approvers < 2
   OR max_approvers < 2
   OR min_approvers IS NULL
   OR max_approvers IS NULL;

UPDATE acl.module_registry
SET max_approvers = min_approvers
WHERE max_approvers < min_approvers;

ALTER TABLE acl.module_registry
  ALTER COLUMN min_approvers SET DEFAULT 2,
  ALTER COLUMN max_approvers SET DEFAULT 3;

ALTER TABLE acl.module_registry
  DROP CONSTRAINT IF EXISTS module_registry_min_approvers_check,
  DROP CONSTRAINT IF EXISTS module_registry_max_approvers_check,
  DROP CONSTRAINT IF EXISTS ck_module_registry_approval_bounds,
  DROP CONSTRAINT IF EXISTS ck_module_registry_min_1_3,
  DROP CONSTRAINT IF EXISTS ck_module_registry_max_1_3;

ALTER TABLE acl.module_registry
  ADD CONSTRAINT ck_module_registry_min_2_3
    CHECK (min_approvers BETWEEN 2 AND 3),
  ADD CONSTRAINT ck_module_registry_max_2_3
    CHECK (max_approvers BETWEEN 2 AND 3),
  ADD CONSTRAINT ck_module_registry_approval_bounds
    CHECK (min_approvers <= max_approvers);

UPDATE acl.resource_approval_policy
SET
  min_approvers = GREATEST(COALESCE(min_approvers, 2), 2),
  max_approvers = GREATEST(COALESCE(max_approvers, 3), 2)
WHERE min_approvers < 2
   OR max_approvers < 2
   OR min_approvers IS NULL
   OR max_approvers IS NULL;

UPDATE acl.resource_approval_policy
SET max_approvers = min_approvers
WHERE max_approvers < min_approvers;

ALTER TABLE acl.resource_approval_policy
  ALTER COLUMN min_approvers SET DEFAULT 2,
  ALTER COLUMN max_approvers SET DEFAULT 3;

ALTER TABLE acl.resource_approval_policy
  DROP CONSTRAINT IF EXISTS resource_approval_policy_min_approvers_check,
  DROP CONSTRAINT IF EXISTS resource_approval_policy_max_approvers_check,
  DROP CONSTRAINT IF EXISTS ck_resource_approval_policy_min_1_3,
  DROP CONSTRAINT IF EXISTS ck_resource_approval_policy_max_1_3,
  DROP CONSTRAINT IF EXISTS ck_resource_approval_policy_bounds;

ALTER TABLE acl.resource_approval_policy
  ADD CONSTRAINT ck_resource_approval_policy_min_2_3
    CHECK (min_approvers BETWEEN 2 AND 3),
  ADD CONSTRAINT ck_resource_approval_policy_max_2_3
    CHECK (max_approvers BETWEEN 2 AND 3),
  ADD CONSTRAINT ck_resource_approval_policy_bounds
    CHECK (min_approvers <= max_approvers);

COMMIT;
