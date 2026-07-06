/*
 * File-Path: frontend/src/store/wideWorkspace.js
 * Purpose: Let a data-heavy page (e.g. CSN Tracker) request the action rail
 *          stay fully hidden, ALV-report style, instead of just icon-collapsed.
 * Authority: Frontend
 */

let requestCount = 0;
let listeners = [];

function emit() {
  const wide = requestCount > 0;
  listeners.forEach((listener) => listener(wide));
}

export function subscribeWideWorkspace(listener) {
  listeners.push(listener);
  listener(requestCount > 0);
  return () => {
    listeners = listeners.filter((entry) => entry !== listener);
  };
}

export function requestWideWorkspace() {
  requestCount += 1;
  emit();
  return () => {
    requestCount = Math.max(0, requestCount - 1);
    emit();
  };
}
