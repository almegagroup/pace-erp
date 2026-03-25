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

  handleKeyboardIntent(intent);
}

function normalizeKeyEvent(event) {
  // No screen-level shortcuts allowed
  if (event.defaultPrevented) return null;
  if (isBlockingLayerActive()) return null;
  if (isPublicRoute(globalThis.location.pathname)) return null;

  const key = event.key;
  const ctrl = event.ctrlKey || event.metaKey;
  //const _shift = event.shiftKey;
  //const _alt = event.altKey;

  // Only normalized, symbolic intents
  if (key === "Escape") return "INTENT_BACK";

  if (ctrl && key === "k") return "INTENT_GLOBAL_SEARCH";

  return null;
}
