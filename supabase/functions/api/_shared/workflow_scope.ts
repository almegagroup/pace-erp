/*
 * File-ID: 7.5.31
 * File-Path: supabase/functions/api/_shared/workflow_scope.ts
 * Gate: 7.5
 * Phase: 7.5
 * Domain: Workflow
 * Purpose: Shared workflow-scope resolution and matching helpers
 * Authority: Backend
 */

type DbClient = {
  schema: (schema: string) => {
    from: (table: string) => any;
  };
};

export type WorkflowScopeContextRow = {
  work_context_id: string;
  company_id: string;
  work_context_code: string;
  work_context_name: string | null;
  department_id: string | null;
  is_active: boolean;
};

export type WorkflowScopeInput = {
  resource_code?: string | null;
  action_code?: string | null;
  requester_work_context_id?: string | null;
  requester_department_work_context_id?: string | null;
};

type ScopedRuleRow = {
  resource_code: string | null;
  action_code: string | null;
  subject_work_context_id: string | null;
};

type StageScopedRuleRow = ScopedRuleRow & {
  approval_stage: number;
};

type ActionableApproverRuleRow = {
  approval_stage: number;
  approver_role_code: string | null;
  approver_user_id: string | null;
};

type ActionableDecisionRow = {
  stage_number: number;
  approver_auth_user_id: string;
};

export function isGeneralOpsWorkContextCode(
  workContextCode: string | null | undefined,
): boolean {
  return String(workContextCode ?? "").trim().toUpperCase() === "GENERAL_OPS";
}

export function isDepartmentWorkContextCode(
  workContextCode: string | null | undefined,
): boolean {
  return String(workContextCode ?? "").trim().toUpperCase().startsWith("DEPT_");
}

export function isBusinessWorkflowWorkContext(
  row: Pick<WorkflowScopeContextRow, "work_context_code" | "is_active"> | null | undefined,
): boolean {
  return Boolean(row?.is_active === true && !isGeneralOpsWorkContextCode(row?.work_context_code));
}

export async function loadActiveCompanyWorkContexts(
  db: DbClient,
  companyId: string,
): Promise<WorkflowScopeContextRow[]> {
  const { data, error } = await db
    .schema("erp_acl")
    .from("work_contexts")
    .select("work_context_id, company_id, work_context_code, work_context_name, department_id, is_active")
    .eq("company_id", companyId)
    .eq("is_active", true);

  if (error) {
    throw new Error("WORKFLOW_SCOPE_CONTEXT_LOOKUP_FAILED");
  }

  return (data ?? []) as WorkflowScopeContextRow[];
}

export function createWorkflowScopeContextMap(
  rows: WorkflowScopeContextRow[],
): Map<string, WorkflowScopeContextRow> {
  return new Map(
    rows
      .filter((row) => Boolean(row?.work_context_id))
      .map((row) => [row.work_context_id, row]),
  );
}

export function resolveDepartmentWorkflowScopeId(
  workflow: Pick<WorkflowScopeInput, "requester_work_context_id">,
  workContextMap: Map<string, WorkflowScopeContextRow>,
): string | null {
  const requesterWorkContextId = workflow.requester_work_context_id ?? null;
  if (!requesterWorkContextId) {
    return null;
  }

  const requesterScope = workContextMap.get(requesterWorkContextId) ?? null;
  if (!requesterScope?.department_id) {
    return null;
  }

  if (isDepartmentWorkContextCode(requesterScope.work_context_code)) {
    return requesterScope.work_context_id;
  }

  for (const row of workContextMap.values()) {
    if (
      row.company_id === requesterScope.company_id &&
      row.department_id === requesterScope.department_id &&
      isDepartmentWorkContextCode(row.work_context_code)
    ) {
      return row.work_context_id;
    }
  }

  return null;
}

function filterRulesByResource<T extends ScopedRuleRow>(
  workflow: WorkflowScopeInput,
  rows: T[],
  targetAction: string | null = workflow.action_code ?? null,
): T[] {
  if (workflow.resource_code && targetAction) {
    return rows.filter((row) =>
      row.resource_code === workflow.resource_code &&
      row.action_code === targetAction
    );
  }

  return rows.filter((row) => row.resource_code === null && row.action_code === null);
}

