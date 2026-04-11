import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { getActiveAclVersionIdForCompany } from "../../_shared/acl_runtime.ts";
import type { ContextResolution } from "../../_pipeline/context.ts";
import {
  createWorkflowScopeContextMap,
  isBusinessWorkflowWorkContext,
  isDepartmentWorkContextCode,
  isGeneralOpsWorkContextCode,
  loadActiveCompanyWorkContexts,
  pickScopedApproverRules,
  pickScopedViewerRules as pickScopedViewerRulesByPriority,
  resolveDepartmentWorkflowScopeId,
} from "../../_shared/workflow_scope.ts";

export const LEAVE_RESOURCE_CODES = Object.freeze({
  apply: "HR_LEAVE_APPLY",
  myRequests: "HR_LEAVE_MY_REQUESTS",
  approvalInbox: "HR_LEAVE_APPROVAL_INBOX",
  approvalHistory: "HR_LEAVE_APPROVAL_SCOPE_HISTORY",
  register: "HR_LEAVE_REGISTER",
});

export const OUT_WORK_RESOURCE_CODES = Object.freeze({
  apply: "HR_OUT_WORK_APPLY",
  myRequests: "HR_OUT_WORK_MY_REQUESTS",
  approvalInbox: "HR_OUT_WORK_APPROVAL_INBOX",
  approvalHistory: "HR_OUT_WORK_APPROVAL_SCOPE_HISTORY",
  register: "HR_OUT_WORK_REGISTER",
});

export type HrHandlerContext = {
  context: Extract<ContextResolution, { status: "RESOLVED" }>;
  request_id: string;
  auth_user_id: string;
  roleCode: string;
};

export type ModuleBinding = {
  module_code: string;
  project_id: string;
  approval_required: boolean;
  approval_type: "ANYONE" | "SEQUENTIAL" | "MUST_ALL" | null;
  min_approvers: number;
  max_approvers: number;
  is_active: boolean;
};

export type ApprovalConfig = {
  module_code: string;
  project_id: string;
  approval_required: boolean;
  approval_type: "ANYONE" | "SEQUENTIAL" | "MUST_ALL";
  min_approvers: number;
  max_approvers: number;
};

export type ParentCompanyScope = {
  company_id: string;
  company_code: string | null;
  company_name: string | null;
};

export type WorkflowDecisionRow = {
  request_id: string;
  stage_number: number;
  approver_auth_user_id: string;
  decision: "APPROVED" | "REJECTED";
  decided_at: string;
};

export type ApproverRuleRow = {
  approver_id: string;
  company_id: string;
  module_code: string;
  resource_code: string | null;
  action_code: string | null;
  subject_work_context_id: string | null;
  approval_stage: number;
  approver_role_code: string | null;
  approver_user_id: string | null;
};

export type ViewerRuleRow = {
  viewer_id: string;
  company_id: string;
  module_code: string;
  resource_code: string;
  action_code: "VIEW" | "EXPORT";
  subject_work_context_id: string | null;
  viewer_role_code: string | null;
  viewer_user_id: string | null;
};

export type UserIdentity = {
  auth_user_id: string;
  user_code: string | null;
  name: string | null;
};

export type CompanyIdentity = {
  company_id: string;
  company_code: string | null;
  company_name: string | null;
};

function pickDisplayName(
  rawMetadata: unknown,
  email: string | null | undefined,
): string | null {
  if (rawMetadata && typeof rawMetadata === "object") {
    const metadata = rawMetadata as Record<string, unknown>;
    const candidates = [
      metadata.name,
      metadata.full_name,
      metadata.display_name,
    ];

    for (const candidate of candidates) {
      const normalized = String(candidate ?? "").trim();
      if (normalized) {
        return normalized;
      }
    }
  }

  const normalizedEmail = String(email ?? "").trim();
  return normalizedEmail || null;
}

export function assertHrBusinessContext(
  ctx: HrHandlerContext,
): asserts ctx is HrHandlerContext & {
  context: Extract<ContextResolution, { status: "RESOLVED" }> & {
    isAdmin: false;
    companyId: string;
    workContextId: string;
  };
} {
  if (ctx.context.status !== "RESOLVED" || ctx.context.isAdmin === true) {
    throw new Error("HR_ACL_CONTEXT_REQUIRED");
  }

  if (!ctx.context.companyId || !ctx.context.workContextId) {
    throw new Error("HR_RUNTIME_CONTEXT_MISSING");
  }
}

