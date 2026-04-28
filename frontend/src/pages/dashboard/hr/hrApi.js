function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function shiftIsoDate(isoDate, deltaDays) {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + deltaDays);
  return date.toISOString().slice(0, 10);
}

export function calculateInclusiveDays(fromDate, toDate) {
  if (!fromDate || !toDate) {
    return 0;
  }

  const fromUtc = new Date(`${fromDate}T00:00:00.000Z`);
  const toUtc = new Date(`${toDate}T00:00:00.000Z`);
  const diffMs = toUtc.getTime() - fromUtc.getTime();
  if (Number.isNaN(diffMs) || diffMs < 0) {
    return 0;
  }

  return Math.floor(diffMs / 86400000) + 1;
}

export function getHrEarliestBackdate() {
  return shiftIsoDate(todayIso(), -3);
}

export function formatIsoDate(isoDate) {
  if (!isoDate) {
    return "-";
  }

  try {
    return new Intl.DateTimeFormat("en-IN", {
      year: "numeric",
      month: "short",
      day: "2-digit",
    }).format(new Date(`${isoDate}T00:00:00.000Z`));
  } catch {
    return isoDate;
  }
}

export function formatDateTime(isoDateTime) {
  if (!isoDateTime) {
    return "-";
  }

  try {
    return new Intl.DateTimeFormat("en-IN", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(isoDateTime));
  } catch {
    return isoDateTime;
  }
}

async function readJsonSafe(response) {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}

function createDebugError(json, fallbackCode, fallbackMessage) {
  return {
    code: json?.code ?? fallbackCode,
    requestId: json?.request_id ?? null,
    gateId: json?.gate_id ?? null,
    routeKey: json?.route_key ?? null,
    decisionTrace: json?.decision_trace ?? null,
    message: json?.message ?? fallbackMessage,
  };
}

function createNetworkError(error, fallbackCode, fallbackMessage) {
  return {
    code: fallbackCode,
    requestId: null,
    gateId: null,
    routeKey: null,
    decisionTrace: fallbackCode,
    message: error instanceof Error ? error.message : fallbackMessage,
  };
}

async function apiJson(
  path,
  options = {},
  fallbackCode = "REQUEST_FAILED",
  fallbackMessage = "Request failed",
) {
  let response;
  const headers = {
    ...(options.headers ?? {}),
  };

  if (options.companyId) {
    headers["x-company-id"] = options.companyId;
  }

  try {
    response = await fetch(`${import.meta.env.VITE_API_BASE}${path}`, {
      credentials: "include",
      ...options,
      headers,
    });
  } catch (error) {
    throw createNetworkError(error, `NETWORK_${fallbackCode}`, fallbackMessage);
  }

  const json = await readJsonSafe(response);

  if (!response.ok || !json?.ok) {
    throw createDebugError(json, fallbackCode, fallbackMessage);
  }

  return json.data;
}

async function apiWorkflowDecision(payload, companyId = null) {
  let response;

  const headers = { "Content-Type": "application/json" };
  if (companyId) {
    headers["x-company-id"] = companyId;
  }

  try {
    response = await fetch(`${import.meta.env.VITE_API_BASE}/api/workflow/decision`, {
      method: "POST",
      credentials: "include",
      headers,
      body: JSON.stringify(payload),
    });
  } catch (error) {
    throw createNetworkError(error, "NETWORK_WORKFLOW_DECISION_FAILED", "Workflow decision failed");
  }

  const json = await readJsonSafe(response);

  if (!response.ok) {
    throw createDebugError(json, "WORKFLOW_DECISION_FAILED", "Workflow decision failed");
  }

  return json;
}

export async function createLeaveRequest(payload, companyId = null) {
  return apiJson(
    "/api/hr/leave/request",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      companyId,
      body: JSON.stringify(payload),
    },
    "LEAVE_REQUEST_CREATE_FAILED",
    "Leave request could not be submitted.",
  );
}

export async function listMyLeaveRequests() {
  return apiJson(
    "/api/hr/leave/my-requests",
    {},
    "LEAVE_REQUEST_LIST_FAILED",
    "Leave request history could not be loaded.",
  );
}

