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
import { runScreenBackInterceptor } from "../store/screenBackInterceptor.js";

let backGuardEnabled = false;

function resolveScreenRoute(screen) {
  const route = screen?.route ?? null;
  const context = screen?.context ?? {};

  if (!route) {
    return null;
  }

  if (!route.includes(":")) {
    return route;
  }

  return route.replace(/:([^/]+)/g, (token, key) => {
    const value = context[key];
    return value == null || value === ""
      ? token
      : encodeURIComponent(String(value));
  });
}

export function enableBackGuard() {
  if (backGuardEnabled) return;
  backGuardEnabled = true;

  globalThis.addEventListener("popstate", onBrowserBack);
}

function onBrowserBack(event) {
  const active = getActiveScreen();
  const activeRoute = resolveScreenRoute(active);

  if (!activeRoute || isPublicRoute(activeRoute)) {
    return;
  }

  if (runScreenBackInterceptor()) {
    event.preventDefault();
    globalThis.history.replaceState(null, "", activeRoute);
    return;
  }

  const stack = getStackSnapshot();

  // No stack = illegal
  if (!Array.isArray(stack) || stack.length === 0) {
    event.preventDefault();
    return;
  }

  // Root screen cannot go back
  if (stack.length === 1) {
    event.preventDefault();
    if (activeRoute) {
      globalThis.history.replaceState(null, "", activeRoute);
    }
    void confirmAndRequestLogout();
    return;
  }

  const previous = getPreviousScreen();
  if (!isBackAllowed(previous?.screen_code)) {
    event.preventDefault();
    if (activeRoute) {
      globalThis.history.replaceState(null, "", activeRoute);
    }
    return;
  }

  popScreen();
}
