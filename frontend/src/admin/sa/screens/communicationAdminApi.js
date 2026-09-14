/*
 * Communication Automation — Phase 2 admin API client.
 *
 * The browser communicates only with the authenticated PACE backend.  The
 * backend remains the authority for admin access, page identity, manifest
 * readiness, and atomic enrollment persistence.
 */

async function readJsonSafe(response) {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}

function buildApiError(json, fallbackCode) {
  const code = json?.code ?? fallbackCode;
  const message = typeof json?.message === "string" && json.message.trim()
    ? json.message.trim()
    : code;
  const error = new Error(message);
  error.code = code;
  error.requestId = json?.request_id ?? null;
  return error;
}

async function communicationRequest(path, options, fallbackCode) {
  const response = await fetch(`${import.meta.env.VITE_API_BASE}${path}`, {
    credentials: "include",
    ...options,
  });
  const json = await readJsonSafe(response);

  if (!response.ok || json?.ok !== true) {
    throw buildApiError(json, fallbackCode);
  }

  return json.data;
}

export function searchCommunicationPages(query) {
  return communicationRequest(
    `/api/admin/communication/pages?q=${encodeURIComponent(query)}`,
    { method: "GET" },
    "COMMUNICATION_PAGE_SEARCH_FAILED",
  );
}

export function getCommunicationEnrollment(pageMenuId) {
  return communicationRequest(
    `/api/admin/communication/enrollment?page_menu_id=${encodeURIComponent(pageMenuId)}`,
    { method: "GET" },
    "COMMUNICATION_ENROLLMENT_READ_FAILED",
  );
}

export function saveCommunicationEnrollment(payload) {
  return communicationRequest(
    "/api/admin/communication/enrollment",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "COMMUNICATION_ENROLLMENT_SAVE_FAILED",
  );
}
