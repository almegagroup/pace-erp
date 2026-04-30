/*
 * File-ID: 8.4-HR-CORR
 * File-Path: supabase/functions/api/_core/hr/attendance_correction.handlers.ts
 * Gate: 8
 * Phase: 4-B
 * Domain: HR
 * Purpose: HR attendance correction — backdated leave/out-work apply on behalf
 *          of an employee, plus day-records listing for the correction UI.
 * Authority: Backend
 */

import { okResponse, errorResponse } from "../response.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { getActiveAclVersionIdForCompany } from "../../_shared/acl_runtime.ts";
import { readAclSnapshotDecision } from "../../_shared/acl_snapshot.ts";
import {
  ATTENDANCE_RESOURCE_CODES,
  LEAVE_RESOURCE_CODES,
  OUT_WORK_RESOURCE_CODES,
  appendWorkflowEvent,
  assertHrBusinessContext,
  calculateInclusiveDays,
  computeSandwichLeave,
  createWorkflowRequest,
  deleteWorkflowRequest,
  ensureNoDuplicateLeaveRequest,
  ensureNoDuplicateOutWorkRequest,
  getParentCompanyScope,
  loadUserIdentityMap,
  normalizeIsoDate,
  resolveApprovalConfig,
  resolveRequesterSubjectWorkContext,
  todayIsoInKolkata,
  type HrHandlerContext,
  type UserIdentity,
} from "./shared.ts";

// ---------------------------------------------------------------------------
// Internal: ACL guard for backdated leave apply
// ---------------------------------------------------------------------------

