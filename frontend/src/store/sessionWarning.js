/*
 * File-ID: UI-SESSION-1
 * File-Path: frontend/src/store/sessionWarning.js
 * Gate: UI
 * Phase: UI
 * Domain: FRONT
 * Purpose: Global warning state store for session overlay control
 * Authority: Frontend (NO SESSION AUTHORITY)
 */

let state = {
  visible: false,
  message: "",
};

let listeners = [];
/* =========================================================
 * INTERNAL FLAG (prevent duplicate warning)
 * ========================================================= */

let isWarningActive = false;

/* =========================================================
 * Subscribe
 * ========================================================= */

export function subscribe(fn) {
  listeners.push(fn);
}

/* =========================================================
 * Unsubscribe
 * ========================================================= */

export function unsubscribe(fn) {
  listeners = listeners.filter((l) => l !== fn);
}

/* =========================================================
 * Show Warning (UI ONLY)
 * ========================================================= */

export function showWarning(message) {
  if (isWarningActive) return;

  isWarningActive = true;

  state = { visible: true, message };
  listeners.forEach((l) => l(state));
}

/* =========================================================
 * Clear Warning (UI ONLY)
 * ========================================================= */

export function clearWarning() {
  isWarningActive = false;

  state = { visible: false, message: "" };
  listeners.forEach((l) => l(state));
}