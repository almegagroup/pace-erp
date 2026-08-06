/*
 * File-ID: 7.5.31
 * File-Path: supabase/functions/api/_shared/workflow_scope.ts
 * Gate: 7.5
 * Phase: 7.5
 * Domain: Workflow
 * Purpose: Shared workflow-scope resolution and matching helpers
 * Authority: Backend
 */

import type { DbClient } from "./db_client.ts";

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
  requester_auth_user_id?: string | null;
  requester_work_context_id?: string | null;
  requester_department_work_context_id?: string | null;
  requester_role_code?: string | null;
};

type ScopedRuleRow = {
  resource_code: string | null;
  action_code: string | null;
  scope_type?: string | null;
  subject_work_context_id: string | null;
  subject_user_id?: string | null;
  subject_role_code?: string | null;
};

type StageScopedRuleRow = ScopedRuleRow & {
  approval_stage: number;
};

type ActionableApproverRuleRow = {
  approval_stage: number;
  approver_role_code: string | null;
  approver_user_id: string | null;
  approver_work_context_id?: string | null;
};

type ActionableDecisionRow = {
  stage_number: number;
  approver_auth_user_id: string;
};

export type ApproverMatchRow = {
  approver_user_id: string | null;
  approver_role_code: string | null;
  approver_work_context_id?: string | null;
};

export type ApproverMatchContext = {
  auth_user_id: string;
  roleCode: string;
  approverWorkContextIds: ReadonlySet<string>;
};

/*
 * Centralized approver match: named person (approver_user_id) always wins on identity
 * alone. Rank-based rows (approver_role_code) additionally require the caller to
 * currently hold membership in approver_work_context_id (the department the rule
 * declares) -- a same-ranked person in an unrelated department no longer qualifies.
 * Legacy rows with approver_role_code set but no approver_work_context_id (pre-migration
 * data not yet backfilled) fall back to the old rank-only behavior so nothing breaks
 * mid-backfill.
 */
export function matchesApprover<T extends ApproverMatchRow>(
  rows: T[],
  ctx: ApproverMatchContext,
): boolean {
  return rows.some((row) => {
    if (row.approver_user_id) {
      return row.approver_user_id === ctx.auth_user_id;
    }

    if (row.approver_role_code) {
      if (row.approver_role_code !== ctx.roleCode) {
        return false;
      }

      if (!row.approver_work_context_id) {
        return true; // legacy, not yet backfilled
      }

      return ctx.approverWorkContextIds.has(row.approver_work_context_id);
    }

    return false;
  });
}

/*
 * Every work_context the given user currently holds membership in, for one company --
 * a person can hold more than one department simultaneously (e.g. Nilkamal-style
 * Production+Quality), so approver-department matching must check set membership, not
 * a single "primary" work_context.
 */
export async function loadApproverWorkContextIds(
  db: DbClient,
  authUserId: string,
  companyId: string,
): Promise<Set<string>> {
  const { data, error } = await db
    .schema("erp_acl")
    .from("user_work_contexts")
    .select("work_context_id")
    .eq("auth_user_id", authUserId)
    .eq("company_id", companyId);

  if (error) {
    throw new Error("APPROVER_WORK_CONTEXT_LOOKUP_FAILED");
  }

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const ids: string[] = [];
  for (const row of rows) {
    const id = row.work_context_id;
    if (typeof id === "string" && id) {
      ids.push(id);
    }
  }

  return new Set(ids);
}

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

export async function loadActiveCompanyWorkContextsByCompany(
  db: DbClient,
  companyIds: string[],
): Promise<Map<string, WorkflowScopeContextRow[]>> {
  const dedupedCompanyIds = [...new Set(companyIds.filter(Boolean))];
  if (dedupedCompanyIds.length === 0) {
    return new Map();
  }

  const { data, error } = await db
    .schema("erp_acl")
    .from("work_contexts")
    .select("work_context_id, company_id, work_context_code, work_context_name, department_id, is_active")
    .in("company_id", dedupedCompanyIds)
    .eq("is_active", true);

  if (error) {
    throw new Error("WORKFLOW_SCOPE_CONTEXT_LOOKUP_FAILED");
  }

  const rows = (data ?? []) as WorkflowScopeContextRow[];
  const byCompany = new Map<string, WorkflowScopeContextRow[]>();

  for (const row of rows) {
    if (!row.company_id) {
      continue;
    }

    const existing = byCompany.get(row.company_id);
    if (existing) {
      existing.push(row);
    } else {
      byCompany.set(row.company_id, [row]);
    }
  }

  return byCompany;
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

function dedupeScopedRows<T extends ScopedRuleRow>(
  rows: T[],
  getIdentityKey: (row: T) => string,
): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];

  for (const row of rows) {
    const key = getIdentityKey(row);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(row);
  }

  return deduped;
}

function normalizeScopeType(scopeType: string | null | undefined): string | null {
  const normalized = String(scopeType ?? "").trim().toUpperCase();
  return normalized || null;
}

