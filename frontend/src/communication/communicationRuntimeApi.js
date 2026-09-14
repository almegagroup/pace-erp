/* Runtime-only Communication Automation API. Never uses admin enrollment routes. */

async function readJsonSafe(response) {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
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

  const response = await fetch(
    `${import.meta.env.VITE_API_BASE}/api/communication/action-visibility?${query.toString()}`,
    { credentials: "include" },
  );
  const json = await readJsonSafe(response);
  if (!response.ok || json?.ok !== true) {
    const error = new Error(json?.message || "COMMUNICATION_RUNTIME_VISIBILITY_FAILED");
    error.code = json?.code || "COMMUNICATION_RUNTIME_VISIBILITY_FAILED";
    throw error;
  }
  return json.data;
}
