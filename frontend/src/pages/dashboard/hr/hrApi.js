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

async function apiJson(path, options = {}, fallbackCode = "REQUEST_FAILED", fallbackMessage = "Request failed") {
  let response;

  try {
    response = await fetch(`${import.meta.env.VITE_API_BASE}${path}`, {
      credentials: "include",
      ...options,
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

export async function createLeaveRequest(payload) {
  return apiJson(
    "/api/hr/leave/request",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
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
  const query = params.toString() ? `?${params.toString()}` : "";

  return apiJson(
    `/api/hr/leave/register${query}`,
    {},
    "LEAVE_REGISTER_FAILED",
    "Leave register could not be loaded.",
  );
}

export async function listOutWorkDestinations() {
  return apiJson(
    "/api/hr/out-work/destinations",
    {},
    "OUT_WORK_DESTINATION_LIST_FAILED",
    "Destination list could not be loaded.",
  );
}

export async function createOutWorkDestination(payload) {
  return apiJson(
    "/api/hr/out-work/destination",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
    "OUT_WORK_DESTINATION_CREATE_FAILED",
    "Destination could not be created.",
  );
}

export async function createOutWorkRequest(payload) {
  return apiJson(
    "/api/hr/out-work/request",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
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
