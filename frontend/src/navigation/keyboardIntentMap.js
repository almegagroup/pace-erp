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
import { dispatchWorkspaceFocusCommand } from "./workspaceFocusBus.js";
import { openErpCommandPalette } from "../store/erpCommandPalette.js";
import { executeErpScreenHotkey } from "../store/erpScreenHotkeys.js";

/**
 * SECURITY ALLOWLIST
 * Only declared intents can execute handlers.
 */
const INTENT_HANDLERS = Object.freeze({
  INTENT_BACK: handleBack,
  INTENT_GLOBAL_SEARCH: handleGlobalSearch,
  INTENT_SCREEN_SAVE: handleScreenSave,
  INTENT_SCREEN_REFRESH: handleScreenRefresh,
  INTENT_OPEN_NEW_WINDOW: handleOpenNewWindow,
  INTENT_SCREEN_FOCUS_SEARCH: handleScreenFocusSearch,
  INTENT_SCREEN_FOCUS_PRIMARY: handleScreenFocusPrimary,
  INTENT_SIDEBAR_HIDE: handleSidebarHide,
  INTENT_SIDEBAR_SHOW: handleSidebarShow,
  INTENT_LOGOUT_CONFIRM: handleLogoutConfirm,
  INTENT_WORKSPACE_LOCK: handleWorkspaceLock,
  INTENT_GO_HOME: handleGoHome,
  INTENT_FOCUS_MENU_ZONE: handleFocusMenuZone,
  INTENT_FOCUS_ACTIONS_ZONE: handleFocusActionsZone,
  INTENT_FOCUS_CONTENT_ZONE: handleFocusContentZone,
  INTENT_FOCUS_NEXT_ZONE: handleFocusNextZone,
  INTENT_FOCUS_PREVIOUS_ZONE: handleFocusPreviousZone,
  INTENT_TOGGLE_SHORTCUT_HELP: handleToggleShortcutHelp,
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

function handleGlobalSearch() {
  logNavigationEvent({
    source: "keyboard",
    intent: "INTENT_GLOBAL_SEARCH",
    action: "OPEN_COMMAND_PALETTE",
  });
  openErpCommandPalette();
}

function handleScreenSave() {
  const executed = executeErpScreenHotkey("save");
  if (!executed) {
    return;
  }

  logNavigationEvent({
    source: "keyboard",
    intent: "INTENT_SCREEN_SAVE",
    action: "SCREEN_SAVE",
  });
}

function handleScreenRefresh() {
  const executed = executeErpScreenHotkey("refresh");
  if (!executed) {
    return;
  }

  logNavigationEvent({
    source: "keyboard",
    intent: "INTENT_SCREEN_REFRESH",
    action: "SCREEN_REFRESH",
  });
}

function handleOpenNewWindow() {
  logNavigationEvent({
    source: "keyboard",
    intent: "INTENT_OPEN_NEW_WINDOW",
    action: "OPEN_NEW_WINDOW",
  });
  dispatchWorkspaceFocusCommand("OPEN_NEW_WINDOW");
}

function handleScreenFocusSearch() {
  const executed = executeErpScreenHotkey("focusSearch");
  if (!executed) {
    return;
  }

  logNavigationEvent({
    source: "keyboard",
    intent: "INTENT_SCREEN_FOCUS_SEARCH",
    action: "SCREEN_FOCUS_SEARCH",
  });
}

function handleScreenFocusPrimary() {
  const executed = executeErpScreenHotkey("focusPrimary");
  if (!executed) {
    return;
  }

  logNavigationEvent({
    source: "keyboard",
    intent: "INTENT_SCREEN_FOCUS_PRIMARY",
    action: "SCREEN_FOCUS_PRIMARY",
  });
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

function handleGoHome() {
  logNavigationEvent({
    source: "keyboard",
    intent: "INTENT_GO_HOME",
    action: "GO_HOME",
  });
  dispatchWorkspaceFocusCommand("GO_HOME");
}

function handleFocusMenuZone() {
  logNavigationEvent({
    source: "keyboard",
    intent: "INTENT_FOCUS_MENU_ZONE",
    action: "FOCUS_MENU_ZONE",
  });
  dispatchWorkspaceFocusCommand("FOCUS_MENU_ZONE");
}

function handleFocusActionsZone() {
  logNavigationEvent({
    source: "keyboard",
    intent: "INTENT_FOCUS_ACTIONS_ZONE",
    action: "FOCUS_ACTIONS_ZONE",
  });
  dispatchWorkspaceFocusCommand("FOCUS_ACTIONS_ZONE");
}

function handleFocusContentZone() {
  logNavigationEvent({
    source: "keyboard",
    intent: "INTENT_FOCUS_CONTENT_ZONE",
    action: "FOCUS_CONTENT_ZONE",
  });
  dispatchWorkspaceFocusCommand("FOCUS_CONTENT_ZONE");
}

function handleFocusNextZone() {
  logNavigationEvent({
    source: "keyboard",
    intent: "INTENT_FOCUS_NEXT_ZONE",
    action: "FOCUS_NEXT_ZONE",
  });
  dispatchWorkspaceFocusCommand("FOCUS_NEXT_ZONE");
}

function handleFocusPreviousZone() {
  logNavigationEvent({
    source: "keyboard",
    intent: "INTENT_FOCUS_PREVIOUS_ZONE",
    action: "FOCUS_PREVIOUS_ZONE",
  });
  dispatchWorkspaceFocusCommand("FOCUS_PREVIOUS_ZONE");
}

function handleToggleShortcutHelp() {
  logNavigationEvent({
    source: "keyboard",
    intent: "INTENT_TOGGLE_SHORTCUT_HELP",
    action: "TOGGLE_SHORTCUT_HELP",
  });
  dispatchWorkspaceFocusCommand("TOGGLE_SHORTCUT_HELP");
}

function handleDeniedIntent(intent) {
  // Deterministic, side-effect-free denial
  console.warn(`[KEYBOARD_DENIED] ${intent}`);
  // future: toast / audit / telemetry
}
