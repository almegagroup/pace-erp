/*
 * File-ID: 8.3
 * File-Path: frontend/src/navigation/backGuardEngine.js
 * Gate: 8
 * Phase: 8
 * Domain: SECURITY
 * Purpose: Intercept browser back and delegate validation to Screen Stack Engine
 * Authority: Frontend
 */

import {
  getActiveScreen,
  getPreviousScreen,
  getStackSnapshot,
  popScreen,
} from "./screenStackEngine.js";
import { isBackAllowed } from "./backValidation.js";
import { isPublicRoute } from "../router/publicRoutes.js";
import { confirmAndRequestLogout } from "../store/sessionWarning.js";

let backGuardEnabled = false;

export function enableBackGuard() {
  if (backGuardEnabled) return;
  backGuardEnabled = true;

  globalThis.addEventListener("popstate", onBrowserBack);
}

function onBrowserBack(event) {
  if (isPublicRoute(globalThis.location.pathname)) {
    return;
  }

  const stack = getStackSnapshot();
  const active = getActiveScreen();

  // No stack = illegal
  if (!Array.isArray(stack) || stack.length === 0) {
    event.preventDefault();
    return;
  }

  // Root screen cannot go back
  if (stack.length === 1) {
    event.preventDefault();
    void confirmAndRequestLogout();
    return;
  }

  const previous = getPreviousScreen();
  if (!isBackAllowed(previous?.screen_code)) {
    event.preventDefault();
    if (active?.route) {
      globalThis.history.pushState(null, "", active.route);
    }
    return;
  }

  popScreen();

  const nextActive = getActiveScreen();
  if (nextActive?.route) {
    globalThis.history.pushState(null, "", nextActive.route);
  }
}
