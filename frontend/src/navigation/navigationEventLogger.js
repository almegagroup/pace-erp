/*
 * File-ID: 8.7
 * File-Path: frontend/src/navigation/navigationEventLogger.js
 * Gate: 8
 * Phase: 8
 * Domain: OBSERVABILITY
 * Purpose: Log navigation events without affecting control flow
 * Authority: Frontend
 */

export function logNavigationEvent(event) {
  if (!event || typeof console === "undefined") {
    return;
  }

  const shouldLog =
    import.meta.env.DEV ||
    globalThis.localStorage?.getItem("__PACE_NAV_DEBUG__") === "1";

  if (!shouldLog) {
    return;
  }

  console.debug("[ERP_NAV]", {
    ts: new Date().toISOString(),
    ...event,
  });
}
