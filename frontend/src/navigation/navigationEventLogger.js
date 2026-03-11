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
  // Gate-8 rule:
  // - Read-only
  // - No side effects
  // - No control flow impact

  console.info("[NAV_EVENT]", {
    ts: Date.now(),
    ...event,
  });
}