export function normalizeIsoDate(value: unknown): string {
  const normalized = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error("INVALID_DATE_INPUT");
  }
  return normalized;
}

function isoToUtcDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
}

export function todayIsoInKolkata(): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Calcutta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  return formatter.format(new Date());
}

export function shiftIsoDate(isoDate: string, deltaDays: number): string {
  const date = isoToUtcDate(isoDate);
  date.setUTCDate(date.getUTCDate() + deltaDays);
  return date.toISOString().slice(0, 10);
}

export function calculateInclusiveDays(fromDate: string, toDate: string): number {
  const fromUtc = isoToUtcDate(fromDate);
  const toUtc = isoToUtcDate(toDate);
  const diffMs = toUtc.getTime() - fromUtc.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  return diffDays + 1;
}

export async function getParentCompanyScope(
  authUserId: string,
): Promise<ParentCompanyScope> {
  const { data: parentRow, error: parentError } = await serviceRoleClient
    .schema("erp_map")
    .from("user_parent_companies")
    .select("company_id")
    .eq("auth_user_id", authUserId)
    .maybeSingle();

  if (parentError || !parentRow?.company_id) {
    throw new Error("HR_PARENT_COMPANY_NOT_FOUND");
  }

  const { data: companyRow, error: companyError } = await serviceRoleClient
    .schema("erp_master")
    .from("companies")
    .select("company_code, company_name")
    .eq("id", parentRow.company_id)
    .maybeSingle();

  if (companyError) {
    throw new Error("HR_PARENT_COMPANY_LOOKUP_FAILED");
  }

  return {
    company_id: parentRow.company_id,
    company_code: companyRow?.company_code ?? null,
    company_name: companyRow?.company_name ?? null,
  };
}

export async function getModuleBindingForResource(
  resourceCode: string,
): Promise<ModuleBinding> {
  const { data: resourceMap, error: resourceMapError } = await serviceRoleClient
    .schema("acl")
    .from("module_resource_map")
    .select("module_code")
    .eq("resource_code", resourceCode)
    .maybeSingle();

  if (resourceMapError || !resourceMap?.module_code) {
    throw new Error("HR_RESOURCE_MODULE_NOT_MAPPED");
  }

  const { data: moduleRow, error: moduleError } = await serviceRoleClient
    .schema("acl")
    .from("module_registry")
    .select("module_code, project_id, approval_required, approval_type, min_approvers, max_approvers, is_active")
    .eq("module_code", resourceMap.module_code)
    .maybeSingle();

  if (moduleError || !moduleRow) {
    throw new Error("HR_MODULE_BINDING_NOT_FOUND");
  }

  if (moduleRow.is_active !== true) {
    throw new Error("HR_MODULE_INACTIVE");
  }

  return moduleRow as ModuleBinding;
}

export async function resolveApprovalConfig(
  submitResourceCode: string,
  submitActionCode: "WRITE" | "EDIT" | "DELETE",
): Promise<ApprovalConfig> {
  const moduleBinding = await getModuleBindingForResource(submitResourceCode);

  const { data: policyRow } = await serviceRoleClient
    .schema("acl")
    .from("resource_approval_policy")
    .select("approval_required, approval_type, min_approvers, max_approvers")
    .eq("resource_code", submitResourceCode)
    .eq("action_code", submitActionCode)
    .maybeSingle();

  const approvalRequired = policyRow?.approval_required ?? moduleBinding.approval_required;
  const approvalType = (policyRow?.approval_type ??
    moduleBinding.approval_type ??
    "ANYONE") as "ANYONE" | "SEQUENTIAL" | "MUST_ALL";

  const minApprovers = Number(
    policyRow?.min_approvers ?? moduleBinding.min_approvers ?? 1,
  );
  const maxApprovers = Number(
    policyRow?.max_approvers ?? moduleBinding.max_approvers ?? 3,
  );

  return {
    module_code: moduleBinding.module_code,
    project_id: moduleBinding.project_id,
    approval_required: approvalRequired === true,
    approval_type: approvalType,
    min_approvers: Math.min(3, Math.max(1, minApprovers)),
    max_approvers: Math.min(3, Math.max(1, maxApprovers)),
  };
}

