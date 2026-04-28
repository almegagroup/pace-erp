import { okResponse, errorResponse } from "../response.ts";
import { log } from "../../_lib/logger.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import {
  createWorkflowScopeContextMap,
  loadActiveCompanyWorkContexts,
  resolveDepartmentWorkflowScopeId,
} from "../../_shared/workflow_scope.ts";
import {
  LEAVE_RESOURCE_CODES,
  appendWorkflowEvent,
  assertHrBusinessContext,
  buildUserDisplay,
  calculateInclusiveDays,
  canRequesterCancel,
  computeSandwichLeave,
  createWorkflowRequest,
  deleteWorkflowRequest,
  ensureNoDuplicateLeaveRequest,
  generateDateRange,
  getModuleBindingForResource,
  getParentCompanyScope,
  isActionableForApprover,
  isApproverMatch,
  loadApproverRulesForCompanyModule,
  loadCompanyIdentityMap,
  loadViewerRulesForCompanyModule,
  loadUserIdentityMap,
  loadWorkflowDecisionMap,
  normalizeIsoDate,
  pickScopedApprovers,
  pickScopedViewerRules,
  resolveApprovalConfig,
  resolveRequesterSubjectWorkContext,
  shiftIsoDate,
  todayIsoInKolkata,
  type HrHandlerContext,
  type WorkflowDecisionRow,
  isViewerMatch,
} from "./shared.ts";

type LeaveRequestRow = {
  leave_request_id: string;
  workflow_request_id: string;
  requester_auth_user_id: string;
  parent_company_id: string;
  leave_type_id: string;
  applied_by_auth_user_id: string | null;
  from_date: string;
  to_date: string;
  total_days: number;
  effective_leave_days: number | null;
  reason: string;
  cancelled_at: string | null;
  cancelled_by: string | null;
  created_at: string;
};

type WorkflowRequestRow = {
  request_id: string;
  company_id: string;
  requester_auth_user_id: string;
  requester_work_context_id: string | null;
  module_code: string;
  approval_type: "ANYONE" | "SEQUENTIAL" | "MUST_ALL";
  current_state: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  resource_code: string | null;
  action_code: string | null;
  created_at: string;
};

type LeaveCaseRow = {
  leave_request_id: string;
  workflow_request_id: string;
  requester_auth_user_id: string;
  requester_display: string;
  requester_work_context_id: string | null;
  requester_department_work_context_id: string | null;
  requester_work_context_code: string | null;
  requester_work_context_name: string | null;
  department_name: string | null;
  department_code: string | null;
  parent_company_id: string;
  parent_company_code: string | null;
  parent_company_name: string | null;
  from_date: string;
  to_date: string;
  total_days: number;
  effective_leave_days: number | null;
  reason: string;
  created_at: string;
  current_state: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  approval_type: "ANYONE" | "SEQUENTIAL" | "MUST_ALL";
  decision_count: number;
  can_cancel: boolean;
  decision_history: ReturnType<typeof buildDecisionHistory>;
  resource_code: string | null;
  action_code: string | null;
  module_code: string;
  leave_type_id: string;
  leave_type_code: string | null;
  leave_type_name: string | null;
  applied_by_auth_user_id: string | null;
  applied_by_display: string | null;
};

function buildDecisionHistory(
  requestId: string,
  decisionMap: Map<string, WorkflowDecisionRow[]>,
  userIdentityMap: Map<string, { auth_user_id: string; user_code: string | null; name: string | null }>,
) {
  return (decisionMap.get(requestId) ?? []).map((decision) => ({
    stage_number: decision.stage_number,
    decision: decision.decision,
    decided_at: decision.decided_at,
    approver_auth_user_id: decision.approver_auth_user_id,
    approver_display: buildUserDisplay(
      userIdentityMap.get(decision.approver_auth_user_id) ?? null,
    ),
  }));
}

async function loadLeaveRows(filters: {
  requesterAuthUserId?: string;
  parentCompanyId?: string;
  parentCompanyIds?: string[];
  fromDate?: string;
  toDate?: string;
}): Promise<LeaveRequestRow[]> {
  let query = serviceRoleClient
    .schema("erp_hr")
    .from("leave_requests")
    .select("leave_request_id, workflow_request_id, requester_auth_user_id, parent_company_id, leave_type_id, applied_by_auth_user_id, from_date, to_date, total_days, effective_leave_days, reason, cancelled_at, cancelled_by, created_at")
    .order("created_at", { ascending: false });

  if (filters.requesterAuthUserId) {
    query = query.eq("requester_auth_user_id", filters.requesterAuthUserId);
  }

  if (filters.parentCompanyId) {
    query = query.eq("parent_company_id", filters.parentCompanyId);
  }

  if (Array.isArray(filters.parentCompanyIds) && filters.parentCompanyIds.length > 0) {
    query = query.in("parent_company_id", filters.parentCompanyIds);
  }

  if (filters.fromDate && filters.toDate) {
    query = query.lte("from_date", filters.toDate).gte("to_date", filters.fromDate);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error("LEAVE_REQUEST_LIST_FAILED");
  }

  return (data ?? []) as LeaveRequestRow[];
}

async function loadWorkflowMap(
  requestIds: string[],
): Promise<Map<string, WorkflowRequestRow>> {
  const workflowMap = new Map<string, WorkflowRequestRow>();

  if (requestIds.length === 0) {
    return workflowMap;
  }

  const { data, error } = await serviceRoleClient
    .schema("acl")
    .from("workflow_requests")
    .select("request_id, company_id, requester_auth_user_id, requester_work_context_id, module_code, approval_type, current_state, resource_code, action_code, created_at")
    .in("request_id", requestIds);

  if (error) {
    throw new Error("LEAVE_WORKFLOW_LOOKUP_FAILED");
  }

  for (const row of (data ?? []) as WorkflowRequestRow[]) {
    workflowMap.set(row.request_id, row);
  }

  return workflowMap;
}

