export async function readJsonSafe(response) {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}

export function describeApiError(json, fallbackCode) {
  const code = json?.code ?? fallbackCode ?? "REQUEST_FAILED";
  const trace = json?.decision_trace ? ` | Trace ${json.decision_trace}` : "";
  const requestId = json?.request_id ? ` | Req ${json.request_id}` : "";
  const publicMessage =
    typeof json?.message === "string" && json.message.trim().length > 0
      ? ` | ${json.message.trim()}`
      : "";
  return `${code}${trace}${publicMessage}${requestId}`;
}

async function fetchJson(path, options = {}, fallbackCode = "REQUEST_FAILED") {
  const response = await fetch(`${import.meta.env.VITE_API_BASE}${path}`, {
    credentials: "include",
    ...options,
  });

  const json = await readJsonSafe(response);

  if (!response.ok || !json?.ok) {
    const error = new Error(describeApiError(json, fallbackCode));
    error.code = json?.code ?? fallbackCode ?? "REQUEST_FAILED";
    error.requestId = json?.request_id ?? null;
    error.decisionTrace = json?.decision_trace ?? null;
    error.publicMessage = json?.message ?? null;
    throw error;
  }

  return json.data;
}

export function fetchApprovalWorkspace() {
  return fetchJson("/api/admin/approval/workspace", {}, "APPROVAL_WORKSPACE_LIST_FAILED");
}

export function fetchReportVisibilityWorkspace() {
  return fetchJson(
    "/api/admin/report-visibility/workspace",
    {},
    "REPORT_VISIBILITY_WORKSPACE_LIST_FAILED",
  );
}

export function saveApproverRule(payload) {
  return fetchJson(
    "/api/admin/approval/approvers",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
    "APPROVER_RULE_UPSERT_FAILED",
  );
}

export function deleteApproverRule(approverId) {
  return fetchJson(
    "/api/admin/approval/approvers/delete",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ approver_id: approverId }),
    },
    "APPROVER_RULE_DELETE_FAILED",
  );
}

export function saveViewerRule(payload) {
  return fetchJson(
    "/api/admin/approval/viewers",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
    "REPORT_VIEWER_RULE_UPSERT_FAILED",
  );
}

export function deleteViewerRule(viewerId) {
  return fetchJson(
    "/api/admin/approval/viewers/delete",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ viewer_id: viewerId }),
    },
    "REPORT_VIEWER_RULE_DELETE_FAILED",
  );
}