export async function cancelLeaveRequest(leaveRequestId) {
  return apiJson(
    "/api/hr/leave/cancel",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        leave_request_id: leaveRequestId,
      }),
    },
    "LEAVE_REQUEST_CANCEL_FAILED",
    "Leave request could not be cancelled.",
  );
}

export async function updateLeaveRequest(payload) {
  return apiJson(
    "/api/hr/leave/update",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
    "LEAVE_REQUEST_UPDATE_FAILED",
    "Leave request could not be updated.",
  );
}

export async function listLeaveApprovalInbox() {
  return apiJson(
    "/api/hr/leave/approval-inbox",
    {},
    "LEAVE_APPROVAL_INBOX_FAILED",
    "Leave approval inbox could not be loaded.",
  );
}

export async function listLeaveApprovalHistory(requesterAuthUserId = "") {
  const query = requesterAuthUserId
    ? `?requester_auth_user_id=${encodeURIComponent(requesterAuthUserId)}`
    : "";

  return apiJson(
    `/api/hr/leave/approval-history${query}`,
    {},
    "LEAVE_APPROVAL_HISTORY_FAILED",
    "Leave approval history could not be loaded.",
  );
}

export async function listLeaveRegister(filters = {}) {
  const params = new URLSearchParams();
  if (filters?.requesterAuthUserId) {
    params.set("requester_auth_user_id", filters.requesterAuthUserId);
  }
  if (filters?.companyId) {
    params.set("company_id", filters.companyId);
  }
  if (filters?.fromDate) {
    params.set("from_date", filters.fromDate);
  }
  if (filters?.toDate) {
    params.set("to_date", filters.toDate);
  }
  if (filters?.leaveTypeCode) {
    params.set("leave_type_code", filters.leaveTypeCode);
  }
  const query = params.toString() ? `?${params.toString()}` : "";

  return apiJson(
    `/api/hr/leave/register${query}`,
    {},
    "LEAVE_REGISTER_FAILED",
    "Leave register could not be loaded.",
  );
}

export async function listLeaveTypes(companyId = null) {
  return apiJson(
    "/api/hr/leave/types",
    { companyId },
    "LEAVE_TYPES_LIST_FAILED",
    "Leave type list could not be loaded.",
  );
}

export async function listAllLeaveTypes() {
  return apiJson(
    "/api/hr/leave/types/all",
    {},
    "LEAVE_TYPES_LIST_ALL_FAILED",
    "Leave type list could not be loaded.",
  );
}

export async function createLeaveType(payload) {
  return apiJson(
    "/api/hr/leave/types",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "LEAVE_TYPE_CREATE_FAILED",
    "Leave type could not be created.",
  );
}

export async function updateLeaveType(payload) {
  return apiJson(
    "/api/hr/leave/types",
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "LEAVE_TYPE_UPDATE_FAILED",
    "Leave type could not be updated.",
  );
}

// ---------------------------------------------------------------------------
// Holiday Calendar
// ---------------------------------------------------------------------------

export async function listHolidays(year = null) {
  const query = year ? `?year=${encodeURIComponent(year)}` : "";
  return apiJson(
    `/api/hr/calendar/holidays${query}`,
    {},
    "HOLIDAY_LIST_FAILED",
    "Holiday calendar could not be loaded.",
  );
}

export async function createHoliday(payload) {
  return apiJson(
    "/api/hr/calendar/holidays",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "HOLIDAY_CREATE_FAILED",
    "Holiday could not be created.",
  );
}

export async function updateHoliday(payload) {
  return apiJson(
    "/api/hr/calendar/holidays",
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "HOLIDAY_UPDATE_FAILED",
    "Holiday could not be updated.",
  );
}

export async function deleteHoliday(holidayId) {
  return apiJson(
    `/api/hr/calendar/holidays?holiday_id=${encodeURIComponent(holidayId)}`,
    { method: "DELETE" },
    "HOLIDAY_DELETE_FAILED",
    "Holiday could not be deleted.",
  );
}

export async function getWeekOffConfig() {
  return apiJson(
    "/api/hr/calendar/week-off",
    {},
    "WEEK_OFF_CONFIG_GET_FAILED",
    "Week-off configuration could not be loaded.",
  );
}

export async function upsertWeekOffConfig(weekOffDays) {
  return apiJson(
    "/api/hr/calendar/week-off",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ week_off_days: weekOffDays }),
    },
    "WEEK_OFF_CONFIG_UPSERT_FAILED",
    "Week-off configuration could not be saved.",
  );
}