async function loadLeaveTypeMap(
  leaveTypeIds: string[],
): Promise<Map<string, { type_code: string; type_name: string }>> {
  const map = new Map<string, { type_code: string; type_name: string }>();
  const ids = [...new Set(leaveTypeIds.filter(Boolean))];
  if (ids.length === 0) return map;

  const { data } = await serviceRoleClient
    .schema("erp_hr")
    .from("leave_types")
    .select("leave_type_id, type_code, type_name")
    .in("leave_type_id", ids);

  for (const row of (data ?? []) as Array<{
    leave_type_id: string;
    type_code: string;
    type_name: string;
  }>) {
    map.set(row.leave_type_id, {
      type_code: row.type_code,
      type_name: row.type_name,
    });
  }
  return map;
}

async function validateLeaveTypeForCompany(
  leaveTypeId: string,
  companyId: string,
): Promise<{ type_code: string; type_name: string } | null> {
  const { data } = await serviceRoleClient
    .schema("erp_hr")
    .from("leave_types")
    .select("leave_type_id, type_code, type_name")
    .eq("leave_type_id", leaveTypeId)
    .eq("company_id", companyId)
    .eq("is_active", true)
    .maybeSingle();

  if (!data) return null;
  return { type_code: data.type_code, type_name: data.type_name };
}

async function buildLeaveCases(rows: LeaveRequestRow[]) {
  const workflowRequestIds = rows.map((row) => row.workflow_request_id);
  const workflowMap = await loadWorkflowMap(workflowRequestIds);
  const decisionMap = await loadWorkflowDecisionMap(workflowRequestIds);

  const actorIds = new Set<string>();
  for (const row of rows) {
    actorIds.add(row.requester_auth_user_id);
    if (row.applied_by_auth_user_id) actorIds.add(row.applied_by_auth_user_id);
  }
  for (const decisions of decisionMap.values()) {
    for (const decision of decisions) {
      actorIds.add(decision.approver_auth_user_id);
    }
  }

  const userIdentityMap = await loadUserIdentityMap([...actorIds]);
  const leaveTypeMap = await loadLeaveTypeMap(
    rows.map((row) => row.leave_type_id).filter(Boolean),
  );
  const companyIdentityMap = await loadCompanyIdentityMap(
    rows.map((row) => row.parent_company_id),
  );
  const companyIds = [...new Set(rows.map((row) => row.parent_company_id).filter(Boolean))];
  const companyWorkContextMaps = new Map<string, ReturnType<typeof createWorkflowScopeContextMap>>();

  for (const companyId of companyIds) {
    companyWorkContextMaps.set(
      companyId,
      createWorkflowScopeContextMap(
        await loadActiveCompanyWorkContexts(serviceRoleClient, companyId),
      ),
    );
  }

  const cases: LeaveCaseRow[] = [];

  for (const row of rows) {
    const workflow = workflowMap.get(row.workflow_request_id);
    if (!workflow) {
      continue;
    }

    const decisions = decisionMap.get(row.workflow_request_id) ?? [];
    const companyIdentity = companyIdentityMap.get(row.parent_company_id) ?? null;
    const companyWorkContextMap =
      companyWorkContextMaps.get(row.parent_company_id) ?? new Map();
    const requesterDepartmentWorkContextId = resolveDepartmentWorkflowScopeId(
      {
        requester_work_context_id: workflow.requester_work_context_id ?? null,
      },
      companyWorkContextMap,
    );
    const requesterWorkContext = workflow.requester_work_context_id
      ? companyWorkContextMap.get(workflow.requester_work_context_id) ?? null
      : null;
    const departmentWorkContext = requesterDepartmentWorkContextId
      ? companyWorkContextMap.get(requesterDepartmentWorkContextId) ?? null
      : null;

    cases.push({
      leave_request_id: row.leave_request_id,
      workflow_request_id: row.workflow_request_id,
      requester_auth_user_id: row.requester_auth_user_id,
      requester_display: buildUserDisplay(
        userIdentityMap.get(row.requester_auth_user_id) ?? null,
      ),
      requester_work_context_id: workflow.requester_work_context_id ?? null,
      requester_department_work_context_id: requesterDepartmentWorkContextId,
      requester_work_context_code: requesterWorkContext?.work_context_code ?? null,
      requester_work_context_name: requesterWorkContext?.work_context_name ?? null,
      department_name: departmentWorkContext?.work_context_name ?? null,
      department_code: departmentWorkContext?.work_context_code ?? null,
      parent_company_id: row.parent_company_id,
      parent_company_code: companyIdentity?.company_code ?? null,
      parent_company_name: companyIdentity?.company_name ?? null,
      from_date: row.from_date,
      to_date: row.to_date,
      total_days: row.total_days,
      effective_leave_days: row.effective_leave_days ?? null,
      reason: row.reason,
      created_at: workflow.created_at ?? row.created_at,
      current_state: workflow.current_state,
      approval_type: workflow.approval_type,
      decision_count: decisions.length,
      can_cancel: canRequesterCancel(workflow.current_state, decisions),
      decision_history: buildDecisionHistory(
        row.workflow_request_id,
        decisionMap,
        userIdentityMap,
      ),
      resource_code: workflow.resource_code,
      action_code: workflow.action_code,
      module_code: workflow.module_code,
      leave_type_id: row.leave_type_id,
      leave_type_code: leaveTypeMap.get(row.leave_type_id)?.type_code ?? null,
      leave_type_name: leaveTypeMap.get(row.leave_type_id)?.type_name ?? null,
      applied_by_auth_user_id: row.applied_by_auth_user_id ?? null,
      applied_by_display: row.applied_by_auth_user_id
        ? buildUserDisplay(userIdentityMap.get(row.applied_by_auth_user_id) ?? null)
        : null,
    });
  }

  return cases;
}

async function loadAccessibleRegisterCompanyIds(authUserId: string): Promise<string[]> {
  const { data, error } = await serviceRoleClient
    .schema("erp_map")
    .from("user_companies")
    .select("company_id")
    .eq("auth_user_id", authUserId);

  if (error) {
    throw new Error("LEAVE_REGISTER_COMPANY_SCOPE_FAILED");
  }

  return [...new Set((data ?? []).map((row) => row.company_id).filter(Boolean))];
}

