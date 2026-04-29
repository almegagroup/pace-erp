/*
 * File-ID: 8.5D-HR-CORR-APPROVAL
 * File-Path: supabase/functions/api/_core/hr/attendance_correction_approval.handlers.ts
 * Gate: 8
 * Phase: 5-D-2
 * Domain: HR
 * Purpose: Attendance correction approval workflow — HR submits a correction
 *          request that goes through the workflow engine. Plant Manager (or
 *          configured approver) approves. Only after approval is the
 *          employee_day_records row updated.
 *
 *          Handlers:
 *            1. submitCorrectionRequestHandler      POST /api/hr/attendance/correction/submit
 *            2. listPendingCorrectionsHandler       GET  /api/hr/attendance/correction/my-requests
 *            3. getCorrectionRequestDetailHandler   GET  /api/hr/attendance/correction/detail
 *            4. listCorrectionApprovalInboxHandler  GET  /api/hr/attendance/correction/approval-inbox
 *            5. listCorrectionApprovalHistoryHandler GET /api/hr/attendance/correction/approval-history
 *            6. applyCorrectionToDateRecord         (export — called by process_decision.handler on APPROVED)
 *
 * Authority: Backend
 */

import { okResponse, errorResponse } from "../response.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { getActiveAclVersionIdForCompany } from "../../_shared/acl_runtime.ts";
import { readAclSnapshotDecision } from "../../_shared/acl_snapshot.ts";
import {
  ATTENDANCE_RESOURCE_CODES,
  appendWorkflowEvent,
  assertHrBusinessContext,
  buildUserDisplay,
  createWorkflowRequest,
  deleteWorkflowRequest,
  getModuleBindingForResource,
  getParentCompanyScope,
  isActionableForApprover,
  isApproverMatch,
  loadApproverRulesForCompanyModule,
  loadUserIdentityMap,
  normalizeIsoDate,
  pickScopedApprovers,
  resolveApprovalConfig,
  resolveRequesterSubjectWorkContext,
  loadWorkflowDecisionMap,
  buildUserDisplay as _buildUserDisplay,
  type HrHandlerContext,
  type WorkflowDecisionRow,
} from "./shared.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CorrectionRequestRow = {
  correction_request_id: string;
  workflow_request_id: string;
  requester_auth_user_id: string;
  parent_company_id: string;
  target_employee_id: string;
  target_date: string;
  requested_status: string;
  previous_status: string | null;
  correction_note: string;
  cancelled_at: string | null;
  cancelled_by: string | null;
  created_at: string;
};

