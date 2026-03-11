/*
 * File-ID: 7.5.4
 * File-Path: supabase/migrations/20260405104000_gate7_5_4_approver_map_strengthening.sql
 * Gate: 7.5
 * Phase: 7.5
 * Domain: ACL
 * Purpose: Reinforce approver_map structural integrity (XOR + stage discipline)
 * Authority: Backend
 */

BEGIN;

-- ============================================================
-- 1️⃣ Enforce XOR rule (role OR user, but not both, not none)
-- ============================================================

ALTER TABLE acl.approver_map
    DROP CONSTRAINT IF EXISTS chk_approver_xor;

ALTER TABLE acl.approver_map
    ADD CONSTRAINT chk_approver_xor
    CHECK (
        (
            approver_role_code IS NOT NULL
            AND approver_user_id IS NULL
        )
        OR
        (
            approver_role_code IS NULL
            AND approver_user_id IS NOT NULL
        )
    ) NOT VALID;

ALTER TABLE acl.approver_map
    VALIDATE CONSTRAINT chk_approver_xor;


-- ============================================================
-- 2️⃣ Ensure approval_stage is positive
-- ============================================================

ALTER TABLE acl.approver_map
    DROP CONSTRAINT IF EXISTS chk_stage_positive;

ALTER TABLE acl.approver_map
    ADD CONSTRAINT chk_stage_positive
    CHECK (approval_stage >= 1) NOT VALID;

ALTER TABLE acl.approver_map
    VALIDATE CONSTRAINT chk_stage_positive;


-- ============================================================
-- 3️⃣ Enforce unique stage per company + module
-- ============================================================

DROP INDEX IF EXISTS uq_approver_stage_per_module;

CREATE UNIQUE INDEX uq_approver_stage_per_module
ON acl.approver_map (
    company_id,
    module_code,
    approval_stage
);

COMMIT;