export async function createLeaveRequestHandler(
  req: Request,
  ctx: HrHandlerContext,
): Promise<Response> {
  const routeKey = "POST:/api/hr/leave/request";

  try {
    assertHrBusinessContext(ctx);

    const body = await req.json().catch(() => ({}));
    const fromDate = normalizeIsoDate(body?.from_date);
    const toDate = normalizeIsoDate(body?.to_date);
    const reason = String(body?.reason ?? "").trim();
    const requestedCompanyId =
      String(body?.parent_company_id ?? ctx.context.companyId ?? "").trim() || null;
    const leaveTypeIdRaw = String(body?.leave_type_id ?? "").trim();

    if (!leaveTypeIdRaw) {
      return errorResponse(
        "LEAVE_TYPE_REQUIRED",
        "leave_type_id required",
        ctx.request_id,
        "NONE",
        400,
        { gateId: "HR.LEAVE", routeKey, decisionTrace: "LEAVE_TYPE_REQUIRED" },
      );
    }

    if (!reason) {
      return errorResponse(
        "LEAVE_REASON_REQUIRED",
        "leave reason required",
        ctx.request_id,
        "NONE",
        403,
        {
          gateId: "HR.LEAVE",
          routeKey,
          decisionTrace: "LEAVE_REASON_REQUIRED",
        },
      );
    }

    if (toDate < fromDate) {
      return errorResponse(
        "LEAVE_DATE_RANGE_INVALID",
        "to date must be after from date",
        ctx.request_id,
        "NONE",
        403,
        {
          gateId: "HR.LEAVE",
          routeKey,
          decisionTrace: "LEAVE_DATE_RANGE_INVALID",
        },
      );
    }

    const todayIso = todayIsoInKolkata();
    const earliestBackdate = shiftIsoDate(todayIso, -3);

    if (fromDate < earliestBackdate) {
      return errorResponse(
        "LEAVE_BACKDATE_LIMIT_EXCEEDED",
        "backdate limit exceeded",
        ctx.request_id,
        "NONE",
        403,
        {
          gateId: "HR.LEAVE",
          routeKey,
          decisionTrace: "LEAVE_BACKDATE_LIMIT_EXCEEDED",
        },
      );
    }

    const parentCompany = await getParentCompanyScope(ctx.auth_user_id, requestedCompanyId);

    // Sandwich leave policy — block if no working days; compute effective_leave_days
    const sandwichResult = await computeSandwichLeave(
      parentCompany.company_id,
      fromDate,
      toDate,
    );
    if (sandwichResult.isBlocked) {
      return errorResponse(
        "LEAVE_NO_WORKING_DAYS",
        sandwichResult.blockedReason ?? "Your selected date range contains no working days.",
        ctx.request_id,
        "NONE",
        400,
        { gateId: "HR.LEAVE", routeKey, decisionTrace: "LEAVE_NO_WORKING_DAYS" },
      );
    }
    const totalDays = sandwichResult.totalDays;
    const effectiveLeaveDays = sandwichResult.effectiveLeaveDays;

    // Validate leave_type_id belongs to this company and is active
    const leaveType = await validateLeaveTypeForCompany(leaveTypeIdRaw, parentCompany.company_id);
    if (!leaveType) {
      return errorResponse(
        "LEAVE_TYPE_INVALID",
        "leave type not found or not active for this company",
        ctx.request_id,
        "NONE",
        400,
        { gateId: "HR.LEAVE", routeKey, decisionTrace: "LEAVE_TYPE_INVALID" },
      );
    }

    const explicitRequesterWorkContextId =
      String(body?.requester_work_context_id ?? "").trim() || null;
    const requesterWorkContext = await resolveRequesterSubjectWorkContext({
      authUserId: ctx.auth_user_id,
      parentCompanyId: parentCompany.company_id,
      explicitWorkContextId: explicitRequesterWorkContextId,
    });
    const approvalConfig = await resolveApprovalConfig(
      LEAVE_RESOURCE_CODES.apply,
      "WRITE",
    );

    await ensureNoDuplicateLeaveRequest({
      requesterAuthUserId: ctx.auth_user_id,
      parentCompanyId: parentCompany.company_id,
      fromDate,
      toDate,
    });

    const workflow = await createWorkflowRequest(
      parentCompany.company_id,
      ctx.auth_user_id,
      approvalConfig.project_id,
      approvalConfig.module_code,
      approvalConfig.approval_required,
      approvalConfig.approval_type,
      LEAVE_RESOURCE_CODES.approvalInbox,
      requesterWorkContext.work_context_id,
    );

    const { data: leaveRow, error: leaveError } = await serviceRoleClient
      .schema("erp_hr")
      .from("leave_requests")
      .insert({
        workflow_request_id: workflow.request_id,
        requester_auth_user_id: ctx.auth_user_id,
        parent_company_id: parentCompany.company_id,
        leave_type_id: leaveTypeIdRaw,
        applied_by_auth_user_id: null,
        requester_work_context_id: requesterWorkContext.work_context_id,
        from_date: fromDate,
        to_date: toDate,
        total_days: totalDays,
        effective_leave_days: effectiveLeaveDays,
        reason,
        created_by: ctx.auth_user_id,
      })
      .select("leave_request_id, workflow_request_id, requester_auth_user_id, parent_company_id, leave_type_id, applied_by_auth_user_id, from_date, to_date, total_days, effective_leave_days, reason, cancelled_at, cancelled_by, created_at")
      .single();

    if (leaveError || !leaveRow) {
      await deleteWorkflowRequest(workflow.request_id);
      throw new Error(
        `LEAVE_REQUEST_CREATE_FAILED:${leaveError?.message ?? "unknown_insert_failure"}`,
      );
    }

    await appendWorkflowEvent({
      request_id: workflow.request_id,
      company_id: parentCompany.company_id,
      module_code: approvalConfig.module_code,
      event_type: "CREATE",
      actor_auth_user_id: ctx.auth_user_id,
      previous_state: null,
      new_state: workflow.current_state,
    });

    log({
      level: "INFO",
      request_id: ctx.request_id,
      gate_id: "HR.LEAVE",
      route_key: routeKey,
      event: "LEAVE_REQUEST_CREATED",
      actor: ctx.auth_user_id,
      meta: {
        leave_request_id: leaveRow.leave_request_id,
        workflow_request_id: workflow.request_id,
        company_id: parentCompany.company_id,
        module_code: approvalConfig.module_code,
        current_state: workflow.current_state,
      },
    });

    return okResponse(
      {
        leave_request: {
          ...leaveRow,
          current_state: workflow.current_state,
          approval_type: approvalConfig.approval_type,
          parent_company_code: parentCompany.company_code,
          parent_company_name: parentCompany.company_name,
          requester_work_context_id: requesterWorkContext.work_context_id,
          requester_work_context_code: requesterWorkContext.work_context_code ?? null,
          requester_work_context_name: requesterWorkContext.work_context_name ?? null,
          leave_type_code: leaveType.type_code,
          leave_type_name: leaveType.type_name,
          sandwich_days: sandwichResult.sandwichDays,
        },
      },
      ctx.request_id,
    );
  } catch (err) {
    log({
      level: "ERROR",
      request_id: ctx.request_id,
      gate_id: "HR.LEAVE",
      route_key: routeKey,
      event: "LEAVE_REQUEST_CREATE_EXCEPTION",
      actor: ctx.auth_user_id,
      meta: {
        error: (err as Error).message,
      },
    });

    return errorResponse(
      (err as Error).message === "LEAVE_DUPLICATE_DATE_RANGE"
        ? "Duplicate leave request already exists for the same date range."
        : (err as Error).message || "LEAVE_REQUEST_CREATE_EXCEPTION",
      (err as Error).message === "LEAVE_DUPLICATE_DATE_RANGE"
        ? "Duplicate leave request already exists for the same date range."
        : "leave request create exception",
      ctx.request_id,
      "NONE",
      (err as Error).message === "LEAVE_DUPLICATE_DATE_RANGE" ? 409 : 403,
      {
        gateId: "HR.LEAVE",
        routeKey,
        decisionTrace: (err as Error).message || "LEAVE_REQUEST_CREATE_EXCEPTION",
      },
    );
  }
}

