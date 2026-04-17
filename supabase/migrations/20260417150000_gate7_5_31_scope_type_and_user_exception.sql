/*
 * File-ID: 7.5.31A
 * File-Path: supabase/migrations/20260417150000_gate7_5_31_scope_type_and_user_exception.sql
 * Gate: 7.5
 * Phase: Stabilization
 * Domain: Workflow
 * Purpose: Add explicit scope typing and requester user exception support for approval and viewer rules
 * Authority: Backend
 */

ALTER TABLE acl.approver_map
  ADD COLUMN IF NOT EXISTS scope_type TEXT NULL,
  ADD COLUMN IF NOT EXISTS subject_user_id UUID NULL;

ALTER TABLE acl.report_viewer_map
  ADD COLUMN IF NOT EXISTS scope_type TEXT NULL,
  ADD COLUMN IF NOT EXISTS subject_user_id UUID NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ck_approver_map_scope_type'
  ) THEN
    ALTER TABLE acl.approver_map
      ADD CONSTRAINT ck_approver_map_scope_type
      CHECK (
        scope_type IS NULL OR
        scope_type IN ('COMPANY_WIDE', 'DEPARTMENT', 'WORK_CONTEXT', 'USER_EXCEPTION', 'DIRECTOR')
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ck_report_viewer_map_scope_type'
  ) THEN
    ALTER TABLE acl.report_viewer_map
      ADD CONSTRAINT ck_report_viewer_map_scope_type
      CHECK (
        scope_type IS NULL OR
        scope_type IN ('COMPANY_WIDE', 'DEPARTMENT', 'WORK_CONTEXT', 'USER_EXCEPTION', 'DIRECTOR')
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_approver_map_subject_user_id'
  ) THEN
    ALTER TABLE acl.approver_map
      ADD CONSTRAINT fk_approver_map_subject_user_id
      FOREIGN KEY (subject_user_id)
      REFERENCES erp_core.users(auth_user_id)
      ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_report_viewer_map_subject_user_id'
  ) THEN
    ALTER TABLE acl.report_viewer_map
      ADD CONSTRAINT fk_report_viewer_map_subject_user_id
      FOREIGN KEY (subject_user_id)
      REFERENCES erp_core.users(auth_user_id)
      ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN acl.approver_map.scope_type IS
'Explicit routing scope. NULL rows remain legacy-compatible and are inferred by backend helpers.';

COMMENT ON COLUMN acl.approver_map.subject_user_id IS
'Optional requester-auth-user exception scope. Used only when scope_type = USER_EXCEPTION.';

COMMENT ON COLUMN acl.report_viewer_map.scope_type IS
'Explicit report visibility scope. NULL rows remain legacy-compatible and are inferred by backend helpers.';

COMMENT ON COLUMN acl.report_viewer_map.subject_user_id IS
'Optional requester-auth-user exception scope. Used only when scope_type = USER_EXCEPTION.';

CREATE INDEX IF NOT EXISTS idx_approver_map_scope_type
ON acl.approver_map (company_id, module_code, scope_type);

CREATE INDEX IF NOT EXISTS idx_approver_map_subject_user
ON acl.approver_map (company_id, module_code, subject_user_id)
WHERE subject_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_report_viewer_map_scope_type
ON acl.report_viewer_map (company_id, module_code, scope_type);

CREATE INDEX IF NOT EXISTS idx_report_viewer_map_subject_user
ON acl.report_viewer_map (company_id, module_code, subject_user_id)
WHERE subject_user_id IS NOT NULL;
