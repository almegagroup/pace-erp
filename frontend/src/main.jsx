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
import { QueryClientProvider } from "@tanstack/react-query";
import "./index.css";
import App from "./App.jsx";
import { queryClient } from "./hooks/queries/queryClient.js";
import {
  hardLogout,
  recordBackendActivity,
  SESSION_WARNING_ACK_QUERY,
  showWarning,
} from "./store/sessionWarning.js";
import {
  consumeLockedRefreshFlag,
  requestWorkspaceLockLogout,
} from "./store/workspaceLock.js";
import { getClusterFetchHeaders } from "./store/sessionCluster.js";
import {
  beginNetworkActivity,
  finishNetworkActivity,
} from "./store/networkActivity.js";

// 🔒 Gate-8 / G1 — Screen Registry Validation
import { validateScreenRegistry } from "./navigation/screenRules.js";
import { enableBackGuard } from "./navigation/backGuardEngine.js";
import { enableKeyboardIntentEngine } from "./navigation/keyboardIntentEngine.js";
import {
  getScreenForRoute,
  initNavigation,
} from "./navigation/screenStackEngine.js";
import { restoreNavigationStack } from "./navigation/navigationPersistence.js";
import { isPublicRoute } from "./router/publicRoutes.js";
import { AMBIGUOUS_WRITE_MESSAGE, isNetworkFailure } from "./utils/errorMessages.js";

const CLIENT_SHELL_REFRESH_KEY = "__PACE_CLIENT_SHELL_REFRESHED__";


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

function withClusterHeaders(args) {
  const requestTarget = args[0];
  const requestInit = args[1] ?? {};
  const clusterHeaders = getClusterFetchHeaders();

  if (Object.keys(clusterHeaders).length === 0) {
    return args;
  }

  if (requestTarget instanceof Request) {
    const headers = new Headers(requestTarget.headers);
    Object.entries(clusterHeaders).forEach(([key, value]) => {
      headers.set(key, value);
    });

    return [
      new Request(requestTarget, {
        headers,
      }),
      requestInit,
    ];
  }

  const headers = new Headers(requestInit.headers ?? {});
  Object.entries(clusterHeaders).forEach(([key, value]) => {
    headers.set(key, value);
  });

  return [
    requestTarget,
    {
      ...requestInit,
      headers,
    },
  ];
}

