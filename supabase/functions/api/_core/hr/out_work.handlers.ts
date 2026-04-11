import { okResponse, errorResponse } from "../response.ts";
import { log } from "../../_lib/logger.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import {
  createWorkflowScopeContextMap,
  loadActiveCompanyWorkContexts,
  resolveDepartmentWorkflowScopeId,
} from "../../_shared/workflow_scope.ts";
import {
  OUT_WORK_RESOURCE_CODES,
  appendWorkflowEvent,
  assertHrBusinessContext,
  buildUserDisplay,
  calculateInclusiveDays,
  canRequesterCancel,
  createWorkflowRequest,
  deleteWorkflowRequest,
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

type DestinationRow = {
  destination_id: string;
  company_id: string;
  destination_name: string;
  destination_address: string;
  is_active: boolean;
};

type OutWorkRequestRow = {
  out_work_request_id: string;
  workflow_request_id: string;
  requester_auth_user_id: string;
  parent_company_id: string;
  destination_id: string | null;
  destination_name: string;
  destination_address: string;
  from_date: string;
  to_date: string;
  total_days: number;
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

type OutWorkCaseRow = {
  out_work_request_id: string;
  workflow_request_id: string;
  requester_auth_user_id: string;
  requester_display: string;
  requester_work_context_id: string | null;
  requester_department_work_context_id: string | null;
  requester_work_context_code: string | null;
  requester_work_context_name: string | null;
  parent_company_id: string;
  parent_company_code: string | null;
  parent_company_name: string | null;
  destination_id: string | null;
  destination_name: string;
  destination_address: string;
  from_date: string;
  to_date: string;
  total_days: number;
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

async function loadDestinationRows(parentCompanyId: string): Promise<DestinationRow[]> {
  const { data, error } = await serviceRoleClient
    .schema("erp_hr")
    .from("out_work_destinations")
    .select("destination_id, company_id, destination_name, destination_address, is_active")
    .eq("company_id", parentCompanyId)
    .eq("is_active", true)
    .order("destination_name", { ascending: true });

  if (error) {
    throw new Error("OUT_WORK_DESTINATION_LIST_FAILED");
  }

  return (data ?? []) as DestinationRow[];
}

async function loadOutWorkRows(filters: {
  requesterAuthUserId?: string;
  parentCompanyId?: string;
}): Promise<OutWorkRequestRow[]> {
  let query = serviceRoleClient
    .schema("erp_hr")
    .from("out_work_requests")
    .select("out_work_request_id, workflow_request_id, requester_auth_user_id, parent_company_id, destination_id, destination_name, destination_address, from_date, to_date, total_days, reason, cancelled_at, cancelled_by, created_at")
    .order("created_at", { ascending: false });

  if (filters.requesterAuthUserId) {
    query = query.eq("requester_auth_user_id", filters.requesterAuthUserId);
  }

  if (filters.parentCompanyId) {
    query = query.eq("parent_company_id", filters.parentCompanyId);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error("OUT_WORK_REQUEST_LIST_FAILED");
  }

  return (data ?? []) as OutWorkRequestRow[];
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
    throw new Error("OUT_WORK_WORKFLOW_LOOKUP_FAILED");
  }

  for (const row of (data ?? []) as WorkflowRequestRow[]) {
    workflowMap.set(row.request_id, row);
  }

  return workflowMap;
}

async function buildOutWorkCases(rows: OutWorkRequestRow[]) {
  const workflowRequestIds = rows.map((row) => row.workflow_request_id);
  const workflowMap = await loadWorkflowMap(workflowRequestIds);
  const decisionMap = await loadWorkflowDecisionMap(workflowRequestIds);

  const actorIds = new Set<string>();
  for (const row of rows) {
    actorIds.add(row.requester_auth_user_id);
  }
  for (const decisions of decisionMap.values()) {
    for (const decision of decisions) {
      actorIds.add(decision.approver_auth_user_id);
    }
  }

  const userIdentityMap = await loadUserIdentityMap([...actorIds]);
  const companyIdentityMap = await loadCompanyIdentityMap(
    rows.map((row) => row.parent_company_id),
  );
  const companyWorkContextMap = rows[0]?.parent_company_id
    ? createWorkflowScopeContextMap(
        await loadActiveCompanyWorkContexts(serviceRoleClient, rows[0].parent_company_id),
      )
    : new Map();

  const requests: OutWorkCaseRow[] = [];

  for (const row of rows) {
    const workflow = workflowMap.get(row.workflow_request_id);
    if (!workflow) {
      continue;
    }

    const decisions = decisionMap.get(row.workflow_request_id) ?? [];
    const companyIdentity = companyIdentityMap.get(row.parent_company_id) ?? null;
    const requesterDepartmentWorkContextId = resolveDepartmentWorkflowScopeId(
      {
        requester_work_context_id: workflow.requester_work_context_id ?? null,
      },
      companyWorkContextMap,
    );
    const requesterWorkContext = workflow.requester_work_context_id
      ? companyWorkContextMap.get(workflow.requester_work_context_id) ?? null
      : null;

    requests.push({
      out_work_request_id: row.out_work_request_id,
      workflow_request_id: row.workflow_request_id,
      requester_auth_user_id: row.requester_auth_user_id,
      requester_display: buildUserDisplay(
        userIdentityMap.get(row.requester_auth_user_id) ?? null,
      ),
      requester_work_context_id: workflow.requester_work_context_id ?? null,
      requester_department_work_context_id: requesterDepartmentWorkContextId,
      requester_work_context_code: requesterWorkContext?.work_context_code ?? null,
      requester_work_context_name: requesterWorkContext?.work_context_name ?? null,
      parent_company_id: row.parent_company_id,
      parent_company_code: companyIdentity?.company_code ?? null,
      parent_company_name: companyIdentity?.company_name ?? null,
      destination_id: row.destination_id,
      destination_name: row.destination_name,
      destination_address: row.destination_address,
      from_date: row.from_date,
      to_date: row.to_date,
      total_days: row.total_days,
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
    });
  }

  return requests;
}

export async function listOutWorkDestinationsHandler(
  _req: Request,
  ctx: HrHandlerContext,
): Promise<Response> {
  try {
    assertHrBusinessContext(ctx);
    const parentCompany = await getParentCompanyScope(ctx.auth_user_id);
    const destinations = await loadDestinationRows(parentCompany.company_id);

    return okResponse({ destinations }, ctx.request_id);
  } catch (err) {
    return errorResponse(
      (err as Error).message || "OUT_WORK_DESTINATION_LIST_EXCEPTION",
      "out work destination list exception",
      ctx.request_id,
    );
  }
}

export async function createOutWorkDestinationHandler(
  req: Request,
  ctx: HrHandlerContext,
): Promise<Response> {
  const routeKey = "POST:/api/hr/out-work/destination";

  try {
    assertHrBusinessContext(ctx);

    const body = await req.json().catch(() => ({}));
    const destinationName = String(body?.destination_name ?? "").trim();
    const destinationAddress = String(body?.destination_address ?? "").trim();

    if (destinationName.length < 2) {
      return errorResponse(
        "OUT_WORK_DESTINATION_NAME_REQUIRED",
        "destination name required",
        ctx.request_id,
      );
    }

    if (destinationAddress.length < 5) {
      return errorResponse(
        "OUT_WORK_DESTINATION_ADDRESS_REQUIRED",
        "destination address required",
        ctx.request_id,
      );
    }

    const parentCompany = await getParentCompanyScope(ctx.auth_user_id);
    const { data, error } = await serviceRoleClient
      .schema("erp_hr")
      .from("out_work_destinations")
      .insert({
        company_id: parentCompany.company_id,
        destination_name: destinationName,
        destination_address: destinationAddress,
        created_by: ctx.auth_user_id,
      })
      .select("destination_id, company_id, destination_name, destination_address, is_active")
      .single();

    if (error || !data) {
      throw new Error("OUT_WORK_DESTINATION_CREATE_FAILED");
    }

    log({
      level: "INFO",
      request_id: ctx.request_id,
      gate_id: "HR.OUTWORK",
      route_key: routeKey,
      event: "OUT_WORK_DESTINATION_CREATED",
      actor: ctx.auth_user_id,
      meta: {
        destination_id: data.destination_id,
        company_id: parentCompany.company_id,
      },
    });

    return okResponse({ destination: data }, ctx.request_id);
  } catch (err) {
    log({
      level: "ERROR",
      request_id: ctx.request_id,
      gate_id: "HR.OUTWORK",
      route_key: routeKey,
      event: "OUT_WORK_DESTINATION_CREATE_EXCEPTION",
      actor: ctx.auth_user_id,
      meta: {
        error: (err as Error).message,
      },
    });

    return errorResponse(
      (err as Error).message || "OUT_WORK_DESTINATION_CREATE_EXCEPTION",
      "out work destination create exception",
      ctx.request_id,
      "NONE",
      403,
      {
        gateId: "HR.OUTWORK",
        routeKey,
        decisionTrace: (err as Error).message || "OUT_WORK_DESTINATION_CREATE_EXCEPTION",
      },
    );
  }
}

export async function createOutWorkRequestHandler(
  req: Request,
  ctx: HrHandlerContext,
): Promise<Response> {
  const routeKey = "POST:/api/hr/out-work/request";

  try {
    assertHrBusinessContext(ctx);

    const body = await req.json().catch(() => ({}));
    const fromDate = normalizeIsoDate(body?.from_date);
    const toDate = normalizeIsoDate(body?.to_date);
    const reason = String(body?.reason ?? "").trim();
    const destinationId = String(body?.destination_id ?? "").trim();
    const inlineDestinationName = String(body?.destination_name ?? "").trim();
    const inlineDestinationAddress = String(body?.destination_address ?? "").trim();

    if (!reason) {
      return errorResponse(
        "OUT_WORK_REASON_REQUIRED",
        "out work reason required",
        ctx.request_id,
      );
    }

    if (toDate < fromDate) {
      return errorResponse(
        "OUT_WORK_DATE_RANGE_INVALID",
        "to date must be after from date",
        ctx.request_id,
      );
    }

    const todayIso = todayIsoInKolkata();
    const earliestBackdate = shiftIsoDate(todayIso, -3);

    if (fromDate < earliestBackdate) {
      return errorResponse(
        "OUT_WORK_BACKDATE_LIMIT_EXCEEDED",
        "backdate limit exceeded",
        ctx.request_id,
      );
    }

    const parentCompany = await getParentCompanyScope(ctx.auth_user_id);
    let resolvedDestinationId: string | null = null;
    let resolvedDestinationName = "";
    let resolvedDestinationAddress = "";

    if (destinationId) {
      const { data: destinationRow, error: destinationError } = await serviceRoleClient
        .schema("erp_hr")
        .from("out_work_destinations")
        .select("destination_id, company_id, destination_name, destination_address, is_active")
        .eq("destination_id", destinationId)
        .eq("company_id", parentCompany.company_id)
        .eq("is_active", true)
        .maybeSingle();

      if (destinationError || !destinationRow) {
        return errorResponse(
          "OUT_WORK_DESTINATION_NOT_FOUND",
          "destination not found for parent company",
          ctx.request_id,
        );
      }

      resolvedDestinationId = destinationRow.destination_id;
      resolvedDestinationName = destinationRow.destination_name;
      resolvedDestinationAddress = destinationRow.destination_address;
    } else {
      if (inlineDestinationName.length < 2 || inlineDestinationAddress.length < 5) {
        return errorResponse(
          "OUT_WORK_DESTINATION_REQUIRED",
          "choose or create a destination",
          ctx.request_id,
        );
      }

      resolvedDestinationName = inlineDestinationName;
      resolvedDestinationAddress = inlineDestinationAddress;
    }

    const totalDays = calculateInclusiveDays(fromDate, toDate);
    const explicitRequesterWorkContextId =
      String(body?.requester_work_context_id ?? "").trim() || null;
    const requesterWorkContext = await resolveRequesterSubjectWorkContext({
      authUserId: ctx.auth_user_id,
      parentCompanyId: parentCompany.company_id,
      explicitWorkContextId: explicitRequesterWorkContextId,
    });
    const approvalConfig = await resolveApprovalConfig(
      OUT_WORK_RESOURCE_CODES.apply,
      "WRITE",
    );

    const workflow = await createWorkflowRequest(
      parentCompany.company_id,
      ctx.auth_user_id,
      approvalConfig.project_id,
      approvalConfig.module_code,
      approvalConfig.approval_required,
      approvalConfig.approval_type,
      OUT_WORK_RESOURCE_CODES.approvalInbox,
      requesterWorkContext.work_context_id,
    );

    const { data: outWorkRow, error: outWorkError } = await serviceRoleClient
      .schema("erp_hr")
      .from("out_work_requests")
      .insert({
        workflow_request_id: workflow.request_id,
        requester_auth_user_id: ctx.auth_user_id,
        parent_company_id: parentCompany.company_id,
        requester_work_context_id: requesterWorkContext.work_context_id,
        destination_id: resolvedDestinationId,
        destination_name: resolvedDestinationName,
        destination_address: resolvedDestinationAddress,
        from_date: fromDate,
        to_date: toDate,
        total_days: totalDays,
        reason,
        created_by: ctx.auth_user_id,
      })
      .select("out_work_request_id, workflow_request_id, requester_auth_user_id, parent_company_id, destination_id, destination_name, destination_address, from_date, to_date, total_days, reason, cancelled_at, cancelled_by, created_at")
      .single();

    if (outWorkError || !outWorkRow) {
      await deleteWorkflowRequest(workflow.request_id);
      throw new Error("OUT_WORK_REQUEST_CREATE_FAILED");
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

    return okResponse(
      {
        request: {
          ...outWorkRow,
          current_state: workflow.current_state,
          approval_type: approvalConfig.approval_type,
          parent_company_code: parentCompany.company_code,
          parent_company_name: parentCompany.company_name,
          requester_work_context_id: requesterWorkContext.work_context_id,
          requester_work_context_code: requesterWorkContext.work_context_code ?? null,
          requester_work_context_name: requesterWorkContext.work_context_name ?? null,
        },
      },
      ctx.request_id,
    );
  } catch (err) {
    log({
      level: "ERROR",
      request_id: ctx.request_id,
      gate_id: "HR.OUTWORK",
      route_key: routeKey,
      event: "OUT_WORK_REQUEST_CREATE_EXCEPTION",
      actor: ctx.auth_user_id,
      meta: {
        error: (err as Error).message,
      },
    });

    return errorResponse(
      (err as Error).message || "OUT_WORK_REQUEST_CREATE_EXCEPTION",
      "out work request create exception",
      ctx.request_id,
      "NONE",
      403,
      {
        gateId: "HR.OUTWORK",
        routeKey,
        decisionTrace: (err as Error).message || "OUT_WORK_REQUEST_CREATE_EXCEPTION",
      },
    );
  }
}

export async function listMyOutWorkRequestsHandler(
  _req: Request,
  ctx: HrHandlerContext,
): Promise<Response> {
  try {
    assertHrBusinessContext(ctx);
    const rows = await loadOutWorkRows({
      requesterAuthUserId: ctx.auth_user_id,
    });
    const requests = await buildOutWorkCases(rows);
    return okResponse({ requests }, ctx.request_id);
  } catch (err) {
    return errorResponse(
      (err as Error).message || "OUT_WORK_MY_REQUESTS_EXCEPTION",
      "out work my requests exception",
      ctx.request_id,
    );
  }
}

export async function cancelOutWorkRequestHandler(
  req: Request,
  ctx: HrHandlerContext,
): Promise<Response> {
  const routeKey = "POST:/api/hr/out-work/cancel";

  try {
    assertHrBusinessContext(ctx);
    const body = await req.json().catch(() => ({}));
    const outWorkRequestId = String(body?.out_work_request_id ?? "").trim();

    if (!outWorkRequestId) {
      return errorResponse(
        "OUT_WORK_CANCEL_ID_REQUIRED",
        "out_work_request_id required",
        ctx.request_id,
      );
    }

    const { data: requestRow, error: requestError } = await serviceRoleClient
      .schema("erp_hr")
      .from("out_work_requests")
      .select("out_work_request_id, workflow_request_id, requester_auth_user_id, parent_company_id")
      .eq("out_work_request_id", outWorkRequestId)
      .maybeSingle();

    if (requestError || !requestRow) {
      return errorResponse(
        "OUT_WORK_REQUEST_NOT_FOUND",
        "out work request not found",
        ctx.request_id,
      );
    }

    if (requestRow.requester_auth_user_id !== ctx.auth_user_id) {
      return errorResponse(
        "OUT_WORK_CANCEL_FORBIDDEN",
        "user cannot cancel this request",
        ctx.request_id,
      );
    }

    const { data: workflow, error: workflowError } = await serviceRoleClient
      .schema("acl")
      .from("workflow_requests")
      .select("request_id, module_code, current_state")
      .eq("request_id", requestRow.workflow_request_id)
      .maybeSingle();

    if (workflowError || !workflow) {
      return errorResponse(
        "OUT_WORK_WORKFLOW_NOT_FOUND",
        "workflow request not found",
        ctx.request_id,
      );
    }

    const decisionMap = await loadWorkflowDecisionMap([requestRow.workflow_request_id]);
    const decisions = decisionMap.get(requestRow.workflow_request_id) ?? [];

    if (!canRequesterCancel(workflow.current_state, decisions)) {
      return errorResponse(
        "OUT_WORK_CANCEL_NOT_ALLOWED",
        "out work request cannot be cancelled anymore",
        ctx.request_id,
      );
    }

    const { error: workflowUpdateError } = await serviceRoleClient
      .schema("acl")
      .from("workflow_requests")
      .update({
        current_state: "CANCELLED",
      })
      .eq("request_id", requestRow.workflow_request_id);

    if (workflowUpdateError) {
      throw new Error("OUT_WORK_CANCEL_WORKFLOW_UPDATE_FAILED");
    }

    const { error: requestUpdateError } = await serviceRoleClient
      .schema("erp_hr")
      .from("out_work_requests")
      .update({
        cancelled_at: new Date().toISOString(),
        cancelled_by: ctx.auth_user_id,
      })
      .eq("out_work_request_id", outWorkRequestId);

    if (requestUpdateError) {
      throw new Error("OUT_WORK_CANCEL_REQUEST_UPDATE_FAILED");
    }

    await appendWorkflowEvent({
      request_id: requestRow.workflow_request_id,
      company_id: requestRow.parent_company_id,
      module_code: workflow.module_code,
      event_type: "CANCEL",
      actor_auth_user_id: ctx.auth_user_id,
      previous_state: workflow.current_state,
      new_state: "CANCELLED",
    });

    return okResponse(
      {
        out_work_request_id: outWorkRequestId,
        workflow_request_id: requestRow.workflow_request_id,
        current_state: "CANCELLED",
      },
      ctx.request_id,
    );
  } catch (err) {
    return errorResponse(
      (err as Error).message || "OUT_WORK_CANCEL_EXCEPTION",
      "out work cancel exception",
      ctx.request_id,
      "NONE",
      403,
      {
        gateId: "HR.OUTWORK",
        routeKey,
        decisionTrace: (err as Error).message || "OUT_WORK_CANCEL_EXCEPTION",
      },
    );
  }
}

export async function listOutWorkApprovalInboxHandler(
  _req: Request,
  ctx: HrHandlerContext,
): Promise<Response> {
  try {
    assertHrBusinessContext(ctx);

    const moduleBinding = await getModuleBindingForResource(OUT_WORK_RESOURCE_CODES.apply);
    const rows = await loadOutWorkRows({
      parentCompanyId: ctx.context.companyId,
    });
    const requests = await buildOutWorkCases(rows);
    const approverRows = await loadApproverRulesForCompanyModule(
      ctx.context.companyId,
      moduleBinding.module_code,
    );

    const actionableRequests = requests.filter((row) => {
      if (row.current_state !== "PENDING") {
        return false;
      }

      const scopedApprovers = pickScopedApprovers(
        {
          resource_code: row.resource_code,
          action_code: row.action_code,
          requester_work_context_id: row.requester_work_context_id,
          requester_department_work_context_id: row.requester_department_work_context_id,
        },
        approverRows,
      );

      return isActionableForApprover({
        workflow: {
          approval_type: row.approval_type,
        },
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

    return okResponse({ requests: actionableRequests }, ctx.request_id);
  } catch (err) {
    return errorResponse(
      (err as Error).message || "OUT_WORK_APPROVAL_INBOX_EXCEPTION",
      "out work approval inbox exception",
      ctx.request_id,
    );
  }
}

export async function listOutWorkApprovalScopeHistoryHandler(
  req: Request,
  ctx: HrHandlerContext,
): Promise<Response> {
  try {
    assertHrBusinessContext(ctx);

    const url = new URL(req.url);
    const requesterAuthUserId = url.searchParams.get("requester_auth_user_id")?.trim() || undefined;

    const moduleBinding = await getModuleBindingForResource(OUT_WORK_RESOURCE_CODES.apply);
    const rows = await loadOutWorkRows({
      parentCompanyId: ctx.context.companyId,
      requesterAuthUserId,
    });
    const requests = await buildOutWorkCases(rows);
    const approverRows = await loadApproverRulesForCompanyModule(
      ctx.context.companyId,
      moduleBinding.module_code,
    );

    const scopedHistory = requests.filter((row) => {
      const scopedApprovers = pickScopedApprovers(
        {
          resource_code: row.resource_code,
          action_code: row.action_code,
          requester_work_context_id: row.requester_work_context_id,
          requester_department_work_context_id: row.requester_department_work_context_id,
        },
        approverRows,
      );

      return scopedApprovers.some((approver) =>
        isApproverMatch(approver, ctx.auth_user_id, ctx.roleCode)
      );
    });

    return okResponse({ requests: scopedHistory }, ctx.request_id);
  } catch (err) {
    return errorResponse(
      (err as Error).message || "OUT_WORK_APPROVAL_HISTORY_EXCEPTION",
      "out work approval history exception",
      ctx.request_id,
    );
  }
}

export async function listOutWorkRegisterHandler(
  req: Request,
  ctx: HrHandlerContext,
): Promise<Response> {
  try {
    assertHrBusinessContext(ctx);

    const url = new URL(req.url);
    const requesterAuthUserId = url.searchParams.get("requester_auth_user_id")?.trim() || undefined;

    const rows = await loadOutWorkRows({
      parentCompanyId: ctx.context.companyId,
      requesterAuthUserId,
    });
    const requests = await buildOutWorkCases(rows);
    const moduleBinding = await getModuleBindingForResource(OUT_WORK_RESOURCE_CODES.apply);
    const viewerRows = await loadViewerRulesForCompanyModule(
      ctx.context.companyId,
      moduleBinding.module_code,
    );

    const visibleRequests = requests.filter((row) =>
      pickScopedViewerRules(
        {
          resource_code: OUT_WORK_RESOURCE_CODES.register,
          action_code: "VIEW",
          requester_work_context_id: row.requester_work_context_id,
          requester_department_work_context_id: row.requester_department_work_context_id,
        },
        viewerRows,
        "VIEW",
      ).some((viewer) => isViewerMatch(viewer, ctx.auth_user_id, ctx.roleCode))
    );

    return okResponse({ requests: visibleRequests }, ctx.request_id);
  } catch (err) {
    return errorResponse(
      (err as Error).message || "OUT_WORK_REGISTER_EXCEPTION",
      "out work register exception",
      ctx.request_id,
    );
  }
}