function buildScopeTierPriority(workflow: WorkflowScopeInput): Array<string | null> {
  const priority: Array<string | null> = [];
  const candidates = [
    workflow.requester_work_context_id ?? null,
    workflow.requester_department_work_context_id ?? null,
    null,
  ];

  for (const candidate of candidates) {
    if (!priority.some((existing) => existing === candidate)) {
      priority.push(candidate);
    }
  }

  return priority;
}

export function pickScopedApproverRules<T extends StageScopedRuleRow>(
  workflow: WorkflowScopeInput,
  approverRows: T[],
): T[] {
  const resourceScopedRows = filterRulesByResource(workflow, approverRows);
  if (resourceScopedRows.length === 0) {
    return [];
  }

  const scopePriority = buildScopeTierPriority(workflow);
  const stages = [...new Set(resourceScopedRows.map((row) => row.approval_stage))].sort(
    (left, right) => left - right,
  );

  const resolvedRows: T[] = [];

  for (const stage of stages) {
    const stageRows = resourceScopedRows.filter((row) => row.approval_stage === stage);

    for (const subjectScopeId of scopePriority) {
      const matches = stageRows.filter((row) => row.subject_work_context_id === subjectScopeId);
      if (matches.length > 0) {
        resolvedRows.push(...matches);
        break;
      }
    }
  }

  return resolvedRows;
}

export function pickScopedViewerRules<T extends ScopedRuleRow>(
  workflow: WorkflowScopeInput,
  viewerRows: T[],
  targetAction = "VIEW",
): T[] {
  const resourceScopedRows = filterRulesByResource(
    workflow,
    viewerRows,
    targetAction,
  );
  if (resourceScopedRows.length === 0) {
    return [];
  }

  const scopePriority = buildScopeTierPriority(workflow);

  for (const subjectScopeId of scopePriority) {
    const matches = resourceScopedRows.filter((row) => row.subject_work_context_id === subjectScopeId);
    if (matches.length > 0) {
      return matches;
    }
  }

  return [];
}

export function getNextWorkflowSequentialStage<T extends Pick<ActionableApproverRuleRow, "approval_stage">>(
  scopedApprovers: T[],
  decisions: Array<Pick<ActionableDecisionRow, "stage_number">>,
): number | null {
  const distinctStages = [
    ...new Set(scopedApprovers.map((row) => row.approval_stage)),
  ].sort((left, right) => left - right);

  for (const stage of distinctStages) {
    const stageHasDecision = decisions.some((decision) => decision.stage_number === stage);
    if (!stageHasDecision) {
      return stage;
    }
  }

  return null;
}

export function isWorkflowActionableForApprover<T extends ActionableApproverRuleRow>(
  input: {
    approvalType: "ANYONE" | "SEQUENTIAL" | "MUST_ALL";
    requesterAuthUserId: string;
    scopedApprovers: T[];
    decisions: ActionableDecisionRow[];
    authUserId: string;
    roleCode: string;
  },
): boolean {
  if (input.requesterAuthUserId === input.authUserId) {
    return false;
  }

  const matchedApproverStages = input.scopedApprovers
    .filter((row) => {
      if (row.approver_user_id) {
        return row.approver_user_id === input.authUserId;
      }

      if (row.approver_role_code) {
        return row.approver_role_code === input.roleCode;
      }

      return false;
    })
    .map((row) => row.approval_stage);

  if (matchedApproverStages.length === 0) {
    return false;
  }

  const currentUserHasDecision = input.decisions.some(
    (row) => row.approver_auth_user_id === input.authUserId,
  );

  if (currentUserHasDecision) {
    return false;
  }

  if (input.approvalType === "SEQUENTIAL") {
    const expectedStage = getNextWorkflowSequentialStage(
      input.scopedApprovers,
      input.decisions,
    );
    return expectedStage !== null && matchedApproverStages.includes(expectedStage);
  }

  return true;
}