async function refreshSessionAfterWarning() {
  const response = await __originalFetch(
    `${API_BASE}/api/me?${SESSION_WARNING_ACK_QUERY}`,
    {
      credentials: "include",
    }
  );

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
  const isWarningAcknowledgeRefresh =
    isApiRequest && url.includes(SESSION_WARNING_ACK_QUERY);
  const requestMethod =
    args[0] instanceof Request
      ? args[0].method
      : args[1]?.method ?? "GET";
  const normalizedRequestMethod = String(requestMethod || "GET").toUpperCase();
  const requestUiMode =
    args[1]?.erpUiMode ??
    (normalizedRequestMethod === "GET" || normalizedRequestMethod === "HEAD"
      ? "silent"
      : undefined);
  const requestUiLabel = args[1]?.erpUiLabel;
  const isSilentRequest = requestUiMode === "silent";
  const shouldAttachClusterHeaders =
    isApiRequest && !url.includes("/api/session/cluster/admit");
  const shouldTrackActivity =
    isApiRequest &&
    !isPassiveProbe &&
    !isWarningAcknowledgeRefresh &&
    !isSilentRequest;
  const activityToken = shouldTrackActivity
    ? beginNetworkActivity(url, requestMethod, {
        mode: requestUiMode,
        label: requestUiLabel,
      })
    : null;

  const finalArgs = shouldAttachClusterHeaders ? withClusterHeaders(args) : args;
  let ok = false;

  try {
    const res = await __originalFetch(...finalArgs);
    ok = res.ok;

    let json;

    try {
      json = await res.clone().json();
    } catch {
      return res;
    }

    /* -------------------------------------------------------
     * WARNING (BACKEND AUTHORITY)
     * ------------------------------------------------------- */
    if (
      !isPassiveProbe &&
      !isWarningAcknowledgeRefresh &&
      json?.warning?.type === "IDLE_WARNING"
    ) {
      showWarning("IDLE_WARNING", refreshSessionAfterWarning);
    }

    if (
      !isPassiveProbe &&
      !isWarningAcknowledgeRefresh &&
      json?.warning?.type === "ABSOLUTE_WARNING"
    ) {
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
  } catch (err) {
    /* -------------------------------------------------------
     * AMBIGUOUS WRITE (no HTTP response ever arrived)
     *
     * fetch() only rejects when the request never produced a response — connection
     * dropped, timed out, server restarted mid-flight. Real HTTP errors (4xx/5xx)
     * resolve normally and are handled by each api module's resolveErrorMessage().
     *
     * For GET/HEAD this is harmless: nothing changed, retry freely — rethrow as-is.
     *
     * For a mutating method the outcome is genuinely UNKNOWN. The server keeps running
     * after the browser disconnects, so the write has most likely already completed.
     * Our stock postings are not one transaction (CLAUDE.md 8C), and no handler skips
     * already-posted lines, so a blind retry double-posts and orphans the first
     * posting's ledger link. We therefore relabel it so the UI tells the user to VERIFY
     * before retrying instead of offering a plain "try again".
     * ------------------------------------------------------- */
    const isMutating =
      normalizedRequestMethod !== "GET" && normalizedRequestMethod !== "HEAD";

    if (isApiRequest && isMutating && isNetworkFailure(err)) {
      const ambiguous = new Error(AMBIGUOUS_WRITE_MESSAGE, { cause: err });
      // Deliberately NO `.code`. Pages commonly render `friendly(err.code) || err.message`,
      // and their local `friendly()` is `ERRORS[code] ?? code` — an unmapped code would be
      // shown to the user verbatim as raw text. Leaving code undefined makes that expression
      // fall through to `.message`, which is the sentence we actually want displayed.
      // `.ambiguousWrite` is the machine-readable marker instead.
      ambiguous.ambiguousWrite = true;
      ambiguous.requestMethod = normalizedRequestMethod;
      throw ambiguous;
    }

    throw err;
  } finally {
    if (activityToken) {
      finishNetworkActivity(activityToken, { ok });
    }
  }
};

const restored = restoreNavigationStack();

if (!restored && !isPublicRoute(pathname)) {
  const initialScreen = getScreenForRoute(pathname);

  if (initialScreen?.keepAlive) {
    initNavigation(initialScreen.screen_code);
  }
}

async function ensureFreshClientShell() {
  if (typeof window === "undefined") {
    return;
  }

  let changed = false;

  if ("serviceWorker" in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();

    if (registrations.length > 0) {
      changed = true;
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }
  }

  if ("caches" in globalThis) {
    const cacheKeys = await caches.keys();
    const staleKeys = cacheKeys.filter((key) =>
      key.startsWith("workbox-") ||
      key.includes("precache") ||
      key === "ui-assets"
    );

    if (staleKeys.length > 0) {
      changed = true;
      await Promise.all(staleKeys.map((key) => caches.delete(key)));
    }
  }

  const alreadyReloaded =
    sessionStorage.getItem(CLIENT_SHELL_REFRESH_KEY) === "1";

  if (changed && !alreadyReloaded) {
    sessionStorage.setItem(CLIENT_SHELL_REFRESH_KEY, "1");
    globalThis.location.reload();
    return;
  }

  if (!changed && alreadyReloaded) {
    sessionStorage.removeItem(CLIENT_SHELL_REFRESH_KEY);
  }
}

async function mountApp() {
  await ensureFreshClientShell();

  if (consumeLockedRefreshFlag()) {
    await requestWorkspaceLockLogout({
      keepalive: true,
      fetchImpl: __originalFetch,
    });
    hardLogout();
    return;
  }

  createRoot(document.getElementById("root")).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </StrictMode>
  );
}

void mountApp();