export async function updateLeaveRequestHandler(
  req: Request,
  ctx: HrHandlerContext,
): Promise<Response> {
  const routeKey = "POST:/api/hr/leave/update";

  try {
    assertHrBusinessContext(ctx);

    const body = await req.json().catch(() => ({}));
    const leaveRequestId = String(body?.leave_request_id ?? "").trim();

    if (!leaveRequestId) {
      return errorResponse(
        "LEAVE_UPDATE_ID_REQUIRED",
        "leave_request_id required",
        ctx.request_id,
      );
    }

    // -----------------------------------------------------------------------
    // Branch A — Approver leave type override (body.approver_type_override = true)
    // Approver corrects the leave_type before committing their decision.
    // Only allowed while request is PENDING. Once decided, type is immutable.
    // -----------------------------------------------------------------------
    if (body?.approver_type_override === true) {
      const newLeaveTypeId = String(body?.leave_type_id ?? "").trim();
      if (!newLeaveTypeId) {
        return errorResponse(
          "LEAVE_TYPE_REQUIRED",
          "leave_type_id required for approver type override",
          ctx.request_id,
          "NONE",
          400,
        );
      }

      const { data: leaveRowA, error: leaveErrorA } = await serviceRoleClient
        .schema("erp_hr")
        .from("leave_requests")
        .select("leave_request_id, workflow_request_id, requester_auth_user_id, parent_company_id, leave_type_id")
        .eq("leave_request_id", leaveRequestId)
        .maybeSingle();

      if (leaveErrorA || !leaveRowA) {
        return errorResponse("LEAVE_REQUEST_NOT_FOUND", "leave request not found", ctx.request_id);
      }

      // Requester cannot use the approver override path on their own request
      if (leaveRowA.requester_auth_user_id === ctx.auth_user_id) {
        return errorResponse(
          "LEAVE_TYPE_OVERRIDE_SELF_FORBIDDEN",
          "use the regular edit endpoint to change your own request's leave type",
          ctx.request_id,
          "NONE",
          403,
        );
      }

      const { data: workflowA, error: workflowErrorA } = await serviceRoleClient
        .schema("acl")
        .from("workflow_requests")
        .select("request_id, module_code, current_state, approval_type, resource_code, action_code, requester_work_context_id")
        .eq("request_id", leaveRowA.workflow_request_id)
        .maybeSingle();

      if (workflowErrorA || !workflowA) {
        return errorResponse("LEAVE_WORKFLOW_NOT_FOUND", "workflow request not found", ctx.request_id);
      }

      if (workflowA.current_state !== "PENDING") {
        return errorResponse(
          "LEAVE_TYPE_OVERRIDE_NOT_ALLOWED",
          "leave type can only be changed while the request is PENDING",
          ctx.request_id,
          "NONE",
          403,
        );
      }

      // Verify caller is an actionable approver for this request
      const moduleBindingA = await getModuleBindingForResource(LEAVE_RESOURCE_CODES.apply);
      const approverRowsA = await loadApproverRulesForCompanyModule(
        leaveRowA.parent_company_id,
        moduleBindingA.module_code,
      );
      const decisionMapA = await loadWorkflowDecisionMap([leaveRowA.workflow_request_id]);
      const decisionsA = decisionMapA.get(leaveRowA.workflow_request_id) ?? [];

      const companyWorkContextMapA = createWorkflowScopeContextMap(
        await loadActiveCompanyWorkContexts(serviceRoleClient, leaveRowA.parent_company_id),
      );
      const requesterDeptContextIdA = resolveDepartmentWorkflowScopeId(
        { requester_work_context_id: workflowA.requester_work_context_id ?? null },
        companyWorkContextMapA,
      );
      const scopedApproversA = pickScopedApprovers(
        {
          resource_code: workflowA.resource_code,
          action_code: workflowA.action_code,
          requester_auth_user_id: leaveRowA.requester_auth_user_id,
          requester_work_context_id: workflowA.requester_work_context_id ?? null,
          requester_department_work_context_id: requesterDeptContextIdA,
        },
        approverRowsA,
      );
      const isApproverA = isActionableForApprover({
        workflow: { approval_type: workflowA.approval_type },
        requesterAuthUserId: leaveRowA.requester_auth_user_id,
        scopedApprovers: scopedApproversA,
        decisions: decisionsA,
        authUserId: ctx.auth_user_id,
        roleCode: ctx.roleCode,
      });

      if (!isApproverA) {
        return errorResponse(
          "LEAVE_TYPE_OVERRIDE_FORBIDDEN",
          "only the actionable approver can change the leave type",
          ctx.request_id,
          "NONE",
          403,
        );
      }

      // Validate new leave_type_id belongs to this company and is active
      const leaveTypeA = await validateLeaveTypeForCompany(newLeaveTypeId, leaveRowA.parent_company_id);
      if (!leaveTypeA) {
        return errorResponse(
          "LEAVE_TYPE_INVALID",
          "leave type not found or not active for this company",
          ctx.request_id,
          "NONE",
          400,
        );
      }

      const previousLeaveTypeId = leaveRowA.leave_type_id;

      const { error: overrideUpdateError } = await serviceRoleClient
        .schema("erp_hr")
        .from("leave_requests")
        .update({ leave_type_id: newLeaveTypeId })
        .eq("leave_request_id", leaveRequestId);

      if (overrideUpdateError) {
        throw new Error("LEAVE_TYPE_OVERRIDE_UPDATE_FAILED");
      }

      await appendWorkflowEvent({
        request_id: leaveRowA.workflow_request_id,
        company_id: leaveRowA.parent_company_id,
        module_code: workflowA.module_code,
        event_type: "LEAVE_TYPE_CHANGED",
        actor_auth_user_id: ctx.auth_user_id,
        previous_state: previousLeaveTypeId,
        new_state: newLeaveTypeId,
      });

      return okResponse(
        {
          leave_request_id: leaveRequestId,
          leave_type_id: newLeaveTypeId,
          leave_type_code: leaveTypeA.type_code,
          leave_type_name: leaveTypeA.type_name,
        },
        ctx.request_id,
      );
    }

    // -----------------------------------------------------------------------
    // Branch B — Requester edits their own request (dates, reason, leave_type)
    // Only allowed while PENDING with 0 decisions.
    // -----------------------------------------------------------------------
    const fromDate = normalizeIsoDate(body?.from_date);
    const toDate = normalizeIsoDate(body?.to_date);
    const reason = String(body?.reason ?? "").trim();
    const newLeaveTypeIdB = String(body?.leave_type_id ?? "").trim() || null;

    if (!reason) {
      return errorResponse(
        "LEAVE_REASON_REQUIRED",
        "leave reason required",
        ctx.request_id,
      );
    }

    if (toDate < fromDate) {
      return errorResponse(
        "LEAVE_DATE_RANGE_INVALID",
        "to_date cannot be before from_date",
        ctx.request_id,
      );
    }

    const todayIso = todayIsoInKolkata();
    const earliestBackdate = shiftIsoDate(todayIso, -3);

    if (fromDate < earliestBackdate) {
      return errorResponse(
        "LEAVE_BACKDATE_LIMIT_EXCEEDED",
        "backdate limit exceeded",
        ctx.request_id,
      );
    }

    const { data: leaveRow, error: leaveError } = await serviceRoleClient
      .schema("erp_hr")
      .from("leave_requests")
      .select("leave_request_id, workflow_request_id, requester_auth_user_id, parent_company_id, leave_type_id")
      .eq("leave_request_id", leaveRequestId)
      .maybeSingle();

    if (leaveError || !leaveRow) {
      return errorResponse(
        "LEAVE_REQUEST_NOT_FOUND",
        "leave request not found",
        ctx.request_id,
      );
    }

    if (leaveRow.requester_auth_user_id !== ctx.auth_user_id) {
      return errorResponse(
        "LEAVE_UPDATE_FORBIDDEN",
        "user cannot edit this request",
        ctx.request_id,
      );
    }

    const { data: workflow, error: workflowError } = await serviceRoleClient
      .schema("acl")
      .from("workflow_requests")
      .select("request_id, module_code, current_state")
      .eq("request_id", leaveRow.workflow_request_id)
      .maybeSingle();

    if (workflowError || !workflow) {
      return errorResponse(
        "LEAVE_WORKFLOW_NOT_FOUND",
        "workflow request not found",
        ctx.request_id,
      );
    }

    const decisionMap = await loadWorkflowDecisionMap([leaveRow.workflow_request_id]);
    const decisions = decisionMap.get(leaveRow.workflow_request_id) ?? [];

    if (!canRequesterCancel(workflow.current_state, decisions)) {
      return errorResponse(
        "LEAVE_EDIT_NOT_ALLOWED",
        "leave request cannot be edited anymore",
        ctx.request_id,
      );
    }

    // Validate new leave_type_id if the requester is changing it
    let resolvedLeaveTypeId = leaveRow.leave_type_id;
    if (newLeaveTypeIdB && newLeaveTypeIdB !== leaveRow.leave_type_id) {
      const leaveTypeB = await validateLeaveTypeForCompany(newLeaveTypeIdB, leaveRow.parent_company_id);
      if (!leaveTypeB) {
        return errorResponse(
          "LEAVE_TYPE_INVALID",
          "leave type not found or not active for this company",
          ctx.request_id,
          "NONE",
          400,
        );
      }
      resolvedLeaveTypeId = newLeaveTypeIdB;
    }

    await ensureNoDuplicateLeaveRequest({
      requesterAuthUserId: ctx.auth_user_id,
      parentCompanyId: leaveRow.parent_company_id,
      fromDate,
      toDate,
      excludeLeaveRequestId: leaveRequestId,
    });

    // Recompute sandwich (dates may have changed)
    const sandwichResultB = await computeSandwichLeave(
      leaveRow.parent_company_id,
      fromDate,
      toDate,
    );
    if (sandwichResultB.isBlocked) {
      return errorResponse(
        "LEAVE_NO_WORKING_DAYS",
        sandwichResultB.blockedReason ?? "Your selected date range contains no working days.",
        ctx.request_id,
        "NONE",
        400,
      );
    }
    const totalDays = sandwichResultB.totalDays;

    const { data: updatedLeaveRow, error: updateError } = await serviceRoleClient
      .schema("erp_hr")
      .from("leave_requests")
      .update({
        from_date: fromDate,
        to_date: toDate,
        total_days: totalDays,
        effective_leave_days: sandwichResultB.effectiveLeaveDays,
        reason,
        leave_type_id: resolvedLeaveTypeId,
      })
      .eq("leave_request_id", leaveRequestId)
      .select("leave_request_id, workflow_request_id, requester_auth_user_id, parent_company_id, leave_type_id, applied_by_auth_user_id, from_date, to_date, total_days, effective_leave_days, reason, cancelled_at, cancelled_by, created_at")
      .single();

    if (updateError || !updatedLeaveRow) {
      throw new Error("LEAVE_REQUEST_UPDATE_FAILED");
    }

    await appendWorkflowEvent({
      request_id: leaveRow.workflow_request_id,
      company_id: leaveRow.parent_company_id,
      module_code: workflow.module_code,
      event_type: "UPDATE",
      actor_auth_user_id: ctx.auth_user_id,
      previous_state: workflow.current_state,
      new_state: workflow.current_state,
    });

    return okResponse(
      {
        leave_request: {
          ...updatedLeaveRow,
          current_state: workflow.current_state,
        },
      },
      ctx.request_id,
    );
  } catch (err) {
    return errorResponse(
      (err as Error).message === "LEAVE_DUPLICATE_DATE_RANGE"
        ? "Duplicate leave request already exists for the same date range."
        : (err as Error).message || "LEAVE_UPDATE_EXCEPTION",
      (err as Error).message === "LEAVE_DUPLICATE_DATE_RANGE"
        ? "Duplicate leave request already exists for the same date range."
        : "leave update exception",
      ctx.request_id,
      "NONE",
      (err as Error).message === "LEAVE_DUPLICATE_DATE_RANGE" ? 409 : 403,
      {
        gateId: "HR.LEAVE",
        routeKey,
        decisionTrace: (err as Error).message || "LEAVE_UPDATE_EXCEPTION",
      },
    );
  }
}