export async function createWorkflowRequest(
  companyId: string,
  requesterAuthUserId: string,
  projectId: string,
  moduleCode: string,
  approvalRequired: boolean,
  approvalType: "ANYONE" | "SEQUENTIAL" | "MUST_ALL",
  approvalResourceCode: string,
  requesterWorkContextId: string | null,
): Promise<{
  request_id: string;
  current_state: "PENDING" | "APPROVED";
}> {
  if (!requesterWorkContextId) {
    throw new Error("WORKFLOW_REQUEST_BUSINESS_CONTEXT_REQUIRED");
  }

  const workContextMap = createWorkflowScopeContextMap(
    await loadActiveCompanyWorkContexts(serviceRoleClient, companyId),
  );
  const requesterWorkContext = workContextMap.get(requesterWorkContextId) ?? null;

  if (!requesterWorkContext) {
    throw new Error("WORKFLOW_REQUEST_BUSINESS_CONTEXT_INVALID");
  }

  if (!isBusinessWorkflowWorkContext(requesterWorkContext)) {
    throw new Error(
      isGeneralOpsWorkContextCode(requesterWorkContext.work_context_code)
        ? "WORKFLOW_REQUEST_GENERAL_CONTEXT_FORBIDDEN"
        : "WORKFLOW_REQUEST_BUSINESS_CONTEXT_INVALID",
    );
  }

  const aclVersionId = await getActiveAclVersionIdForCompany(
    serviceRoleClient,
    companyId,
  );

  const { data, error } = await serviceRoleClient
    .schema("acl")
    .from("workflow_requests")
    .insert({
      company_id: companyId,
      project_id: projectId,
      module_code: moduleCode,
      requester_auth_user_id: requesterAuthUserId,
      acl_version_id: aclVersionId,
      approval_type: approvalType,
      current_state: approvalRequired ? "PENDING" : "APPROVED",
      resource_code: approvalResourceCode,
      action_code: "APPROVE",
      requester_work_context_id: requesterWorkContextId,
      requester_subject_company_id: companyId,
      created_by: requesterAuthUserId,
    })
    .select("request_id, current_state")
    .single();

  if (error || !data?.request_id) {
    throw new Error("HR_WORKFLOW_REQUEST_CREATE_FAILED");
  }

  return {
    request_id: data.request_id,
    current_state: data.current_state as "PENDING" | "APPROVED",
  };
}

export async function deleteWorkflowRequest(requestId: string): Promise<void> {
  await serviceRoleClient
    .schema("acl")
    .from("workflow_requests")
    .delete()
    .eq("request_id", requestId);
}

export async function appendWorkflowEvent(input: {
  request_id: string;
  company_id: string;
  module_code: string;
  event_type: string;
  actor_auth_user_id: string;
  stage_number?: number | null;
  decision?: string | null;
  previous_state?: string | null;
  new_state?: string | null;
}): Promise<void> {
  await serviceRoleClient
    .schema("erp_audit")
    .from("workflow_events")
    .insert({
      request_id: input.request_id,
      company_id: input.company_id,
      module_code: input.module_code,
      event_type: input.event_type,
      stage_number: input.stage_number ?? null,
      decision: input.decision ?? null,
      previous_state: input.previous_state ?? null,
      new_state: input.new_state ?? null,
      actor_auth_user_id: input.actor_auth_user_id,
    });
}

export async function loadWorkflowDecisionMap(
  requestIds: string[],
): Promise<Map<string, WorkflowDecisionRow[]>> {
  const map = new Map<string, WorkflowDecisionRow[]>();

  if (requestIds.length === 0) {
    return map;
  }

  const { data } = await serviceRoleClient
    .schema("acl")
    .from("workflow_decisions")
    .select("request_id, stage_number, approver_auth_user_id, decision, decided_at")
    .in("request_id", requestIds)
    .order("stage_number", { ascending: true })
    .order("decided_at", { ascending: true });

  for (const row of (data ?? []) as WorkflowDecisionRow[]) {
    const bucket = map.get(row.request_id) ?? [];
    bucket.push(row);
    map.set(row.request_id, bucket);
  }

  return map;
}

