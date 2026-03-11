/*
 * File-ID: 8.3
 * File-Path: frontend/src/navigation/backGuardEngine.js
 * Gate: 8
 * Phase: 8
 * Domain: SECURITY
 * Purpose: Intercept browser back and delegate validation to Screen Stack Engine
 * Authority: Frontend
 */

import { popScreen, getStackSnapshot, getActiveScreen } from "./screenStackEngine.js";

let backGuardEnabled = false;

export function enableBackGuard() {
  if (backGuardEnabled) return;
  backGuardEnabled = true;

  globalThis.addEventListener("popstate", onBrowserBack);
}

function onBrowserBack(event) {
  const stack = getStackSnapshot();

  // No stack = illegal
  if (!Array.isArray(stack) || stack.length === 0) {
    event.preventDefault();
    return;
  }

  // Root screen cannot go back
  if (stack.length === 1) {
    event.preventDefault();
    globalThis.history.pushState(null, "", globalThis.location.pathname);
    return;
  }

  
  // Delegate decision to stack engine
popScreen();

// Re-assert URL from engine, not browser
const active = getActiveScreen();
globalThis.history.pushState(null, "", active.route);
}
