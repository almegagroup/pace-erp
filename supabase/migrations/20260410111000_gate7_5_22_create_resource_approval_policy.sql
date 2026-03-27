/*
 * File-ID: 7.5.22
 * File-Path: supabase/migrations/20260410111000_gate7_5_22_create_resource_approval_policy.sql
 * Gate: 7.5
 * Phase: 7.5
 * Domain: ACL
 * Purpose: Define exact approval requirement at governed resource and action scope.
 * Authority: Backend
 */

BEGIN;

-- ============================================================
-- RESOURCE APPROVAL POLICY
-- ------------------------------------------------------------
-- Purpose:
--   - Move approval truth below blanket module-only scope
--   - Allow the same module to contain:
--       * approval-required work
--       * non-approval work
--   - Bind approval requirement to exact governed work target
--   - Preserve approval-type and approver-bound discipline
-- ============================================================

CREATE TABLE IF NOT EXISTS acl.resource_approval_policy (
  resource_code      TEXT NOT NULL
    REFERENCES erp_menu.menu_master(resource_code)
    ON DELETE CASCADE,

  action_code        TEXT NOT NULL
    CHECK (action_code IN ('VIEW', 'WRITE', 'EDIT', 'DELETE', 'APPROVE', 'EXPORT')),

  approval_required  BOOLEAN NOT NULL DEFAULT FALSE,

  approval_type      TEXT NULL
    CHECK (approval_type IN ('ANYONE', 'SEQUENTIAL', 'MUST_ALL')),

  min_approvers      SMALLINT NOT NULL DEFAULT 2
    CHECK (min_approvers BETWEEN 2 AND 3),

  max_approvers      SMALLINT NOT NULL DEFAULT 3
    CHECK (max_approvers BETWEEN 2 AND 3),

  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by         UUID NULL,

  CONSTRAINT pk_resource_approval_policy
    PRIMARY KEY (resource_code, action_code),

  CONSTRAINT chk_resource_approval_type_when_required
    CHECK (
      (approval_required = FALSE AND approval_type IS NULL)
      OR
      (approval_required = TRUE AND approval_type IS NOT NULL)
    ),

  CONSTRAINT chk_resource_approval_min_max_consistency
    CHECK (min_approvers <= max_approvers)
);

COMMENT ON TABLE acl.resource_approval_policy IS
'Exact approval policy per governed resource and action. Allows approval truth to be selective inside the same module instead of assuming module-wide approval by default.';

COMMENT ON COLUMN acl.resource_approval_policy.resource_code IS
'Governed resource or page identity.';

COMMENT ON COLUMN acl.resource_approval_policy.action_code IS
'Exact governed action requiring or not requiring approval.';

COMMENT ON COLUMN acl.resource_approval_policy.approval_required IS
'TRUE only when this exact resource-action pair requires workflow approval.';

ALTER TABLE acl.resource_approval_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE acl.resource_approval_policy FORCE ROW LEVEL SECURITY;

CREATE POLICY resource_approval_policy_read_authenticated
ON acl.resource_approval_policy
FOR SELECT
TO authenticated
USING (TRUE);

COMMIT;