export async function loadApproverRulesForCompanyModule(
  companyId: string,
  moduleCode: string,
): Promise<ApproverRuleRow[]> {
  const { data } = await serviceRoleClient
    .schema("acl")
    .from("approver_map")
    .select("approver_id, company_id, module_code, resource_code, action_code, subject_work_context_id, approval_stage, approver_role_code, approver_user_id")
    .eq("company_id", companyId)
    .eq("module_code", moduleCode)
    .order("approval_stage", { ascending: true });

  return (data ?? []) as ApproverRuleRow[];
}

export async function loadViewerRulesForCompanyModule(
  companyId: string,
  moduleCode: string,
): Promise<ViewerRuleRow[]> {
  const { data } = await serviceRoleClient
    .schema("acl")
    .from("report_viewer_map")
    .select("viewer_id, company_id, module_code, resource_code, action_code, subject_work_context_id, viewer_role_code, viewer_user_id")
    .eq("company_id", companyId)
    .eq("module_code", moduleCode)
    .order("resource_code", { ascending: true });

  return (data ?? []) as ViewerRuleRow[];
}

export async function loadUserIdentityMap(
  authUserIds: string[],
): Promise<Map<string, UserIdentity>> {
  const identityMap = new Map<string, UserIdentity>();

  if (authUserIds.length === 0) {
    return identityMap;
  }

  const { data: users } = await serviceRoleClient
    .schema("erp_core")
    .from("users")
    .select("auth_user_id, user_code")
    .in("auth_user_id", authUserIds);

  const { data: signupRows } = await serviceRoleClient
    .schema("erp_core")
    .from("signup_requests")
    .select("auth_user_id, name")
    .in("auth_user_id", authUserIds);

  const { data: authRows } = await serviceRoleClient
    .schema("auth")
    .from("users")
    .select("id, email, raw_user_meta_data")
    .in("id", authUserIds);

  const signupNameMap = new Map(
    (signupRows ?? []).map((row) => [row.auth_user_id, row.name ?? null]),
  );
  const authNameMap = new Map(
    (authRows ?? []).map((row) => [
      row.id,
      pickDisplayName(row.raw_user_meta_data, row.email ?? null),
    ]),
  );

  for (const row of (users ?? []) as Array<{ auth_user_id: string; user_code: string | null }>) {
    identityMap.set(row.auth_user_id, {
      auth_user_id: row.auth_user_id,
      user_code: row.user_code ?? null,
      name: signupNameMap.get(row.auth_user_id) ?? authNameMap.get(row.auth_user_id) ?? null,
    });
  }

  for (const row of (signupRows ?? []) as Array<{ auth_user_id: string; name: string | null }>) {
    if (!identityMap.has(row.auth_user_id)) {
      identityMap.set(row.auth_user_id, {
        auth_user_id: row.auth_user_id,
        user_code: null,
        name: row.name ?? authNameMap.get(row.auth_user_id) ?? null,
      });
    }
  }

  for (const [authUserId, authName] of authNameMap.entries()) {
    if (!identityMap.has(authUserId)) {
      identityMap.set(authUserId, {
        auth_user_id: authUserId,
        user_code: null,
        name: authName ?? null,
      });
    }
  }

  return identityMap;
}

export async function loadCompanyIdentityMap(
  companyIds: string[],
): Promise<Map<string, CompanyIdentity>> {
  const companyIdentityMap = new Map<string, CompanyIdentity>();

  const uniqueCompanyIds = [...new Set(companyIds.filter(Boolean))];
  if (uniqueCompanyIds.length === 0) {
    return companyIdentityMap;
  }

  const { data: companyRows } = await serviceRoleClient
    .schema("erp_master")
    .from("companies")
    .select("id, company_code, company_name")
    .in("id", uniqueCompanyIds);

  for (const row of (companyRows ?? []) as Array<{
    id: string;
    company_code: string | null;
    company_name: string | null;
  }>) {
    companyIdentityMap.set(row.id, {
      company_id: row.id,
      company_code: row.company_code ?? null,
      company_name: row.company_name ?? null,
    });
  }

  return companyIdentityMap;
}

