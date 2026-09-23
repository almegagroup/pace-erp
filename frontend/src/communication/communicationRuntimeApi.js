/* Runtime-only Communication Automation API. Never uses admin enrollment routes. */

async function readJsonSafe(response) {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}

function buildApiError(json, fallbackCode) {
  const code = json?.code || fallbackCode;
  const error = new Error(json?.message || code);
  error.code = code;
  error.requestId = json?.request_id || null;
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

function configurationQuery({ txCode, resourceCode, surfaceKey, companyId, channel = "EMAIL", ruleId }) {
  const query = new URLSearchParams({
    tx_code: txCode,
    resource_code: resourceCode,
    surface_key: surfaceKey,
    company_id: companyId,
    channel,
  });
  if (ruleId) query.set("rule_id", ruleId);
  return query.toString();
}

export async function getCommunicationActionVisibility({
  txCode,
  resourceCode,
  surfaceKey,
  channel = "EMAIL",
  companyId,
}) {
  const query = new URLSearchParams({
    tx_code: txCode,
    resource_code: resourceCode,
    surface_key: surfaceKey,
    channel,
  });
  if (companyId) query.set("company_id", companyId);

  return communicationRequest(
    `/api/communication/action-visibility?${query.toString()}`,
    { method: "GET" },
    "COMMUNICATION_RUNTIME_VISIBILITY_FAILED",
  );
}

export function getCommunicationConfiguration(input) {
  return communicationRequest(
    `/api/communication/configuration?${configurationQuery(input)}`,
    { method: "GET" },
    "COMMUNICATION_RULE_CONFIGURATION_FAILED",
  );
}

export function getCommunicationRule(input) {
  return communicationRequest(
    `/api/communication/rules?${configurationQuery(input)}`,
    { method: "GET" },
    "COMMUNICATION_RULE_READ_FAILED",
  );
}

function saveRule(path, payload, fallbackCode) {
  return communicationRequest(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }, fallbackCode);
}

export function saveCommunicationRule(payload) {
  return saveRule("/api/communication/rules/save", payload, "COMMUNICATION_RULE_SAVE_FAILED");
}

export function activateCommunicationRule(payload) {
  return saveRule("/api/communication/rules/activate", payload, "COMMUNICATION_RULE_ACTIVATE_FAILED");
}

export function deactivateCommunicationRule(payload) {
  return saveRule("/api/communication/rules/deactivate", payload, "COMMUNICATION_RULE_DEACTIVATE_FAILED");
}
