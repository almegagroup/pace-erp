/*
 * File-ID: 9.1A
 * File-Path: frontend/src/admin/adminEntryGuard.js
 * Gate: 9
 * Phase: 9
 * Domain: SECURITY
 * Purpose: Enforce deterministic entry into Admin Universe shells
 * Authority: Frontend
 */

import { getActiveScreen } from "../navigation/screenStackEngine.js";

export function assertAdminEntry() {
  const current = getActiveScreen();

  // No screen stack → illegal entry
  if (!current) {
    if (typeof globalThis !== "undefined" && globalThis.location) {
  globalThis.location.replace("/");
}
    return;
  }

  // Enforce admin universe boundary
  if (current.universe !== "ADMIN") {
    if (typeof globalThis !== "undefined" && globalThis.location) {
  globalThis.location.replace("/");
}
    return;
  }

  // NOTE:
  // Role (SA / GA) is NOT verified here.
  // Backend session + menu snapshot already guarantee role correctness.
  // Frontend must not re-check role.
}