export async function listMyLeaveRequestsHandler(
  _req: Request,
  ctx: HrHandlerContext,
): Promise<Response> {
  try {
    assertHrBusinessContext(ctx);

    const rows = await loadLeaveRows({
      requesterAuthUserId: ctx.auth_user_id,
    });

    const cases = await buildLeaveCases(rows);

    return okResponse(
      {
        requests: cases,
      },
      ctx.request_id,
    );
  } catch (err) {
    return errorResponse(
      (err as Error).message || "LEAVE_MY_REQUESTS_EXCEPTION",
      "leave my requests exception",
      ctx.request_id,
    );
  }
}

export async function cancelLeaveRequestHandler(
  req: Request,
  ctx: HrHandlerContext,
): Promise<Response> {
  const routeKey = "POST:/api/hr/leave/cancel";

  try {
    assertHrBusinessContext(ctx);

    const body = await req.json().catch(() => ({}));
    const leaveRequestId = String(body?.leave_request_id ?? "").trim();

    if (!leaveRequestId) {
      return errorResponse(
        "LEAVE_CANCEL_ID_REQUIRED",
        "leave_request_id required",
        ctx.request_id,
      );
    }

    const { data: leaveRow, error: leaveError } = await serviceRoleClient
      .schema("erp_hr")
      .from("leave_requests")
      .select("leave_request_id, workflow_request_id, requester_auth_user_id, parent_company_id")
      .eq("leave_request_id", leaveRequestId)
      .maybeSingle();

    if (leaveError || !leaveRow) {
      return errorResponse(
        "LEAVE_REQUEST_NOT_FOUND",
        "leave request not found",
        ctx.request_id,
      );
    }

    if (leaveRow.requester_auth_user_id !== ctx.auth_user_id) {
      return errorResponse(
        "LEAVE_CANCEL_FORBIDDEN",
        "user cannot cancel this request",
        ctx.request_id,
      );
    }

    const { data: workflow, error: workflowError } = await serviceRoleClient
      .schema("acl")
      .from("workflow_requests")
      .select("request_id, module_code, current_state")
      .eq("request_id", leaveRow.workflow_request_id)
      .maybeSingle();

    if (workflowError || !workflow) {
      return errorResponse(
        "LEAVE_WORKFLOW_NOT_FOUND",
        "workflow request not found",
        ctx.request_id,
      );
    }

    const decisionMap = await loadWorkflowDecisionMap([leaveRow.workflow_request_id]);
    const decisions = decisionMap.get(leaveRow.workflow_request_id) ?? [];

    if (!canRequesterCancel(workflow.current_state, decisions)) {
      return errorResponse(
        "LEAVE_CANCEL_NOT_ALLOWED",
        "leave request cannot be cancelled anymore",
        ctx.request_id,
      );
    }

    // Capture previous state before mutation — needed for day record cleanup
    const previousState = workflow.current_state;

    const { error: workflowUpdateError } = await serviceRoleClient
      .schema("acl")
      .from("workflow_requests")
      .update({
        current_state: "CANCELLED",
      })
      .eq("request_id", leaveRow.workflow_request_id);

    if (workflowUpdateError) {
      throw new Error("LEAVE_CANCEL_WORKFLOW_UPDATE_FAILED");
    }

    const { error: leaveUpdateError } = await serviceRoleClient
      .schema("erp_hr")
      .from("leave_requests")
      .update({
        cancelled_at: new Date().toISOString(),
        cancelled_by: ctx.auth_user_id,
      })
      .eq("leave_request_id", leaveRequestId);

    if (leaveUpdateError) {
      throw new Error("LEAVE_CANCEL_REQUEST_UPDATE_FAILED");
    }

    // If request was previously APPROVED, remove the day records that were
    // created on approval. Non-fatal — day records can be cleaned up manually
    // if this fails, but we don't want to fail the cancel itself.
    if (previousState === "APPROVED") {
      await removeLeaveFromDateRecords(leaveRequestId).catch(() => {
        // Intentionally swallowed — cancel must not fail due to day record cleanup
      });
    }

    await appendWorkflowEvent({
      request_id: leaveRow.workflow_request_id,
      company_id: leaveRow.parent_company_id,
      module_code: workflow.module_code,
      event_type: "CANCEL",
      actor_auth_user_id: ctx.auth_user_id,
      previous_state: previousState,
      new_state: "CANCELLED",
    });

    return okResponse(
      {
        leave_request_id: leaveRequestId,
        workflow_request_id: leaveRow.workflow_request_id,
        current_state: "CANCELLED",
      },
      ctx.request_id,
    );
  } catch (err) {
    return errorResponse(
      (err as Error).message || "LEAVE_CANCEL_EXCEPTION",
      "leave cancel exception",
      ctx.request_id,
      "NONE",
      403,
      {
        gateId: "HR.LEAVE",
        routeKey,
        decisionTrace: (err as Error).message || "LEAVE_CANCEL_EXCEPTION",
      },
    );
  }
}

