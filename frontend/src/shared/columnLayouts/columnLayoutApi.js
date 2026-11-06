/*
 * File-Path: frontend/src/shared/columnLayouts/columnLayoutApi.js
 * Purpose: Common column-picker layout API (/api/me/column-layouts), usable from every domain (procurement, HR, SA...).
 *          list() returns the WHOLE payload { data: [...layouts], default_layout_id } -- domain fetch wrappers unwrap a
 *          { data, ... } payload down to the bare array, which silently dropped default_layout_id and made the
 *          pages read an empty layout list (CLAUDE.md bug pattern #15). Do not route this through them.
 * Authority: Frontend
 */
import { resolveErrorMessage } from "../../utils/errorMessages.js";

async function request(method, path, body, params) {
  const query = new URLSearchParams();
  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") query.set(key, String(value));
  });
  const response = await fetch(`${import.meta.env.VITE_API_BASE}${path}${query.toString() ? `?${query.toString()}` : ""}`, {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await response.clone().json().catch(() => null);
  if (!response.ok || !json?.ok) {
    const code = json?.code ?? "COLUMN_LAYOUT_REQUEST_FAILED";
    // The limit message is meant for the user, show the backend text as is.
    const error = new Error(code === "REPORT_LAYOUT_LIMIT_REACHED" && json?.message ? json.message : resolveErrorMessage(code, json?.message, response.status));
    error.code = code;
    error.status = response.status;
    throw error;
  }
  return json.data;
}

const BASE = "/api/me/column-layouts";

/** -> { data: [{ id, scope, layout_name, visible_columns, ... }], default_layout_id } */
export function listColumnLayouts(reportCode) {
  return request("GET", BASE, undefined, { report_code: reportCode });
}
/** -> { data: <created layout> } */
export function createColumnLayout(payload) {
  return request("POST", BASE, payload);
}
export function updateColumnLayout(id, payload) {
  return request("PATCH", `${BASE}/${encodeURIComponent(id)}`, payload);
}
export function deleteColumnLayout(id) {
  return request("DELETE", `${BASE}/${encodeURIComponent(id)}`);
}
export function setDefaultColumnLayout(id) {
  return request("POST", `${BASE}/${encodeURIComponent(id)}/set-default`);
}
