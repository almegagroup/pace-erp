/*
 * File-ID: UI-SESSION-1
 * File-Path: frontend/src/store/sessionWarning.js
 * Gate: UI
 * Phase: UI
 * Domain: FRONT
 * Purpose: Session watchdog state for blocking warnings and forced logout
 * Authority: Frontend (DISPLAY + CLIENT COORDINATION ONLY)
 */

import { clearNavigationStack } from "../navigation/navigationPersistence.js";
import { openLogoutConfirm } from "./logoutConfirm.js";
import { clearWorkspaceLock } from "./workspaceLock.js";
import {
  broadcastClusterMessage,
  clearClusterAdmission,
  getClusterAdmission,
} from "./sessionCluster.js";
import { releaseSingleTabOwnership } from "./singleTabSession.js";

const WARNING_MESSAGES = {
  IDLE_WARNING:
    "You have been inactive. Press OK or Esc to continue your session.",
  ABSOLUTE_WARNING:
    "Your session is about to expire. Press OK or Esc to continue working.",
};

export const SESSION_WARNING_ACK_QUERY = "session_refresh=warning_ack";

let state = {
  visible: false,
  message: "",
  type: null,
  frontendActivityAt: Date.now(),
  backendActivityAt: Date.now(),
  protectedRouteActive: false,
};

let listeners = [];
let dismissHandler = null;

function emit() {
  listeners.forEach((listener) => listener({ ...state }));
}

function redirectToLogin() {
  try {
    globalThis.history.replaceState(null, "", "/login");
  } catch {
    // History replacement is best effort only.
  }

  globalThis.location.replace("/login");
}

function closeChildWindowOrRedirect() {
  try {
    globalThis.close();
  } catch {
    // Close is best effort only.
  }

  globalThis.setTimeout(() => {
    if (!globalThis.closed) {
      redirectToLogin();
    }
  }, 150);
}

export function subscribe(fn) {
  listeners.push(fn);
  fn({ ...state });
}

export function unsubscribe(fn) {
  listeners = listeners.filter((listener) => listener !== fn);
}

export function setProtectedRouteActive(active) {
  state = {
    ...state,
    protectedRouteActive: active,
  };

  if (!active) {
    dismissHandler = null;
    state = {
      ...state,
      visible: false,
      message: "",
      type: null,
    };
  }

  emit();
}

export function recordUserActivity() {
  if (!state.protectedRouteActive || state.visible) return;

  state = {
    ...state,
    frontendActivityAt: Date.now(),
  };
  emit();
}

export function recordBackendActivity() {
  if (!state.protectedRouteActive) return;

  state = {
    ...state,
    backendActivityAt: Date.now(),
  };
  emit();
}

export function getSessionWatchdogSnapshot() {
  return { ...state };
}

export function showWarning(type, onDismiss, options = {}) {
  const { broadcast = true } = options;

  if (state.visible && state.type === type) {
    dismissHandler = typeof onDismiss === "function" ? onDismiss : dismissHandler;
    return;
  }

  state = {
    ...state,
    visible: true,
    type,
    message: WARNING_MESSAGES[type] ?? WARNING_MESSAGES.IDLE_WARNING,
  };
  dismissHandler = typeof onDismiss === "function" ? onDismiss : null;
  emit();

  if (broadcast) {
    broadcastClusterMessage({
      type: "SESSION_WARNING_SHOW",
      warningType: type,
    });
  }
}

export async function clearWarning(reason = "dismiss", options = {}) {
  const { broadcast = true } = options;
  const handler = dismissHandler;

  dismissHandler = null;
  state = {
    ...state,
    visible: false,
    message: "",
    type: null,
    frontendActivityAt: Date.now(),
  };
  emit();

  if (broadcast) {
    broadcastClusterMessage({
      type: "SESSION_WARNING_CLEAR",
      reason,
    });
  }

  if (handler) {
    await handler(reason);
  }
}

export function resetWarningState() {
  dismissHandler = null;
  state = {
    ...state,
    visible: false,
    message: "",
    type: null,
  };
  emit();
}

export function hardLogout(options = {}) {
  const { broadcast = true } = options;
  const clusterAdmission = getClusterAdmission();
  dismissHandler = null;

  if (broadcast) {
    broadcastClusterMessage({
      type: "SESSION_LOGOUT",
    });
  }

  clearNavigationStack();
  clearWorkspaceLock();
  clearClusterAdmission();
  releaseSingleTabOwnership();

  state = {
    ...state,
    visible: false,
    message: "",
    type: null,
    protectedRouteActive: false,
  };
  emit();

  if ((clusterAdmission?.windowSlot ?? 1) > 1) {
    closeChildWindowOrRedirect();
    return;
  }

  redirectToLogin();
}

export async function requestLogout() {
  try {
    await globalThis.fetch(`${import.meta.env.VITE_API_BASE}/api/logout`, {
      method: "POST",
      credentials: "include",
    });
  } catch {
    // Logout must still complete locally even if the network path fails.
  }

  hardLogout();
}

export async function confirmAndRequestLogout() {
  const approved = await openLogoutConfirm();

  if (!approved) {
    return false;
  }

  await requestLogout();
  return true;
}
