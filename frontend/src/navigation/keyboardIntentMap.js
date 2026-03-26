/*
 * File-ID: 8.4A
 * File-Path: frontend/src/navigation/keyboardIntentMap.js
 * Gate: 8
 * Phase: 8
 * Domain: SECURITY
 * Purpose: Deterministic keyboard intent handling (G5-ready)
 * Authority: Frontend
 */

import { getStackSnapshot, popScreen } from "./screenStackEngine.js";
import { isKeyboardIntentAllowed } from "./keyboardAclBridge.js";
import { logNavigationEvent } from "./navigationEventLogger.js";
import { confirmAndRequestLogout } from "../store/sessionWarning.js";
import { hideSidebar, showSidebar } from "../store/workspaceShell.js";
import { lockWorkspace } from "../store/workspaceLock.js";

/**
 * SECURITY ALLOWLIST
 * Only declared intents can execute handlers.
 */
const INTENT_HANDLERS = Object.freeze({
  INTENT_BACK: handleBack,
  INTENT_SIDEBAR_HIDE: handleSidebarHide,
  INTENT_SIDEBAR_SHOW: handleSidebarShow,
  INTENT_LOGOUT_CONFIRM: handleLogoutConfirm,
  INTENT_WORKSPACE_LOCK: handleWorkspaceLock,
  // Future intents:
  // INTENT_SAVE: handleSave,
});

export function handleKeyboardIntent(intent) {
  // Step 1: Unknown intent = ignore
  const handler = INTENT_HANDLERS[intent];
  if (!handler) return;

  // Step 2: Permission check (G5+)
  // Gate-8: always true
  // Gate-10+: real ACL evaluation
  if (!isKeyboardIntentAllowed(intent)) {
    return handleDeniedIntent(intent);
  }

  // Step 3: Execute intent
  handler();
}

/* =======================
   Intent handlers
   ======================= */

function handleBack() {
  const stack = getStackSnapshot();
  if (stack.length <= 1) {
    void confirmAndRequestLogout();
    return;
  }

  logNavigationEvent({
    source: "keyboard",
    intent: "INTENT_BACK",
    action: "POP_SCREEN",
  });
  popScreen();
}

function handleSidebarHide() {
  logNavigationEvent({
    source: "keyboard",
    intent: "INTENT_SIDEBAR_HIDE",
    action: "COLLAPSE_SIDEBAR",
  });
  hideSidebar();
}

function handleSidebarShow() {
  logNavigationEvent({
    source: "keyboard",
    intent: "INTENT_SIDEBAR_SHOW",
    action: "EXPAND_SIDEBAR",
  });
  showSidebar();
}

function handleLogoutConfirm() {
  logNavigationEvent({
    source: "keyboard",
    intent: "INTENT_LOGOUT_CONFIRM",
    action: "OPEN_LOGOUT_CONFIRM",
  });
  void confirmAndRequestLogout();
}

function handleWorkspaceLock() {
  logNavigationEvent({
    source: "keyboard",
    intent: "INTENT_WORKSPACE_LOCK",
    action: "LOCK_WORKSPACE",
  });
  lockWorkspace();
}

function handleDeniedIntent(intent) {
  // Deterministic, side-effect-free denial
  console.warn(`[KEYBOARD_DENIED] ${intent}`);
  // future: toast / audit / telemetry
}