type WorkflowRow = {
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

const CORRECTABLE_STATUSES = new Set(["PRESENT", "ABSENT", "MISS_PUNCH"]);

// ---------------------------------------------------------------------------
// Internal: ACL guard — HR_ATTENDANCE_MANUAL_CORRECTION WRITE (submitter)
// ---------------------------------------------------------------------------

async function assertCorrectionSubmitPermission(
  ctx: HrHandlerContext,
  companyId: string,
  workContextId: string,
): Promise<Response | null> {
  const aclVersionId = await getActiveAclVersionIdForCompany(serviceRoleClient, companyId);
  const { data: aclDecision } = await readAclSnapshotDecision({
    db: serviceRoleClient,
    aclVersionId,
    authUserId: ctx.auth_user_id,
    companyId,
    workContextId,
    resourceCode: ATTENDANCE_RESOURCE_CODES.manualCorrection,
    actionCode: "WRITE",
  });
  if (!aclDecision || aclDecision.decision !== "ALLOW") {
    return errorResponse(
      "CORRECTION_SUBMIT_FORBIDDEN",
      "permission denied — HR_ATTENDANCE_MANUAL_CORRECTION WRITE required",
      ctx.request_id,
      "NONE",
      403,
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// Internal: ACL guard — HR_ATTENDANCE_CORRECTION_INBOX APPROVE (approver)
// ---------------------------------------------------------------------------

async function assertCorrectionInboxPermission(
  ctx: HrHandlerContext,
  companyId: string,
  workContextId: string,
): Promise<Response | null> {
  const aclVersionId = await getActiveAclVersionIdForCompany(serviceRoleClient, companyId);
  const { data: aclDecision } = await readAclSnapshotDecision({
    db: serviceRoleClient,
    aclVersionId,
    authUserId: ctx.auth_user_id,
    companyId,
    workContextId,
    resourceCode: ATTENDANCE_RESOURCE_CODES.correctionInbox,
    actionCode: "APPROVE",
  });
  if (!aclDecision || aclDecision.decision !== "ALLOW") {
    return errorResponse(
      "CORRECTION_INBOX_FORBIDDEN",
      "permission denied — HR_ATTENDANCE_CORRECTION_INBOX APPROVE required",
      ctx.request_id,
      "NONE",
      403,
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// Internal: load correction rows + workflow rows for a company
// ---------------------------------------------------------------------------

async function loadCorrectionRows(opts: {
  parentCompanyId: string;
  requesterAuthUserId?: string;
}): Promise<Array<{ correction: CorrectionRequestRow; workflow: WorkflowRow }>> {
  let correctionQuery = serviceRoleClient
    .schema("erp_hr")
    .from("attendance_correction_requests")
    .select("*")
    .eq("parent_company_id", opts.parentCompanyId)
    .order("created_at", { ascending: false });

  if (opts.requesterAuthUserId) {
    correctionQuery = correctionQuery.eq("requester_auth_user_id", opts.requesterAuthUserId);
  }

  const { data: correctionRows, error: correctionError } = await correctionQuery;
  if (correctionError || !correctionRows) return [];

  if (correctionRows.length === 0) return [];

  const workflowIds = correctionRows.map((r) => r.workflow_request_id);
  const { data: workflowRows, error: wfError } = await serviceRoleClient
    .schema("acl")
    .from("workflow_requests")
    .select("request_id, company_id, requester_auth_user_id, requester_work_context_id, module_code, approval_type, current_state, resource_code, action_code, created_at")
    .in("request_id", workflowIds);

  if (wfError || !workflowRows) return [];

  const workflowMap = new Map(workflowRows.map((w) => [w.request_id, w as WorkflowRow]));

  return correctionRows
    .map((cr) => {
      const wf = workflowMap.get(cr.workflow_request_id);
      if (!wf) return null;
      return { correction: cr as CorrectionRequestRow, workflow: wf };
    })
    .filter((r): r is { correction: CorrectionRequestRow; workflow: WorkflowRow } => r !== null);
}

// ---------------------------------------------------------------------------
// Internal: build enriched case from a pair
// ---------------------------------------------------------------------------

async function buildCorrectionCases(
  pairs: Array<{ correction: CorrectionRequestRow; workflow: WorkflowRow }>,
) {
  if (pairs.length === 0) return [];

  const allUserIds = new Set<string>();
  for (const { correction, workflow } of pairs) {
    allUserIds.add(correction.requester_auth_user_id);
    allUserIds.add(correction.target_employee_id);
    allUserIds.add(workflow.requester_auth_user_id);
  }

  const identityMap = await loadUserIdentityMap([...allUserIds]);

  const workflowIds = pairs.map((p) => p.correction.workflow_request_id);
  const decisionMap = await loadWorkflowDecisionMap(workflowIds);

  return pairs.map(({ correction, workflow }) => {
    const requesterIdentity = identityMap.get(correction.requester_auth_user_id) ?? null;
    const targetIdentity = identityMap.get(correction.target_employee_id) ?? null;
    const decisions = decisionMap.get(correction.workflow_request_id) ?? [];

    return {
      correction_request_id: correction.correction_request_id,
      workflow_request_id: correction.workflow_request_id,
      requester_auth_user_id: correction.requester_auth_user_id,
      requester_display: buildUserDisplay(requesterIdentity),
      target_employee_id: correction.target_employee_id,
      target_employee_display: buildUserDisplay(targetIdentity),
      target_date: correction.target_date,
      requested_status: correction.requested_status,
      previous_status: correction.previous_status,
      correction_note: correction.correction_note,
      cancelled_at: correction.cancelled_at,
      current_state: workflow.current_state,
      approval_type: workflow.approval_type,
      module_code: workflow.module_code,
      resource_code: workflow.resource_code,
      action_code: workflow.action_code,
      requester_work_context_id: workflow.requester_work_context_id,
      created_at: correction.created_at,
      decision_history: decisions.map((d) => ({
        stage_number: d.stage_number,
        decision: d.decision,
        decided_at: d.decided_at,
        approver_auth_user_id: d.approver_auth_user_id,
        approver_display: buildUserDisplay(identityMap.get(d.approver_auth_user_id) ?? null),
      })),
    };
  });
}

// ---------------------------------------------------------------------------
// Handler 1 — Submit Correction Request
// POST /api/hr/attendance/correction/submit
//
// HR submits a correction request for an employee's day record.
// Goes through the approval workflow — does NOT immediately update day records.
// Requires: HR_ATTENDANCE_MANUAL_CORRECTION WRITE
// ---------------------------------------------------------------------------

export async function submitCorrectionRequestHandler(
  req: Request,
  ctx: HrHandlerContext,
): Promise<Response> {
  try {
    assertHrBusinessContext(ctx);

    const companyId = ctx.context.companyId;
    const workContextId = ctx.context.workContextId;

    const denied = await assertCorrectionSubmitPermission(ctx, companyId, workContextId);
    if (denied) return denied;

    const body = await req.json().catch(() => ({}));

    const targetEmployeeId = String(body?.target_employee_id ?? "").trim();
    if (!targetEmployeeId) {
      return errorResponse("TARGET_EMPLOYEE_REQUIRED", "target_employee_id is required", ctx.request_id, "NONE", 400);
    }

    const targetDate = normalizeIsoDate(body?.target_date);

    const requestedStatus = String(body?.requested_status ?? "").trim().toUpperCase();
    if (!CORRECTABLE_STATUSES.has(requestedStatus)) {
      return errorResponse(
        "CORRECTION_STATUS_INVALID",
        "requested_status must be one of: PRESENT, ABSENT, MISS_PUNCH",
        ctx.request_id, "NONE", 400,
      );
    }

    const correctionNote = String(body?.correction_note ?? "").trim();
    if (!correctionNote) {
      return errorResponse("CORRECTION_NOTE_REQUIRED", "correction_note is required", ctx.request_id, "NONE", 400);
    }

    // Snapshot current status for audit / display
    const { data: existingRecord } = await serviceRoleClient
      .schema("erp_hr")
      .from("employee_day_records")
      .select("declared_status")
      .eq("company_id", companyId)
      .eq("employee_auth_user_id", targetEmployeeId)
      .eq("record_date", targetDate)
      .maybeSingle();

    const previousStatus = existingRecord?.declared_status ?? null;

    // Resolve approval config for the correction inbox resource
    const approvalConfig = await resolveApprovalConfig(
      ATTENDANCE_RESOURCE_CODES.correctionInbox,
      "APPROVE",
    );

    // Resolve requester work context (HR's own work context — they are the requester)
    const requesterWorkContext = await resolveRequesterSubjectWorkContext({
      authUserId: ctx.auth_user_id,
      parentCompanyId: companyId,
      explicitWorkContextId: null,
    });

    // Create workflow request
    const workflow = await createWorkflowRequest(
      companyId,
      ctx.auth_user_id,
      approvalConfig.project_id,
      approvalConfig.module_code,
      approvalConfig.approval_required,
      approvalConfig.approval_type,
      ATTENDANCE_RESOURCE_CODES.correctionInbox,
      requesterWorkContext.work_context_id,
    );

    // Create correction request row
    const { data: correctionRow, error: correctionError } = await serviceRoleClient
      .schema("erp_hr")
      .from("attendance_correction_requests")
      .insert({
        workflow_request_id: workflow.request_id,
        requester_auth_user_id: ctx.auth_user_id,
        parent_company_id: companyId,
        target_employee_id: targetEmployeeId,
        target_date: targetDate,
        requested_status: requestedStatus,
        previous_status: previousStatus,
        correction_note: correctionNote,
        created_by: ctx.auth_user_id,
      })
      .select("*")
      .single();

    if (correctionError || !correctionRow) {
      await deleteWorkflowRequest(workflow.request_id);
      return errorResponse("CORRECTION_REQUEST_CREATE_FAILED", "Failed to create correction request", ctx.request_id);
    }

    await appendWorkflowEvent({
      request_id: workflow.request_id,
      company_id: companyId,
      module_code: approvalConfig.module_code,
      event_type: "CREATE",
      actor_auth_user_id: ctx.auth_user_id,
      previous_state: null,
      new_state: workflow.current_state,
    });

    return okResponse(
      {
        correction_request: {
          ...correctionRow,
          current_state: workflow.current_state,
          approval_type: approvalConfig.approval_type,
        },
      },
      ctx.request_id,
    );
  } catch (_err) {
    return errorResponse("CORRECTION_SUBMIT_ERROR", "Unexpected error submitting correction request", ctx.request_id);
  }
}

// ---------------------------------------------------------------------------
// Handler 2 — List HR's own pending/submitted corrections
// GET /api/hr/attendance/correction/my-requests
//
// HR sees all correction requests they submitted for their company.
// Requires: HR_ATTENDANCE_MANUAL_CORRECTION WRITE (same as submit)
// ---------------------------------------------------------------------------

export async function listPendingCorrectionsHandler(
  _req: Request,
  ctx: HrHandlerContext,
): Promise<Response> {
  try {
    assertHrBusinessContext(ctx);

    const companyId = ctx.context.companyId;
    const workContextId = ctx.context.workContextId;

    const denied = await assertCorrectionSubmitPermission(ctx, companyId, workContextId);
    if (denied) return denied;

    const pairs = await loadCorrectionRows({
      parentCompanyId: companyId,
      requesterAuthUserId: ctx.auth_user_id,
    });

    const cases = await buildCorrectionCases(pairs);

    return okResponse({ requests: cases }, ctx.request_id);
  } catch (_err) {
    return errorResponse("CORRECTION_LIST_ERROR", "Unexpected error listing correction requests", ctx.request_id);
  }
}

// ---------------------------------------------------------------------------
// Handler 3 — Get Correction Request Detail
// GET /api/hr/attendance/correction/detail?correction_request_id=UUID
//
// Used by both HR (submitter) and the approver (Plant Manager).
// No separate ACL check — either WRITE (HR) or APPROVE (approver) would grant access.
// We check that the caller is either the requester or an approver for the company.
// ---------------------------------------------------------------------------

export async function getCorrectionRequestDetailHandler(
  req: Request,
  ctx: HrHandlerContext,
): Promise<Response> {
  try {
    assertHrBusinessContext(ctx);

    const companyId = ctx.context.companyId;
    const url = new URL(req.url);
    const correctionRequestId = url.searchParams.get("correction_request_id")?.trim() ?? "";

    if (!correctionRequestId) {
      return errorResponse("CORRECTION_REQUEST_ID_REQUIRED", "correction_request_id is required", ctx.request_id, "NONE", 400);
    }

    const { data: correctionRow, error } = await serviceRoleClient
      .schema("erp_hr")
      .from("attendance_correction_requests")
      .select("*")
      .eq("correction_request_id", correctionRequestId)
      .eq("parent_company_id", companyId)
      .maybeSingle();

    if (error || !correctionRow) {
      return errorResponse("CORRECTION_REQUEST_NOT_FOUND", "Correction request not found", ctx.request_id, "NONE", 404);
    }

    const pairs = await loadCorrectionRows({ parentCompanyId: companyId });
    const pair = pairs.find((p) => p.correction.correction_request_id === correctionRequestId);
    if (!pair) {
      return errorResponse("CORRECTION_REQUEST_NOT_FOUND", "Correction request not found", ctx.request_id, "NONE", 404);
    }

    const [caseData] = await buildCorrectionCases([pair]);

    return okResponse({ request: caseData }, ctx.request_id);
  } catch (_err) {
    return errorResponse("CORRECTION_DETAIL_ERROR", "Unexpected error fetching correction detail", ctx.request_id);
  }
}

// ---------------------------------------------------------------------------
// Handler 4 — Correction Approval Inbox
// GET /api/hr/attendance/correction/approval-inbox
//
// Plant Manager sees all PENDING correction requests they can act on.
// Requires: HR_ATTENDANCE_CORRECTION_INBOX APPROVE
// ---------------------------------------------------------------------------

export async function listCorrectionApprovalInboxHandler(
  _req: Request,
  ctx: HrHandlerContext,
): Promise<Response> {
  try {
    assertHrBusinessContext(ctx);

    const companyId = ctx.context.companyId;
    const workContextId = ctx.context.workContextId;

    const denied = await assertCorrectionInboxPermission(ctx, companyId, workContextId);
    if (denied) return denied;

    const moduleBinding = await getModuleBindingForResource(ATTENDANCE_RESOURCE_CODES.correctionInbox);
    const pairs = await loadCorrectionRows({ parentCompanyId: companyId });
    const cases = await buildCorrectionCases(pairs);
    const approverRows = await loadApproverRulesForCompanyModule(
      companyId,
      moduleBinding.module_code,
    );

    const actionableCases = cases.filter((row) => {
      if (row.current_state !== "PENDING") return false;

      const scopedApprovers = pickScopedApprovers(
        {
          resource_code: row.resource_code,
          action_code: row.action_code,
          requester_auth_user_id: row.requester_auth_user_id,
          requester_work_context_id: row.requester_work_context_id,
          requester_department_work_context_id: null,
        },
        approverRows,
      );

      return isActionableForApprover({
        workflow: { approval_type: row.approval_type },
        requesterAuthUserId: row.requester_auth_user_id,
        scopedApprovers,
        decisions: row.decision_history.map((d) => ({
          request_id: row.workflow_request_id,
          stage_number: d.stage_number,
          approver_auth_user_id: d.approver_auth_user_id,
          decision: d.decision,
          decided_at: d.decided_at,
        })),
        authUserId: ctx.auth_user_id,
        roleCode: ctx.roleCode,
      });
    });

    return okResponse({ requests: actionableCases }, ctx.request_id);
  } catch (_err) {
    return errorResponse("CORRECTION_INBOX_ERROR", "Unexpected error loading correction inbox", ctx.request_id);
  }
}

// ---------------------------------------------------------------------------
// Handler 5 — Correction Approval History
// GET /api/hr/attendance/correction/approval-history
//
// Plant Manager sees all correction requests (any state) in their approval scope.
// Requires: HR_ATTENDANCE_CORRECTION_INBOX APPROVE
// ---------------------------------------------------------------------------

export async function listCorrectionApprovalHistoryHandler(
  _req: Request,
  ctx: HrHandlerContext,
): Promise<Response> {
  try {
    assertHrBusinessContext(ctx);

    const companyId = ctx.context.companyId;
    const workContextId = ctx.context.workContextId;

    const denied = await assertCorrectionInboxPermission(ctx, companyId, workContextId);
    if (denied) return denied;

    const moduleBinding = await getModuleBindingForResource(ATTENDANCE_RESOURCE_CODES.correctionInbox);
    const pairs = await loadCorrectionRows({ parentCompanyId: companyId });
    const cases = await buildCorrectionCases(pairs);
    const approverRows = await loadApproverRulesForCompanyModule(
      companyId,
      moduleBinding.module_code,
    );

    const scopedHistory = cases.filter((row) => {
      const scopedApprovers = pickScopedApprovers(
        {
          resource_code: row.resource_code,
          action_code: row.action_code,
          requester_auth_user_id: row.requester_auth_user_id,
          requester_work_context_id: row.requester_work_context_id,
          requester_department_work_context_id: null,
        },
        approverRows,
      );

      return scopedApprovers.some((approver) =>
        isApproverMatch(approver, ctx.auth_user_id, ctx.roleCode)
      );
    });

    return okResponse({ requests: scopedHistory }, ctx.request_id);
  } catch (_err) {
    return errorResponse("CORRECTION_HISTORY_ERROR", "Unexpected error loading correction history", ctx.request_id);
  }
}

// ---------------------------------------------------------------------------
// applyCorrectionToDateRecord
// Called by process_decision.handler.ts (Step 10.5) when a correction
// workflow_request transitions to APPROVED.
// Silently no-ops if the workflow_request_id is not a correction request.
// Non-fatal: approval must never fail due to day record update failure.
// ---------------------------------------------------------------------------

export async function applyCorrectionToDateRecord(
  workflowRequestId: string,
  approverAuthUserId: string,
): Promise<void> {
  const { data: cr } = await serviceRoleClient
    .schema("erp_hr")
    .from("attendance_correction_requests")
    .select("parent_company_id, target_employee_id, target_date, requested_status, correction_note")
    .eq("workflow_request_id", workflowRequestId)
    .maybeSingle();

  if (!cr) return; // Not a correction request — silently no-op

  const now = new Date().toISOString();

  // Check if day record already exists
  const { data: existing } = await serviceRoleClient
    .schema("erp_hr")
    .from("employee_day_records")
    .select("day_record_id, declared_status")
    .eq("company_id", cr.parent_company_id)
    .eq("employee_auth_user_id", cr.target_employee_id)
    .eq("record_date", cr.target_date)
    .maybeSingle();

  if (existing) {
    await serviceRoleClient
      .schema("erp_hr")
      .from("employee_day_records")
      .update({
        declared_status:    cr.requested_status,
        manually_corrected: true,
        corrected_by:       approverAuthUserId,
        corrected_at:       now,
        correction_note:    cr.correction_note,
        previous_status:    existing.declared_status,
        updated_at:         now,
      })
      .eq("day_record_id", existing.day_record_id);
  } else {
    await serviceRoleClient
      .schema("erp_hr")
      .from("employee_day_records")
      .insert({
        company_id:            cr.parent_company_id,
        employee_auth_user_id: cr.target_employee_id,
        record_date:           cr.target_date,
        declared_status:       cr.requested_status,
        source:                "MANUAL_HR",
        manually_corrected:    true,
        corrected_by:          approverAuthUserId,
        corrected_at:          now,
        correction_note:       cr.correction_note,
        previous_status:       null,
        created_at:            now,
        updated_at:            now,
      });
  }
}