export async function listLeaveApprovalInboxHandler(
  _req: Request,
  ctx: HrHandlerContext,
): Promise<Response> {
  try {
    assertHrBusinessContext(ctx);

    const moduleBinding = await getModuleBindingForResource(LEAVE_RESOURCE_CODES.apply);
    const rows = await loadLeaveRows({
      parentCompanyId: ctx.context.companyId,
    });
    const cases = await buildLeaveCases(rows);
    const approverRows = await loadApproverRulesForCompanyModule(
      ctx.context.companyId,
      moduleBinding.module_code,
    );

    const actionableCases = cases.filter((row) => {
      if (row.current_state !== "PENDING") {
        return false;
      }

      const scopedApprovers = pickScopedApprovers(
        {
          resource_code: row.resource_code,
          action_code: row.action_code,
          requester_auth_user_id: row.requester_auth_user_id,
          requester_work_context_id: row.requester_work_context_id,
          requester_department_work_context_id: row.requester_department_work_context_id,
        },
        approverRows,
      );

      return isActionableForApprover({
        workflow: {
          approval_type: row.approval_type,
        },
        requesterAuthUserId: row.requester_auth_user_id,
        scopedApprovers,
        decisions: (row.decision_history ?? []).map((decision) => ({
          request_id: row.workflow_request_id,
          stage_number: decision.stage_number,
          approver_auth_user_id: decision.approver_auth_user_id,
          decision: decision.decision,
          decided_at: decision.decided_at,
        })),
        authUserId: ctx.auth_user_id,
        roleCode: ctx.roleCode,
      });
    });

    return okResponse(
      {
        requests: actionableCases,
      },
      ctx.request_id,
    );
  } catch (err) {
    return errorResponse(
      (err as Error).message || "LEAVE_APPROVAL_INBOX_EXCEPTION",
      "leave approval inbox exception",
      ctx.request_id,
    );
  }
}

