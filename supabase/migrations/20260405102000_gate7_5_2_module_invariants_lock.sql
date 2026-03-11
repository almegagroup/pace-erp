/*
 * File-ID: 7.5.2
 * File-Path: supabase/migrations/20260405102000_gate7_5_2_module_invariants_lock.sql
 * Gate: 7.5
 * Phase: 7.5
 * Domain: ACL
 * Purpose: Reinforce intrinsic module approval invariants
 * Authority: Backend
 */

BEGIN;

-- ============================================================
-- 1️⃣ Re-assert approval_type integrity
-- ============================================================

ALTER TABLE acl.module_registry
    DROP CONSTRAINT IF EXISTS chk_approval_type_when_required;

ALTER TABLE acl.module_registry
    ADD CONSTRAINT chk_approval_type_when_required
    CHECK (
        (approval_required = FALSE AND approval_type IS NULL)
        OR
        (approval_required = TRUE AND approval_type IS NOT NULL)
    ) NOT VALID;

ALTER TABLE acl.module_registry
    VALIDATE CONSTRAINT chk_approval_type_when_required;

-- ============================================================
-- 2️⃣ Re-assert structural approver bounds
-- ============================================================

ALTER TABLE acl.module_registry
    DROP CONSTRAINT IF EXISTS chk_min_max_consistency;

ALTER TABLE acl.module_registry
    ADD CONSTRAINT chk_min_max_consistency
    CHECK (
        min_approvers BETWEEN 2 AND 3
        AND max_approvers BETWEEN 2 AND 3
        AND min_approvers <= max_approvers
    ) NOT VALID;

ALTER TABLE acl.module_registry
    VALIDATE CONSTRAINT chk_min_max_consistency;

COMMENT ON CONSTRAINT chk_approval_type_when_required
ON acl.module_registry
IS 'approval_type required only when approval_required = TRUE';

COMMENT ON CONSTRAINT chk_min_max_consistency
ON acl.module_registry
IS 'Approver bounds locked between 2–3 and min <= max';

COMMIT;