// ---------------------------------------------------------------------------
// Sandwich Leave Preview
// ---------------------------------------------------------------------------

export async function getLeaveSandwichPreview(fromDate, toDate) {
  const params = new URLSearchParams({ from_date: fromDate, to_date: toDate });
  return apiJson(
    `/api/hr/leave/sandwich-preview?${params.toString()}`,
    {},
    "SANDWICH_PREVIEW_FAILED",
    "Leave preview could not be computed.",
  );
}

export async function listOutWorkDestinations(companyId = null) {
  return apiJson(
    "/api/hr/out-work/destinations",
    { companyId },
    "OUT_WORK_DESTINATION_LIST_FAILED",
    "Destination list could not be loaded.",
  );
}

export async function createOutWorkDestination(payload, companyId = null) {
  return apiJson(
    "/api/hr/out-work/destination",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      companyId,
      body: JSON.stringify(payload),
    },
    "OUT_WORK_DESTINATION_CREATE_FAILED",
    "Destination could not be created.",
  );
}

export async function createOutWorkRequest(payload, companyId = null) {
  return apiJson(
    "/api/hr/out-work/request",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      companyId,
      body: JSON.stringify(payload),
    },
    "OUT_WORK_REQUEST_CREATE_FAILED",
    "Out work request could not be submitted.",
  );
}

export async function listMyOutWorkRequests() {
  return apiJson(
    "/api/hr/out-work/my-requests",
    {},
    "OUT_WORK_REQUEST_LIST_FAILED",
    "Out work request history could not be loaded.",
  );
}

export async function cancelOutWorkRequest(outWorkRequestId) {
  return apiJson(
    "/api/hr/out-work/cancel",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        out_work_request_id: outWorkRequestId,
      }),
    },
    "OUT_WORK_REQUEST_CANCEL_FAILED",
    "Out work request could not be cancelled.",
  );
}

export async function updateOutWorkRequest(payload) {
  return apiJson(
    "/api/hr/out-work/update",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
    "OUT_WORK_REQUEST_UPDATE_FAILED",
    "Out work request could not be updated.",
  );
}

export async function listOutWorkApprovalInbox() {
  return apiJson(
    "/api/hr/out-work/approval-inbox",
    {},
    "OUT_WORK_APPROVAL_INBOX_FAILED",
    "Out work approval inbox could not be loaded.",
  );
}

export async function listOutWorkApprovalHistory(requesterAuthUserId = "") {
  const query = requesterAuthUserId
    ? `?requester_auth_user_id=${encodeURIComponent(requesterAuthUserId)}`
    : "";

  return apiJson(
    `/api/hr/out-work/approval-history${query}`,
    {},
    "OUT_WORK_APPROVAL_HISTORY_FAILED",
    "Out work approval history could not be loaded.",
  );
}

export async function listOutWorkRegister(filters = {}) {
  const params = new URLSearchParams();
  if (filters?.requesterAuthUserId) {
    params.set("requester_auth_user_id", filters.requesterAuthUserId);
  }
  if (filters?.companyId) {
    params.set("company_id", filters.companyId);
  }
  if (filters?.fromDate) {
    params.set("from_date", filters.fromDate);
  }
  if (filters?.toDate) {
    params.set("to_date", filters.toDate);
  }
  const query = params.toString() ? `?${params.toString()}` : "";

  return apiJson(
    `/api/hr/out-work/register${query}`,
    {},
    "OUT_WORK_REGISTER_FAILED",
    "Out work register could not be loaded.",
  );
}

/**
 * Submit an approval/rejection decision for a workflow request.
 * @param {string} requestId
 * @param {"APPROVED"|"REJECTED"} decision
 * @param {string|null} [companyId] — required for MULTI (Type 2) users; send the request's parent_company_id
 */
export async function submitWorkflowDecision(requestId, decision, companyId = null) {
  return apiWorkflowDecision(
    { request_id: requestId, decision },
    companyId,
  );
}

// ---------------------------------------------------------------------------
// Attendance Correction (HR backdated apply + day records)
// ---------------------------------------------------------------------------

/**
 * HR applies leave on behalf of an employee (no backdate limit).
 * Requires HR_LEAVE_BACKDATED_APPLY permission.
 */