async function assertBackdatedLeavePermission(
  ctx: HrHandlerContext,
  companyId: string,
  workContextId: string,
): Promise<Response | null> {
  const aclVersionId = await getActiveAclVersionIdForCompany(
    serviceRoleClient,
    companyId,
  );

  const { data: aclDecision } = await readAclSnapshotDecision({
    db: serviceRoleClient,
    aclVersionId,
    authUserId: ctx.auth_user_id,
    companyId,
    workContextId,
    resourceCode: LEAVE_RESOURCE_CODES.backdatedApply,
    actionCode: "WRITE",
  });

  if (!aclDecision || aclDecision.decision !== "ALLOW") {
    return errorResponse(
      "BACKDATED_LEAVE_FORBIDDEN",
      "permission denied — HR_LEAVE_BACKDATED_APPLY required",
      ctx.request_id,
      "NONE",
      403,
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// Internal: ACL guard for backdated out-work apply
// ---------------------------------------------------------------------------

async function assertBackdatedOutWorkPermission(
  ctx: HrHandlerContext,
  companyId: string,
  workContextId: string,
): Promise<Response | null> {
  const aclVersionId = await getActiveAclVersionIdForCompany(
    serviceRoleClient,
    companyId,
  );

  const { data: aclDecision } = await readAclSnapshotDecision({
    db: serviceRoleClient,
    aclVersionId,
    authUserId: ctx.auth_user_id,
    companyId,
    workContextId,
    resourceCode: OUT_WORK_RESOURCE_CODES.backdatedApply,
    actionCode: "WRITE",
  });

  if (!aclDecision || aclDecision.decision !== "ALLOW") {
    return errorResponse(
      "BACKDATED_OUT_WORK_FORBIDDEN",
      "permission denied — HR_OUT_WORK_BACKDATED_APPLY required",
      ctx.request_id,
      "NONE",
      403,
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// Internal: validate leave_type_id belongs to company and is active
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Handler 1 — HR backdated leave apply on behalf of employee
// POST /api/hr/leave/backdated-apply
//
// Requires: HR_LEAVE_BACKDATED_APPLY WRITE
// Key difference from normal apply: no backdate limit; target_employee_id
// sets requester; applied_by_auth_user_id = ctx.auth_user_id.
// ---------------------------------------------------------------------------

export async function hrBackdatedLeaveApplyHandler(
  req: Request,
  ctx: HrHandlerContext,
): Promise<Response> {
  const routeKey = "POST:/api/hr/leave/backdated-apply";

  try {
    assertHrBusinessContext(ctx);

    const companyId = ctx.context.companyId;
    const workContextId = ctx.context.workContextId;

    // ACL gate
    const aclDenied = await assertBackdatedLeavePermission(ctx, companyId, workContextId);
    if (aclDenied) return aclDenied;

    const body = await req.json().catch(() => ({}));

    const targetEmployeeId = String(body?.target_employee_id ?? "").trim();
    if (!targetEmployeeId) {
      return errorResponse(
        "TARGET_EMPLOYEE_REQUIRED",
        "target_employee_id is required",
        ctx.request_id,
        "NONE",
        400,
        { gateId: "HR.LEAVE", routeKey, decisionTrace: "TARGET_EMPLOYEE_REQUIRED" },
      );
    }

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

    const fromDate = normalizeIsoDate(body?.from_date);
    const toDate = normalizeIsoDate(body?.to_date);
    const reason = String(body?.reason ?? "").trim();

    if (!reason) {
      return errorResponse(
        "LEAVE_REASON_REQUIRED",
        "leave reason required",
        ctx.request_id,
        "NONE",
        400,
        { gateId: "HR.LEAVE", routeKey, decisionTrace: "LEAVE_REASON_REQUIRED" },
      );
    }

    if (toDate < fromDate) {
      return errorResponse(
        "LEAVE_DATE_RANGE_INVALID",
        "to date must be after from date",
        ctx.request_id,
        "NONE",
        400,
        { gateId: "HR.LEAVE", routeKey, decisionTrace: "LEAVE_DATE_RANGE_INVALID" },
      );
    }

    // No backdate limit for HR backdated apply — intentional

    const parentCompany = await getParentCompanyScope(targetEmployeeId, companyId);

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

    // Resolve work context for the target employee (not the HR actor)
    const explicitRequesterWorkContextId =
      String(body?.requester_work_context_id ?? "").trim() || null;
    const requesterWorkContext = await resolveRequesterSubjectWorkContext({
      authUserId: targetEmployeeId,
      parentCompanyId: parentCompany.company_id,
      explicitWorkContextId: explicitRequesterWorkContextId,
    });
    const approvalConfig = await resolveApprovalConfig(
      LEAVE_RESOURCE_CODES.apply,
      "WRITE",
    );

    await ensureNoDuplicateLeaveRequest({
      requesterAuthUserId: targetEmployeeId,
      parentCompanyId: parentCompany.company_id,
      fromDate,
      toDate,
    });

    // Workflow requester = target employee; actor who submitted = HR user
    const workflow = await createWorkflowRequest(
      parentCompany.company_id,
      targetEmployeeId,
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
        requester_auth_user_id: targetEmployeeId,
        parent_company_id: parentCompany.company_id,
        leave_type_id: leaveTypeIdRaw,
        applied_by_auth_user_id: ctx.auth_user_id,
        requester_work_context_id: requesterWorkContext.work_context_id,
        from_date: fromDate,
        to_date: toDate,
        total_days: totalDays,
        effective_leave_days: effectiveLeaveDays,
        reason,
        created_by: ctx.auth_user_id,
      })
      .select(
        "leave_request_id, workflow_request_id, requester_auth_user_id, parent_company_id, leave_type_id, applied_by_auth_user_id, from_date, to_date, total_days, effective_leave_days, reason, cancelled_at, cancelled_by, created_at",
      )
      .single();

    if (leaveError || !leaveRow) {
      await deleteWorkflowRequest(workflow.request_id);
      throw new Error("LEAVE_REQUEST_CREATE_FAILED");
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
          ...leaveRow,
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
    const msg = err instanceof Error ? err.message : String(err);

    if (msg === "LEAVE_DUPLICATE_DATE_RANGE") {
      return errorResponse(
        "LEAVE_DUPLICATE_DATE_RANGE",
        "A leave request already exists for this employee covering the selected date range",
        ctx.request_id,
        "NONE",
        409,
      );
    }

    return errorResponse(
      "BACKDATED_LEAVE_APPLY_ERROR",
      "Unexpected error during backdated leave apply",
      ctx.request_id,
    );
  }
}

// ---------------------------------------------------------------------------
// Handler 2 — HR backdated out-work apply on behalf of employee
// POST /api/hr/out-work/backdated-apply
//
// Requires: HR_OUT_WORK_BACKDATED_APPLY WRITE
// Key difference from normal apply: no backdate limit; target_employee_id
// sets requester; applied_by_auth_user_id = ctx.auth_user_id.
// ---------------------------------------------------------------------------

export async function hrBackdatedOutWorkApplyHandler(
  req: Request,
  ctx: HrHandlerContext,
): Promise<Response> {
  const routeKey = "POST:/api/hr/out-work/backdated-apply";

  try {
    assertHrBusinessContext(ctx);

    const companyId = ctx.context.companyId;
    const workContextId = ctx.context.workContextId;

    // ACL gate
    const aclDenied = await assertBackdatedOutWorkPermission(ctx, companyId, workContextId);
    if (aclDenied) return aclDenied;

    const body = await req.json().catch(() => ({}));

    const targetEmployeeId = String(body?.target_employee_id ?? "").trim();
    if (!targetEmployeeId) {
      return errorResponse(
        "TARGET_EMPLOYEE_REQUIRED",
        "target_employee_id is required",
        ctx.request_id,
        "NONE",
        400,
      );
    }

    const fromDate = normalizeIsoDate(body?.from_date);
    const toDate = normalizeIsoDate(body?.to_date);
    const reason = String(body?.reason ?? "").trim();
    const destinationId = String(body?.destination_id ?? "").trim();
    const inlineDestinationName = String(body?.destination_name ?? "").trim();
    const inlineDestinationAddress = String(body?.destination_address ?? "").trim();

    // Partial day scope
    const rawDayScope = String(body?.day_scope ?? "").trim().toUpperCase() || "FULL_DAY";
    if (!["FULL_DAY", "PARTIAL_DAY"].includes(rawDayScope)) {
      return errorResponse(
        "OUT_WORK_DAY_SCOPE_INVALID",
        "day_scope must be FULL_DAY or PARTIAL_DAY",
        ctx.request_id,
        "NONE",
        400,
      );
    }
    const dayScope = rawDayScope as "FULL_DAY" | "PARTIAL_DAY";
    const rawDepartureTime = String(body?.office_departure_time ?? "").trim() || null;

    if (!reason) {
      return errorResponse(
        "OUT_WORK_REASON_REQUIRED",
        "out work reason required",
        ctx.request_id,
        "NONE",
        400,
      );
    }

    if (toDate < fromDate) {
      return errorResponse(
        "OUT_WORK_DATE_RANGE_INVALID",
        "to date must be after from date",
        ctx.request_id,
        "NONE",
        400,
      );
    }

    // Partial day: single date only + departure time required
    let officeDepartureTime: string | null = null;
    if (dayScope === "PARTIAL_DAY") {
      if (fromDate !== toDate) {
        return errorResponse(
          "OUT_WORK_PARTIAL_DAY_SINGLE_DATE_ONLY",
          "partial day out-work must be for a single date (from_date must equal to_date)",
          ctx.request_id,
          "NONE",
          400,
        );
      }
      if (!rawDepartureTime || !/^\d{2}:\d{2}$/.test(rawDepartureTime)) {
        return errorResponse(
          "OUT_WORK_DEPARTURE_TIME_REQUIRED",
          "office_departure_time (HH:MM) is required for partial day out-work",
          ctx.request_id,
          "NONE",
          400,
        );
      }
      officeDepartureTime = rawDepartureTime;
    }

    // No backdate limit for HR backdated apply — intentional

    const parentCompany = await getParentCompanyScope(targetEmployeeId, companyId);
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
          "NONE",
          400,
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
          "NONE",
          400,
        );
      }
      resolvedDestinationName = inlineDestinationName;
      resolvedDestinationAddress = inlineDestinationAddress;
    }

    const totalDays = calculateInclusiveDays(fromDate, toDate);
    const explicitRequesterWorkContextId =
      String(body?.requester_work_context_id ?? "").trim() || null;
    const requesterWorkContext = await resolveRequesterSubjectWorkContext({
      authUserId: targetEmployeeId,
      parentCompanyId: parentCompany.company_id,
      explicitWorkContextId: explicitRequesterWorkContextId,
    });
    const approvalConfig = await resolveApprovalConfig(
      OUT_WORK_RESOURCE_CODES.apply,
      "WRITE",
    );

    await ensureNoDuplicateOutWorkRequest({
      requesterAuthUserId: targetEmployeeId,
      parentCompanyId: parentCompany.company_id,
      fromDate,
      toDate,
      destinationId: resolvedDestinationId,
      destinationName: resolvedDestinationName,
      destinationAddress: resolvedDestinationAddress,
    });

    // Workflow requester = target employee; actor who submitted = HR user
    const workflow = await createWorkflowRequest(
      parentCompany.company_id,
      targetEmployeeId,
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
        requester_auth_user_id: targetEmployeeId,
        parent_company_id: parentCompany.company_id,
        requester_work_context_id: requesterWorkContext.work_context_id,
        destination_id: resolvedDestinationId,
        destination_name: resolvedDestinationName,
        destination_address: resolvedDestinationAddress,
        from_date: fromDate,
        to_date: toDate,
        total_days: totalDays,
        reason,
        day_scope: dayScope,
        office_departure_time: officeDepartureTime,
        applied_by_auth_user_id: ctx.auth_user_id,
        created_by: ctx.auth_user_id,
      })
      .select(
        "out_work_request_id, workflow_request_id, requester_auth_user_id, parent_company_id, destination_id, destination_name, destination_address, from_date, to_date, total_days, reason, day_scope, office_departure_time, applied_by_auth_user_id, cancelled_at, cancelled_by, created_at",
      )
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
    const msg = err instanceof Error ? err.message : String(err);

    if (msg === "OUT_WORK_DUPLICATE_DATE_RANGE") {
      return errorResponse(
        "OUT_WORK_DUPLICATE_DATE_RANGE",
        "An out-work request already exists for this employee covering the selected date range",
        ctx.request_id,
        "NONE",
        409,
      );
    }

    return errorResponse(
      "BACKDATED_OUT_WORK_APPLY_ERROR",
      "Unexpected error during backdated out-work apply",
      ctx.request_id,
    );
  }
}

// ---------------------------------------------------------------------------
// Handler 3 — List day records for an employee (HR attendance correction view)
// GET /api/hr/attendance/day-records
//
// Requires: HR_LEAVE_BACKDATED_APPLY WRITE (attendance correction context)
// Query params: employee_id (required), from_date (YYYY-MM-DD), to_date (YYYY-MM-DD)
// Returns records sorted by date ascending, enriched with applied_by display.
// ---------------------------------------------------------------------------

export async function listDayRecordsByEmployeeHandler(
  req: Request,
  ctx: HrHandlerContext,
): Promise<Response> {
  try {
    assertHrBusinessContext(ctx);

    const companyId = ctx.context.companyId;
    const workContextId = ctx.context.workContextId;

    // ACL gate — same permission as backdated leave apply
    const aclDenied = await assertBackdatedLeavePermission(ctx, companyId, workContextId);
    if (aclDenied) return aclDenied;

    const url = new URL(req.url);
    const employeeIdRaw = url.searchParams.get("employee_id")?.trim() ?? "";
    const fromDateRaw = url.searchParams.get("from_date")?.trim() ?? "";
    const toDateRaw = url.searchParams.get("to_date")?.trim() ?? "";

    if (!employeeIdRaw) {
      return errorResponse(
        "EMPLOYEE_ID_REQUIRED",
        "employee_id query param is required",
        ctx.request_id,
        "NONE",
        400,
      );
    }

    // Resolve employee: accept UUID or user_code (e.g. "P0003")
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    let targetEmployeeId: string;
    if (UUID_RE.test(employeeIdRaw)) {
      targetEmployeeId = employeeIdRaw;
    } else {
      const { data: userRow } = await serviceRoleClient
        .schema("erp_core")
        .from("users")
        .select("auth_user_id")
        .ilike("user_code", employeeIdRaw)
        .maybeSingle();
      if (!userRow?.auth_user_id) {
        return errorResponse(
          "EMPLOYEE_NOT_FOUND",
          `No employee found with code "${employeeIdRaw}"`,
          ctx.request_id,
          "NONE",
          404,
        );
      }
      targetEmployeeId = userRow.auth_user_id;
    }

    const fromDate = normalizeIsoDate(fromDateRaw);
    const toDate = normalizeIsoDate(toDateRaw);

    if (toDate < fromDate) {
      return errorResponse(
        "DATE_RANGE_INVALID",
        "to_date must be >= from_date",
        ctx.request_id,
        "NONE",
        400,
      );
    }

    // -----------------------------------------------------------------------
    // Fetch day records for the employee in the requested date range
    // -----------------------------------------------------------------------

    const { data: records, error: recordsError } = await serviceRoleClient
      .schema("erp_hr")
      .from("employee_day_records")
      .select(
        "day_record_id, record_date, declared_status, source, leave_request_id, leave_type_id, out_work_request_id, out_work_day_scope, out_work_departure_time, manually_corrected, corrected_by, corrected_at, correction_note, previous_status",
      )
      .eq("company_id", companyId)
      .eq("employee_auth_user_id", targetEmployeeId)
      .gte("record_date", fromDate)
      .lte("record_date", toDate)
      .order("record_date", { ascending: true });

    if (recordsError) {
      return errorResponse(
        "DAY_RECORDS_FETCH_FAILED",
        "Failed to fetch day records",
        ctx.request_id,
      );
    }

    const rows = records ?? [];

    // -----------------------------------------------------------------------
    // Batch-fetch applied_by from leave_requests and out_work_requests
    // -----------------------------------------------------------------------

    const leaveRequestIds = rows
      .filter((r) => r.leave_request_id)
      .map((r) => r.leave_request_id as string);
    const outWorkRequestIds = rows
      .filter((r) => r.out_work_request_id)
      .map((r) => r.out_work_request_id as string);

    // applied_by maps: request_id → applied_by_auth_user_id
    const leaveAppliedByMap = new Map<string, string | null>();
    const outWorkAppliedByMap = new Map<string, string | null>();

    if (leaveRequestIds.length > 0) {
      const { data: leaveRows } = await serviceRoleClient
        .schema("erp_hr")
        .from("leave_requests")
        .select("leave_request_id, applied_by_auth_user_id")
        .in("leave_request_id", leaveRequestIds);

      for (const row of leaveRows ?? []) {
        leaveAppliedByMap.set(row.leave_request_id, row.applied_by_auth_user_id ?? null);
      }
    }

    if (outWorkRequestIds.length > 0) {
      const { data: owRows } = await serviceRoleClient
        .schema("erp_hr")
        .from("out_work_requests")
        .select("out_work_request_id, applied_by_auth_user_id")
        .in("out_work_request_id", outWorkRequestIds);

      for (const row of owRows ?? []) {
        outWorkAppliedByMap.set(row.out_work_request_id, row.applied_by_auth_user_id ?? null);
      }
    }

    // -----------------------------------------------------------------------
    // Build identity map for all unique applied_by user IDs
    // -----------------------------------------------------------------------

    const appliedByIds = new Set<string>();
    for (const id of leaveAppliedByMap.values()) {
      if (id) appliedByIds.add(id);
    }
    for (const id of outWorkAppliedByMap.values()) {
      if (id) appliedByIds.add(id);
    }

    const identityMap: Map<string, UserIdentity> = appliedByIds.size > 0
      ? await loadUserIdentityMap([...appliedByIds])
      : new Map();

    // -----------------------------------------------------------------------
    // Enrich and return
    // -----------------------------------------------------------------------

    const enriched = rows.map((r) => {
      let appliedByUserId: string | null = null;
      let appliedByDisplay: string | null = null;

      if (r.leave_request_id) {
        appliedByUserId = leaveAppliedByMap.get(r.leave_request_id) ?? null;
      } else if (r.out_work_request_id) {
        appliedByUserId = outWorkAppliedByMap.get(r.out_work_request_id) ?? null;
      }

      if (appliedByUserId) {
        const identity = identityMap.get(appliedByUserId);
        appliedByDisplay = identity?.name ?? identity?.user_code ?? appliedByUserId;
      }

      return {
        ...r,
        applied_by_auth_user_id: appliedByUserId,
        applied_by_display: appliedByDisplay,
      };
    });

    return okResponse(
      { records: enriched, total: enriched.length },
      ctx.request_id,
    );
  } catch (_err) {
    return errorResponse(
      "DAY_RECORDS_ERROR",
      "Unexpected error fetching day records",
      ctx.request_id,
    );
  }
}

// ---------------------------------------------------------------------------
// Handler 4 — Manual attendance correction
// POST /api/hr/attendance/correct
//
// Requires: HR_ATTENDANCE_MANUAL_CORRECTION WRITE
// Body: { employee_id, record_date, new_status, correction_note }
//
// Allowed new_status values: PRESENT | ABSENT | MISS_PUNCH
// Blocked: LEAVE, OUT_WORK, HOLIDAY, WEEK_OFF — these must go through their
//          own workflows / calendar management.
//
// Behaviour:
//   - Existing row → UPDATE declared_status; capture previous_status in audit
//   - No existing row → INSERT with source = MANUAL_HR
//   - Always sets: manually_corrected = true, corrected_by, corrected_at,
//     correction_note, previous_status
// ---------------------------------------------------------------------------

const MANUAL_CORRECTION_ALLOWED_STATUSES = new Set([
  "PRESENT",
  "ABSENT",
  "MISS_PUNCH",
]);

export async function manualCorrectDayRecordHandler(
  req: Request,
  ctx: HrHandlerContext,
): Promise<Response> {
  try {
    assertHrBusinessContext(ctx);

    const companyId = ctx.context.companyId;
    const workContextId = ctx.context.workContextId;

    // ACL gate
    const aclVersionId = await getActiveAclVersionIdForCompany(
      serviceRoleClient,
      companyId,
    );
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
        "MANUAL_CORRECTION_FORBIDDEN",
        "permission denied — HR_ATTENDANCE_MANUAL_CORRECTION required",
        ctx.request_id,
        "NONE",
        403,
      );
    }

    const body = await req.json().catch(() => ({}));

    const targetEmployeeId = String(body?.employee_id ?? "").trim();
    if (!targetEmployeeId) {
      return errorResponse(
        "EMPLOYEE_ID_REQUIRED",
        "employee_id is required",
        ctx.request_id,
        "NONE",
        400,
      );
    }

    const recordDate = normalizeIsoDate(body?.record_date);

    const newStatus = String(body?.new_status ?? "").trim().toUpperCase();
    if (!MANUAL_CORRECTION_ALLOWED_STATUSES.has(newStatus)) {
      return errorResponse(
        "CORRECTION_STATUS_INVALID",
        "new_status must be one of: PRESENT, ABSENT, MISS_PUNCH — LEAVE and OUT_WORK must go through their own workflows",
        ctx.request_id,
        "NONE",
        400,
      );
    }

    const correctionNote = String(body?.correction_note ?? "").trim();
    if (!correctionNote) {
      return errorResponse(
        "CORRECTION_NOTE_REQUIRED",
        "correction_note is required",
        ctx.request_id,
        "NONE",
        400,
      );
    }

    // -----------------------------------------------------------------------
    // Check for existing day record
    // -----------------------------------------------------------------------

    const { data: existing, error: fetchError } = await serviceRoleClient
      .schema("erp_hr")
      .from("employee_day_records")
      .select("day_record_id, declared_status, source")
      .eq("company_id", companyId)
      .eq("employee_auth_user_id", targetEmployeeId)
      .eq("record_date", recordDate)
      .maybeSingle();

    if (fetchError) {
      return errorResponse(
        "DAY_RECORD_FETCH_FAILED",
        "Failed to fetch existing day record",
        ctx.request_id,
      );
    }

    const now = new Date().toISOString();

    if (existing) {
      // -----------------------------------------------------------------------
      // UPDATE existing row — capture previous_status for audit
      // -----------------------------------------------------------------------

      const previousStatus = existing.declared_status;

      const { data: updated, error: updateError } = await serviceRoleClient
        .schema("erp_hr")
        .from("employee_day_records")
        .update({
          declared_status:   newStatus,
          manually_corrected: true,
          corrected_by:      ctx.auth_user_id,
          corrected_at:      now,
          correction_note:   correctionNote,
          previous_status:   previousStatus,
          updated_at:        now,
        })
        .eq("day_record_id", existing.day_record_id)
        .select(
          "day_record_id, record_date, declared_status, source, manually_corrected, corrected_by, corrected_at, correction_note, previous_status",
        )
        .single();

      if (updateError || !updated) {
        return errorResponse(
          "DAY_RECORD_UPDATE_FAILED",
          "Failed to update day record",
          ctx.request_id,
        );
      }

      return okResponse({ record: updated, action: "UPDATED" }, ctx.request_id);

    } else {
      // -----------------------------------------------------------------------
      // INSERT new row — no previous record existed
      // -----------------------------------------------------------------------

      const { data: inserted, error: insertError } = await serviceRoleClient
        .schema("erp_hr")
        .from("employee_day_records")
        .insert({
          company_id:           companyId,
          employee_auth_user_id: targetEmployeeId,
          record_date:          recordDate,
          declared_status:      newStatus,
          source:               "MANUAL_HR",
          manually_corrected:   true,
          corrected_by:         ctx.auth_user_id,
          corrected_at:         now,
          correction_note:      correctionNote,
          previous_status:      null,
          created_at:           now,
          updated_at:           now,
        })
        .select(
          "day_record_id, record_date, declared_status, source, manually_corrected, corrected_by, corrected_at, correction_note, previous_status",
        )
        .single();

      if (insertError || !inserted) {
        return errorResponse(
          "DAY_RECORD_INSERT_FAILED",
          "Failed to create day record",
          ctx.request_id,
        );
      }

      return okResponse({ record: inserted, action: "CREATED" }, ctx.request_id);
    }

  } catch (_err) {
    return errorResponse(
      "MANUAL_CORRECTION_ERROR",
      "Unexpected error during manual attendance correction",
      ctx.request_id,
    );
  }
}