export function buildUserDisplay(identity: UserIdentity | null | undefined): string {
  if (!identity) {
    return "Unknown User";
  }

  if (identity.user_code && identity.name) {
    return `${identity.name} | ${identity.user_code}`;
  }

  return identity.name ?? identity.user_code ?? identity.auth_user_id;
}

export function pickScopedApprovers(
  workflow: {
    resource_code?: string | null;
    action_code?: string | null;
    requester_work_context_id?: string | null;
    requester_department_work_context_id?: string | null;
  },
  approverRows: ApproverRuleRow[],
): ApproverRuleRow[] {
  return pickScopedApproverRules(workflow, approverRows);
}

export function isApproverMatch(
  row: ApproverRuleRow,
  authUserId: string,
  roleCode: string,
): boolean {
  if (row.approver_user_id) {
    return row.approver_user_id === authUserId;
  }

  if (row.approver_role_code) {
    return row.approver_role_code === roleCode;
  }

  return false;
}

export function pickScopedViewerRules(
  workflow: {
    resource_code?: string | null;
    action_code?: string | null;
    requester_work_context_id?: string | null;
    requester_department_work_context_id?: string | null;
  },
  viewerRows: ViewerRuleRow[],
  targetAction: "VIEW" | "EXPORT" = "VIEW",
): ViewerRuleRow[] {
  return pickScopedViewerRulesByPriority(workflow, viewerRows, targetAction);
}

export function isViewerMatch(
  row: ViewerRuleRow,
  authUserId: string,
  roleCode: string,
): boolean {
  if (row.viewer_user_id) {
    return row.viewer_user_id === authUserId;
  }

  if (row.viewer_role_code) {
    return row.viewer_role_code === roleCode;
  }

  return false;
}