export async function listLeaveApprovalScopeHistoryHandler(
  req: Request,
  ctx: HrHandlerContext,
): Promise<Response> {
  try {
    assertHrBusinessContext(ctx);

    const url = new URL(req.url);
    const requesterAuthUserId = url.searchParams.get("requester_auth_user_id")?.trim() || undefined;

    const moduleBinding = await getModuleBindingForResource(LEAVE_RESOURCE_CODES.apply);
    const rows = await loadLeaveRows({
      parentCompanyId: ctx.context.companyId,
      requesterAuthUserId,
    });
    const cases = await buildLeaveCases(rows);
    const approverRows = await loadApproverRulesForCompanyModule(
      ctx.context.companyId,
      moduleBinding.module_code,
    );

    const scopedHistory = cases.filter((row) => {
      const scopedApprovers = pickScopedApprovers(
        {
          resource_code: row.resource_code,
          action_code: row.action_code,
          requester_auth_user_id: row.requester_auth_user_id,
          requester_work_context_id: row.requester_work_context_id,
          requester_department_work_context_id: row.requester_department_work_context_id,
        },
        approverRows,
      );

      return scopedApprovers.some((approver) =>
        isApproverMatch(approver, ctx.auth_user_id, ctx.roleCode)
      );
    });

    return okResponse(
      {
        requests: scopedHistory,
      },
      ctx.request_id,
    );
  } catch (err) {
    return errorResponse(
      (err as Error).message || "LEAVE_APPROVAL_HISTORY_EXCEPTION",
      "leave approval history exception",
      ctx.request_id,
    );
  }
}

export async function listLeaveRegisterHandler(
  req: Request,
  ctx: HrHandlerContext,
): Promise<Response> {
  try {
    assertHrBusinessContext(ctx);

    const url = new URL(req.url);
    const requesterAuthUserId = url.searchParams.get("requester_auth_user_id")?.trim() || undefined;
    const requestedCompanyId = url.searchParams.get("company_id")?.trim() || "";
    const fromDate = url.searchParams.get("from_date")?.trim() || "";
    const toDate = url.searchParams.get("to_date")?.trim() || "";
    const leaveTypeCodeFilter = url.searchParams.get("leave_type_code")?.trim().toUpperCase() || "";
    const normalizedFromDate = fromDate ? normalizeIsoDate(fromDate) : "";
    const normalizedToDate = toDate ? normalizeIsoDate(toDate) : "";

    if ((normalizedFromDate && !normalizedToDate) || (!normalizedFromDate && normalizedToDate)) {
      return errorResponse(
        "LEAVE_REGISTER_DATE_RANGE_REQUIRED",
        "both from and to dates are required",
        ctx.request_id,
      );
    }

    if (normalizedFromDate && normalizedToDate) {
      const totalDays = calculateInclusiveDays(normalizedFromDate, normalizedToDate);
      if (totalDays <= 0 || totalDays > 366) {
        return errorResponse(
          "LEAVE_REGISTER_DATE_RANGE_INVALID",
          "date range must stay within one year",
          ctx.request_id,
        );
      }
    }

    const accessibleCompanyIds = await loadAccessibleRegisterCompanyIds(ctx.auth_user_id);
    const resolvedCompanyIds =
      requestedCompanyId === "*"
        ? accessibleCompanyIds
        : requestedCompanyId
          ? accessibleCompanyIds.includes(requestedCompanyId)
            ? [requestedCompanyId]
            : []
          : ctx.context.companyId
            ? [ctx.context.companyId]
            : [];

    if (resolvedCompanyIds.length === 0) {
      return okResponse({ requests: [] }, ctx.request_id);
    }

    const rows = await loadLeaveRows({
      parentCompanyIds: resolvedCompanyIds,
      requesterAuthUserId,
      fromDate: normalizedFromDate || undefined,
      toDate: normalizedToDate || undefined,
    });
    const cases = await buildLeaveCases(rows);
    const moduleBinding = await getModuleBindingForResource(LEAVE_RESOURCE_CODES.apply);
    const viewerRulesByCompany = new Map<
      string,
      Awaited<ReturnType<typeof loadViewerRulesForCompanyModule>>
    >();
    const approverRulesByCompany = new Map<
      string,
      Awaited<ReturnType<typeof loadApproverRulesForCompanyModule>>
    >();
    for (const companyId of resolvedCompanyIds) {
      viewerRulesByCompany.set(
        companyId,
        await loadViewerRulesForCompanyModule(companyId, moduleBinding.module_code),
      );
      approverRulesByCompany.set(
        companyId,
        await loadApproverRulesForCompanyModule(companyId, moduleBinding.module_code),
      );
    }

    const visibleCases = cases.filter((row) => {
      const viewerRows = viewerRulesByCompany.get(row.parent_company_id) ?? [];
      const hasViewerAccess = pickScopedViewerRules(
        {
          resource_code: LEAVE_RESOURCE_CODES.register,
          action_code: "VIEW",
          requester_auth_user_id: row.requester_auth_user_id,
          requester_work_context_id: row.requester_work_context_id,
          requester_department_work_context_id: row.requester_department_work_context_id,
        },
        viewerRows,
        "VIEW",
      ).some((viewer) => isViewerMatch(viewer, ctx.auth_user_id, ctx.roleCode));

      if (hasViewerAccess) return true;

      // Fallback: approvers can always see requests within their approval scope
      const approverRows = approverRulesByCompany.get(row.parent_company_id) ?? [];
      const scopedApprovers = pickScopedApprovers(
        {
          resource_code: row.resource_code,
          action_code: row.action_code,
          requester_auth_user_id: row.requester_auth_user_id,
          requester_work_context_id: row.requester_work_context_id,
          requester_department_work_context_id: row.requester_department_work_context_id,
        },
        approverRows,
      );
      return scopedApprovers.some((approver) =>
        isApproverMatch(approver, ctx.auth_user_id, ctx.roleCode)
      );
    });

    const filteredCases = leaveTypeCodeFilter
      ? visibleCases.filter((c) => c.leave_type_code === leaveTypeCodeFilter)
      : visibleCases;

    return okResponse(
      {
        requests: filteredCases,
      },
      ctx.request_id,
    );
  } catch (err) {
    return errorResponse(
      (err as Error).message || "LEAVE_REGISTER_EXCEPTION",
      "leave register exception",
      ctx.request_id,
    );
  }
}

