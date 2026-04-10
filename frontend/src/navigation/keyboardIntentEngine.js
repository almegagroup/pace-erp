/*
 * File-ID: 8.4
 * File-Path: frontend/src/navigation/keyboardIntentEngine.js
 * Gate: 8
 * Phase: 8
 * Domain: SECURITY
 * Purpose: Centralize keyboard handling as intent source only
 * Authority: Frontend
 */

import { handleKeyboardIntent } from "./keyboardIntentMap.js";
import { isBlockingLayerActive } from "../components/layer/blockingLayerStack.js";
import { isPublicRoute } from "../router/publicRoutes.js";

let keyboardEnabled = false;

export function enableKeyboardIntentEngine() {
  if (keyboardEnabled) return;
  keyboardEnabled = true;

  globalThis.addEventListener("keydown", onKeyDown, true);
}

function onKeyDown(event) {
  const intent = normalizeKeyEvent(event);
  if (!intent) return;

  event.preventDefault();
  handleKeyboardIntent(intent);
}

function normalizeKeyEvent(event) {
  // No screen-level shortcuts allowed
  if (event.defaultPrevented) return null;
  if (isBlockingLayerActive()) return null;
  if (isPublicRoute(globalThis.location.pathname)) return null;

  const key = event.key;
  const ctrl = event.ctrlKey || event.metaKey;
  const shift = event.shiftKey;
  //const _alt = event.altKey;

  // Only normalized, symbolic intents
  if (key === "Escape") return "INTENT_BACK";

  if ((ctrl && key.toLowerCase() === "k") || key === "F9") {
    return "INTENT_GLOBAL_SEARCH";
  }
  if ((ctrl && key.toLowerCase() === "s") || key === "F2") {
    return "INTENT_SCREEN_SAVE";
  }
  if ((event.altKey && key.toLowerCase() === "r") || key === "F4") {
    return "INTENT_SCREEN_REFRESH";
  }
  if (shift && key === "F8") return "INTENT_OPEN_NEW_WINDOW";
  if ((event.altKey && key.toLowerCase() === "w") || key === "F8") {
    return "INTENT_FOCUS_WORK_CONTEXT";
  }
  if ((event.altKey && shift && key.toLowerCase() === "f") || key === "F3") {
    return "INTENT_SCREEN_FOCUS_SEARCH";
  }
  if ((event.altKey && shift && key.toLowerCase() === "p") || key === "F7") {
    return "INTENT_SCREEN_FOCUS_PRIMARY";
  }
  if (isEditableTarget(event.target)) return null;
  if (event.altKey && key === "PageUp") return "INTENT_PAGINATION_PREVIOUS";
  if (event.altKey && key === "PageDown") return "INTENT_PAGINATION_NEXT";
  if (ctrl && key === "ArrowLeft") return "INTENT_SIDEBAR_HIDE";
  if (ctrl && key === "ArrowRight") return "INTENT_SIDEBAR_SHOW";
  if (ctrl && shift && key.toLowerCase() === "l") return "INTENT_LOGOUT_CONFIRM";
  if (event.altKey && key.toLowerCase() === "l") return "INTENT_WORKSPACE_LOCK";
  if (event.altKey && key.toLowerCase() === "h") return "INTENT_GO_HOME";
  if (event.altKey && key.toLowerCase() === "m") return "INTENT_FOCUS_MENU_ZONE";
  if (event.altKey && key.toLowerCase() === "a") return "INTENT_FOCUS_ACTIONS_ZONE";
  if (event.altKey && key.toLowerCase() === "c") return "INTENT_FOCUS_CONTENT_ZONE";
  if (key === "F6" && shift) return "INTENT_FOCUS_PREVIOUS_ZONE";
  if (key === "F6") return "INTENT_FOCUS_NEXT_ZONE";
  if (key === "?") return "INTENT_TOGGLE_SHORTCUT_HELP";

  return null;
}

function isEditableTarget(target) {
  if (!(target instanceof HTMLElement)) return false;

  const tagName = target.tagName;

  return (
    target.isContentEditable ||
    tagName === "INPUT" ||
    tagName === "TEXTAREA" ||
    tagName === "SELECT"
  );
}