export async function backdatedLeaveApply(payload) {
  return apiJson(
    "/api/hr/leave/backdated-apply",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "BACKDATED_LEAVE_APPLY_FAILED",
    "Backdated leave could not be applied.",
  );
}

/**
 * HR applies out-work on behalf of an employee (no backdate limit).
 * Requires HR_OUT_WORK_BACKDATED_APPLY permission.
 */
export async function backdatedOutWorkApply(payload) {
  return apiJson(
    "/api/hr/out-work/backdated-apply",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "BACKDATED_OUT_WORK_APPLY_FAILED",
    "Backdated out-work could not be applied.",
  );
}

/**
 * List day records for a specific employee + date range.
 * Requires HR_LEAVE_BACKDATED_APPLY permission.
 * @param {{ employeeId: string, fromDate: string, toDate: string }} filters
 */
export async function listDayRecords({ employeeId, fromDate, toDate }) {
  const params = new URLSearchParams({
    employee_id: employeeId,
    from_date: fromDate,
    to_date: toDate,
  });
  return apiJson(
    `/api/hr/attendance/day-records?${params.toString()}`,
    {},
    "DAY_RECORDS_LIST_FAILED",
    "Day records could not be loaded.",
  );
}

/**
 * HR manually corrects a day record status (PRESENT / ABSENT / MISS_PUNCH).
 * Requires HR_ATTENDANCE_MANUAL_CORRECTION permission.
 */
export async function manualCorrectDayRecord(payload) {
  return apiJson(
    "/api/hr/attendance/correct",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "MANUAL_CORRECTION_FAILED",
    "Attendance correction could not be saved.",
  );
}

// ---------------------------------------------------------------------------
// Attendance Reports (Phase 6)
// ---------------------------------------------------------------------------

/**
 * Monthly attendance summary — per-employee status counts.
 * @param {{ year: number, month: number }} params
 */
export async function getMonthlyAttendanceSummary({ year, month }) {
  const params = new URLSearchParams({ year: String(year), month: String(month) });
  return apiJson(
    `/api/hr/attendance/monthly-summary?${params.toString()}`,
    {},
    "MONTHLY_SUMMARY_FAILED",
    "Monthly attendance summary could not be loaded.",
  );
}

/**
 * Daily attendance register — flat list of all day records in range (max 31 days).
 * @param {{ fromDate: string, toDate: string }} params
 */
export async function getDailyAttendanceRegister({ fromDate, toDate }) {
  const params = new URLSearchParams({ from_date: fromDate, to_date: toDate });
  return apiJson(
    `/api/hr/attendance/daily-register?${params.toString()}`,
    {},
    "DAILY_REGISTER_FAILED",
    "Daily attendance register could not be loaded.",
  );
}

/**
 * Yearly leave summary — month-by-month leave counts for one employee.
 * @param {{ year: number, employeeId: string }} params
 */
export async function getYearlyLeaveSummary({ year, employeeId }) {
  const params = new URLSearchParams({ year: String(year), employee_id: employeeId });
  return apiJson(
    `/api/hr/attendance/yearly-leave-summary?${params.toString()}`,
    {},
    "YEARLY_LEAVE_SUMMARY_FAILED",
    "Yearly leave summary could not be loaded.",
  );
}

/**
 * Department attendance report — per-work-context totals (max 31 days).
 * @param {{ fromDate: string, toDate: string }} params
 */
export async function getDepartmentAttendanceReport({ fromDate, toDate }) {
  const params = new URLSearchParams({ from_date: fromDate, to_date: toDate });
  return apiJson(
    `/api/hr/attendance/department-report?${params.toString()}`,
    {},
    "DEPARTMENT_REPORT_FAILED",
    "Department attendance report could not be loaded.",
  );
}

/**
 * Leave usage report — per-employee per-type days taken for the year.
 * Balance is always null until Phase 8.
 * @param {{ year: number }} params
 */
export async function getLeaveUsageReport({ year }) {
  const params = new URLSearchParams({ year: String(year) });
  return apiJson(
    `/api/hr/attendance/leave-usage?${params.toString()}`,
    {},
    "LEAVE_USAGE_REPORT_FAILED",
    "Leave usage report could not be loaded.",
  );
}
