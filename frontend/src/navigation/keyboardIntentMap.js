/*
 * File-ID: 8.4A
 * File-Path: frontend/src/navigation/keyboardIntentMap.js
 * Gate: 8
 * Phase: 8
 * Domain: SECURITY
 * Purpose: Deterministic keyboard intent handling (G5-ready)
 * Authority: Frontend
 */

import { popScreen } from "./screenStackEngine.js";
import { isKeyboardIntentAllowed } from "./keyboardAclBridge.js";
import { logNavigationEvent } from "./navigationEventLogger.js";

/**
 * SECURITY ALLOWLIST
 * Only declared intents can execute handlers.
 */
const INTENT_HANDLERS = Object.freeze({
  INTENT_BACK: handleBack,
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
  logNavigationEvent({
    source: "keyboard",
    intent: "INTENT_BACK",
    action: "POP_SCREEN",
  });
  popScreen();
}

function handleDeniedIntent(intent) {
  // Deterministic, side-effect-free denial
  console.warn(`[KEYBOARD_DENIED] ${intent}`);
  // future: toast / audit / telemetry
}
