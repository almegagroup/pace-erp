-- Adds department-scope to rank-based approver_map rows.
-- Today matchesApprover() (duplicated across 8 handler files + workflow_scope.ts's
-- isWorkflowActionableForApprover) checks approver_role_code against the caller's role
-- ONLY -- it never checks which department/work_context the approver themselves belongs
-- to. So a same-ranked person in the wrong department could theoretically qualify as an
-- approver for another department's documents. This column lets a rank-based row declare
-- which work_context the approver must ALSO belong to. Nullable for now (Phase 1) --
-- existing rows are backfilled via MCP before a follow-up migration adds a CHECK
-- constraint requiring it whenever approver_role_code is set.

ALTER TABLE acl.approver_map
  ADD COLUMN approver_work_context_id uuid NULL
    REFERENCES erp_acl.work_contexts (work_context_id);

COMMENT ON COLUMN acl.approver_map.approver_work_context_id IS
  'Department the approver must belong to when approver_role_code is set (rank-based rule). NULL for approver_user_id (named-person) rows, since identity already disambiguates. Phase 1: nullable, backfilled via MCP; Phase 2 migration adds a CHECK constraint once existing rows are backfilled.';