export function getNextSequentialStage(
  scopedApprovers: ApproverRuleRow[],
  decisions: WorkflowDecisionRow[],
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

export function canRequesterCancel(
  currentState: string,
  decisions: WorkflowDecisionRow[],
): boolean {
  return currentState === "PENDING" && decisions.length === 0;
}

export function isActionableForApprover(input: {
  workflow: {
    approval_type: "ANYONE" | "SEQUENTIAL" | "MUST_ALL";
  };
  scopedApprovers: ApproverRuleRow[];
  decisions: WorkflowDecisionRow[];
  authUserId: string;
  roleCode: string;
}): boolean {
  const matchedApproverStages = input.scopedApprovers
    .filter((row) => isApproverMatch(row, input.authUserId, input.roleCode))
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

  if (input.workflow.approval_type === "SEQUENTIAL") {
    const expectedStage = getNextSequentialStage(input.scopedApprovers, input.decisions);
    return expectedStage !== null && matchedApproverStages.includes(expectedStage);
  }

  return true;
}

type UserScopeWorkContextRow = {
  work_context_id: string;
  company_id: string;
  work_context_code: string;
  work_context_name: string | null;
  department_id: string | null;
};

type UserScopeWorkContextLookupRow = UserScopeWorkContextRow & {
  is_active: boolean;
};

export async function resolveRequesterSubjectWorkContext(input: {
  authUserId: string;
  parentCompanyId: string;
  explicitWorkContextId?: string | null;
}): Promise<UserScopeWorkContextRow> {
  const { data: userRows, error } = await serviceRoleClient
    .schema("erp_acl")
    .from("user_work_contexts")
    .select("work_context_id")
    .eq("auth_user_id", input.authUserId)
    .eq("company_id", input.parentCompanyId);

  if (error) {
    throw new Error("HR_REQUESTER_SCOPE_LOOKUP_FAILED");
  }

  const workContextIds = [...new Set((userRows ?? []).map((row) => row.work_context_id).filter(Boolean))];

  if (workContextIds.length === 0) {
    throw new Error("HR_REQUESTER_SCOPE_NOT_ASSIGNED");
  }

  const companyWorkContexts = await loadActiveCompanyWorkContexts(
    serviceRoleClient,
    input.parentCompanyId,
  );
  const companyWorkContextMap = createWorkflowScopeContextMap(companyWorkContexts);

  const rows = workContextIds
    .map((workContextId) => companyWorkContextMap.get(workContextId) ?? null)
    .filter((row): row is UserScopeWorkContextLookupRow =>
      Boolean(row?.work_context_id && row?.company_id && row?.work_context_code && row?.is_active === true)
    );

  if (rows.length === 0) {
    throw new Error("HR_REQUESTER_SCOPE_NOT_ASSIGNED");
  }

  if (input.explicitWorkContextId) {
    const explicitMatch =
      rows.find((row) => row.work_context_id === input.explicitWorkContextId) ?? null;

    if (!explicitMatch) {
      throw new Error("HR_REQUESTER_SCOPE_INVALID_EXPLICIT_CONTEXT");
    }

    if (!isBusinessWorkflowWorkContext(explicitMatch)) {
      throw new Error("HR_REQUESTER_SCOPE_GENERAL_CONTEXT_FORBIDDEN");
    }

    return explicitMatch;
  }

  const { data: userDepartmentRows, error: userDepartmentError } = await serviceRoleClient
    .schema("erp_map")
    .from("user_departments")
    .select("department_id")
    .eq("auth_user_id", input.authUserId);

  if (userDepartmentError) {
    throw new Error("HR_REQUESTER_SCOPE_DEPARTMENT_LOOKUP_FAILED");
  }

  const userDepartmentIds = [...new Set(
    (userDepartmentRows ?? [])
      .map((row) => String(row.department_id ?? "").trim())
      .filter(Boolean),
  )];

  if (userDepartmentIds.length > 0) {
    const { data: departmentRows, error: departmentError } = await serviceRoleClient
      .schema("erp_master")
      .from("departments")
      .select("id, company_id, status")
      .in("id", userDepartmentIds);

    if (departmentError) {
      throw new Error("HR_REQUESTER_SCOPE_DEPARTMENT_LOOKUP_FAILED");
    }

    const matchedDepartments = (departmentRows ?? []).filter((row) =>
      row.company_id === input.parentCompanyId && row.status === "ACTIVE"
    );

    if (matchedDepartments.length > 1) {
      throw new Error("HR_REQUESTER_SCOPE_SELECTION_REQUIRED");
    }

    if (matchedDepartments.length === 1) {
      const departmentId = matchedDepartments[0].id;
      const departmentContext =
        rows.find((row) =>
          row.department_id === departmentId &&
          isDepartmentWorkContextCode(row.work_context_code)
        ) ?? null;

      if (departmentContext && isBusinessWorkflowWorkContext(departmentContext)) {
        return departmentContext;
      }

      throw new Error("HR_REQUESTER_SCOPE_DEPARTMENT_CONTEXT_MISSING");
    }
  }

  const departmentContexts = rows.filter((row) =>
    row.department_id && isDepartmentWorkContextCode(row.work_context_code)
  );

  if (departmentContexts.length === 1) {
    return departmentContexts[0];
  }

  if (departmentContexts.length > 1) {
    throw new Error("HR_REQUESTER_SCOPE_SELECTION_REQUIRED");
  }

  const singleBusinessContext =
    rows.filter((row) => isBusinessWorkflowWorkContext(row)).length === 1
      ? rows.find((row) => isBusinessWorkflowWorkContext(row)) ?? null
      : null;

  if (singleBusinessContext?.department_id) {
    const derivedDepartmentContextId = resolveDepartmentWorkflowScopeId(
      {
        requester_work_context_id: singleBusinessContext.work_context_id,
      },
      companyWorkContextMap,
    );

    const derivedDepartmentContext = derivedDepartmentContextId
      ? companyWorkContextMap.get(derivedDepartmentContextId) ?? null
      : null;

    if (derivedDepartmentContext && isBusinessWorkflowWorkContext(derivedDepartmentContext)) {
      return derivedDepartmentContext;
    }
  }

  throw new Error("HR_REQUESTER_SCOPE_DEPARTMENT_CONTEXT_REQUIRED");
}