// ---------------------------------------------------------------------------
// expandLeaveToDateRecords
// Called by process_decision.handler.ts after a leave workflow reaches APPROVED.
// Looks up leave_request by workflow_request_id and upserts one day record per
// calendar date in the approved range. HOLIDAY/WEEK_OFF rows are not overwritten
// (guard is inside the DB function erp_hr.upsert_day_record_leave).
// ---------------------------------------------------------------------------
export async function expandLeaveToDateRecords(
  workflowRequestId: string,
): Promise<void> {
  const { data: lr } = await serviceRoleClient
    .schema("erp_hr")
    .from("leave_requests")
    .select("leave_request_id, requester_auth_user_id, parent_company_id, from_date, to_date, leave_type_id")
    .eq("workflow_request_id", workflowRequestId)
    .maybeSingle();

  if (!lr) return; // Not a leave request — silently no-op

  const dates = generateDateRange(lr.from_date, lr.to_date);

  for (const date of dates) {
    await serviceRoleClient
      .schema("erp_hr")
      .rpc("upsert_day_record_leave", {
        p_company_id: lr.parent_company_id,
        p_employee_id: lr.requester_auth_user_id,
        p_record_date: date,
        p_leave_request_id: lr.leave_request_id,
        p_leave_type_id: lr.leave_type_id,
      });
  }
}

// ---------------------------------------------------------------------------
// removeLeaveFromDateRecords
// Called by cancelLeaveRequestHandler when previousState === "APPROVED".
// Deletes all day records that were created by leave approval for this request.
// Only removes rows with source = 'LEAVE_APPROVED' — HOLIDAY/WEEK_OFF rows
// that happened to fall in the same range are never touched.
// ---------------------------------------------------------------------------
async function removeLeaveFromDateRecords(leaveRequestId: string): Promise<void> {
  await serviceRoleClient
    .schema("erp_hr")
    .from("employee_day_records")
    .delete()
    .eq("leave_request_id", leaveRequestId)
    .eq("source", "LEAVE_APPROVED");
}

// ---------------------------------------------------------------------------
// getLeaveSandwichPreviewHandler
// GET /api/hr/leave/sandwich-preview?from_date=YYYY-MM-DD&to_date=YYYY-MM-DD
// Called by the frontend as the user selects dates in the apply form to show
// the sandwich info panel / block error before they submit.
// No special ACL required — any authenticated user with HR business context.
// ---------------------------------------------------------------------------
export async function getLeaveSandwichPreviewHandler(
  req: Request,
  ctx: HrHandlerContext,
): Promise<Response> {
  try {
    assertHrBusinessContext(ctx);

    const url = new URL(req.url);
    const fromDateRaw = url.searchParams.get("from_date")?.trim() ?? "";
    const toDateRaw = url.searchParams.get("to_date")?.trim() ?? "";

    if (!fromDateRaw || !toDateRaw) {
      return errorResponse(
        "SANDWICH_PREVIEW_DATES_REQUIRED",
        "from_date and to_date are required",
        ctx.request_id,
        "NONE",
        400,
      );
    }

    const fromDate = normalizeIsoDate(fromDateRaw);
    const toDate = normalizeIsoDate(toDateRaw);

    if (toDate < fromDate) {
      return errorResponse(
        "LEAVE_DATE_RANGE_INVALID",
        "to_date cannot be before from_date",
        ctx.request_id,
        "NONE",
        400,
      );
    }

    const requestedCompanyId =
      String(url.searchParams.get("company_id") ?? ctx.context.companyId ?? "").trim() || null;
    const parentCompany = await getParentCompanyScope(ctx.auth_user_id, requestedCompanyId);

    const result = await computeSandwichLeave(parentCompany.company_id, fromDate, toDate);

    return okResponse(result, ctx.request_id);
  } catch (err) {
    return errorResponse(
      (err as Error).message || "SANDWICH_PREVIEW_EXCEPTION",
      "sandwich preview exception",
      ctx.request_id,
    );
  }
}