function matchesScopeType(
  workflow: WorkflowScopeInput,
  row: ScopedRuleRow,
): boolean {
  const scopeType = normalizeScopeType(row.scope_type);

  if (scopeType === "USER_EXCEPTION") {
    return Boolean(
      row.subject_user_id &&
      workflow.requester_auth_user_id &&
      row.subject_user_id === workflow.requester_auth_user_id,
    );
  }

  // Rank-based escalation (e.g. "if an L2_USER submits, an L1_MANAGER
  // approves") — keys off the CREATOR's own role, not a specific named
  // person or department, so it generalizes to anyone holding that rank.
  if (scopeType === "SUBJECT_ROLE") {
    return Boolean(
      row.subject_role_code &&
      workflow.requester_role_code &&
      row.subject_role_code === workflow.requester_role_code,
    );
  }

  if (scopeType === "WORK_CONTEXT") {
    return Boolean(
      row.subject_work_context_id &&
      workflow.requester_work_context_id &&
      row.subject_work_context_id === workflow.requester_work_context_id,
    );
  }

  if (scopeType === "DEPARTMENT") {
    return Boolean(
      row.subject_work_context_id &&
      workflow.requester_department_work_context_id &&
      row.subject_work_context_id === workflow.requester_department_work_context_id,
    );
  }

  if (scopeType === "COMPANY_WIDE" || scopeType === "DIRECTOR") {
    return row.subject_work_context_id === null && (row.subject_user_id ?? null) === null;
  }

  if (row.subject_user_id) {
    return Boolean(
      workflow.requester_auth_user_id &&
      row.subject_user_id === workflow.requester_auth_user_id,
    );
  }

  if (row.subject_work_context_id === null) {
    return true;
  }

  return (
    row.subject_work_context_id === workflow.requester_work_context_id ||
    row.subject_work_context_id === workflow.requester_department_work_context_id
  );
}

function buildScopePriorityBuckets(workflow: WorkflowScopeInput): string[] {
  const buckets = [
    "USER_EXCEPTION",
    "SUBJECT_ROLE",
    "WORK_CONTEXT",
    "DEPARTMENT",
    "COMPANY_WIDE",
    "DIRECTOR",
    "LEGACY",
  ];

  return buckets;
}

export function pickScopedApproverRules<T extends StageScopedRuleRow>(
  workflow: WorkflowScopeInput,
  approverRows: T[],
): T[] {
  const resourceScopedRows = filterRulesByResource(workflow, approverRows);
  if (resourceScopedRows.length === 0) {
    return [];
  }

  const stages = [...new Set(resourceScopedRows.map((row) => row.approval_stage))].sort(
    (left, right) => left - right,
  );
  const scopeBuckets = buildScopePriorityBuckets(workflow);

  const resolvedRows: T[] = [];

  for (const stage of stages) {
    const stageRows = resourceScopedRows.filter((row) => row.approval_stage === stage);
    const stageMatches: T[] = [];

    for (const bucket of scopeBuckets) {
      const matches = stageRows.filter((row) => {
        const scopeType = normalizeScopeType(row.scope_type);
        if (bucket === "LEGACY") {
          return scopeType === null && matchesScopeType(workflow, row);
        }

        return scopeType === bucket && matchesScopeType(workflow, row);
      });

      stageMatches.push(...matches);
    }

    resolvedRows.push(
      ...dedupeScopedRows(
        stageMatches,
        (row) =>
          [
            row.resource_code ?? "",
            row.action_code ?? "",
            row.subject_work_context_id ?? "",
            row.approval_stage,
            JSON.stringify(row),
          ].join("|"),
      ),
    );
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

  const scopeBuckets = buildScopePriorityBuckets(workflow);
  const resolvedRows: T[] = [];

  for (const bucket of scopeBuckets) {
    const matches = resourceScopedRows.filter((row) => {
      const scopeType = normalizeScopeType(row.scope_type);
      if (bucket === "LEGACY") {
        return scopeType === null && matchesScopeType(workflow, row);
      }

      return scopeType === bucket && matchesScopeType(workflow, row);
    });

    resolvedRows.push(...matches);
  }

  return dedupeScopedRows(
    resolvedRows,
    (row) =>
      [
        row.resource_code ?? "",
        row.action_code ?? "",
        row.subject_work_context_id ?? "",
        JSON.stringify(row),
      ].join("|"),
  );
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
    approverWorkContextIds?: ReadonlySet<string>;
  },
): boolean {
  if (input.requesterAuthUserId === input.authUserId) {
    return false;
  }

  const matchedApproverStages = input.scopedApprovers
    .filter((row) =>
      matchesApprover([row], {
        auth_user_id: input.authUserId,
        roleCode: input.roleCode,
        approverWorkContextIds: input.approverWorkContextIds ?? new Set(),
      })
    )
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
