/*
 * File-ID: 8.1A-MAIN
 * File-Path: frontend/src/main.jsx
 * Gate: 8
 * Phase: 8
 * Domain: FRONT
 * Purpose: Application bootstrap with screen registry validation
 * Authority: Frontend
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";
import {
  hardLogout,
  recordBackendActivity,
  showWarning,
} from "./store/sessionWarning.js";

// 🔒 Gate-8 / G1 — Screen Registry Validation
import { validateScreenRegistry } from "./navigation/screenRules.js";
import { enableBackGuard } from "./navigation/backGuardEngine.js";
import { enableKeyboardIntentEngine } from "./navigation/keyboardIntentEngine.js";
import { initNavigation } from "./navigation/screenStackEngine.js";
import { restoreNavigationStack } from "./navigation/navigationPersistence.js";
import { isPublicRoute } from "./router/publicRoutes.js";



// Enforce screen metadata invariants at boot
validateScreenRegistry();
enableBackGuard();
enableKeyboardIntentEngine();
/*
============================================================
TEMP_UI_BOOT_PATCH
Step: 3
File: main.jsx

Reason:
During UI bootstrap we must allow Landing ("/") to render
before screenStackEngine forces DASHBOARD_HOME.

When path === "/"
navigation stack must not auto-push dashboard.

Reference:
TEMP_UI_BOOT_LOG.md
============================================================
*/

const pathname = globalThis.location.pathname;

/*
============================================================
NAVIGATION ACTIVATION RULE

Navigation engine must NOT run on public routes.
Public routes render outside the screenStackEngine.

Only authenticated universe may activate navigation stack.
============================================================
*/

/* =========================================================
 * UI SESSION INTERCEPTOR (GLOBAL FETCH OVERRIDE)
 * ========================================================= */

const __originalFetch = globalThis.fetch;
const API_BASE = import.meta.env.VITE_API_BASE;

async function refreshSessionAfterWarning() {
  const response = await __originalFetch(`${API_BASE}/api/me`, {
    credentials: "include",
  });

  let json = null;

  try {
    json = await response.clone().json();
  } catch {
    json = null;
  }

  if (!response.ok || json?.action === "LOGOUT") {
    hardLogout();
    return;
  }

  recordBackendActivity();
}

globalThis.fetch = async (...args) => {
  const requestTarget = args[0];
  const url =
    typeof requestTarget === "string"
      ? requestTarget
      : requestTarget instanceof Request
        ? requestTarget.url
        : "";
  const isApiRequest = url.startsWith(`${API_BASE}/api/`);
  const isPassiveProbe =
    isApiRequest && url.includes("session_mode=passive");

  const res = await __originalFetch(...args);

  let json;

  try {
    json = await res.clone().json();
  } catch {
    return res;
  }

  /* -------------------------------------------------------
   * WARNING (BACKEND AUTHORITY)
   * ------------------------------------------------------- */
  if (json?.warning?.type === "IDLE_WARNING") {
    showWarning("IDLE_WARNING", refreshSessionAfterWarning);
  }

  if (json?.warning?.type === "ABSOLUTE_WARNING") {
    showWarning("ABSOLUTE_WARNING", refreshSessionAfterWarning);
  }

  /* -------------------------------------------------------
   * LOGOUT (BACKEND AUTHORITY)
   * ------------------------------------------------------- */
  if (json?.action === "LOGOUT") {
    hardLogout();
    return res;
  }

  if (isApiRequest && !isPassiveProbe && res.ok) {
    recordBackendActivity();
  }

  return res;
};

const restored = restoreNavigationStack();

if (!restored && !isPublicRoute(pathname)) {
  initNavigation("DASHBOARD_HOME");
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
