  /*
 * File-ID: 8.5
 * File-Path: frontend/src/navigation/keyboardAclBridge.js
 * Gate: 8
 * Phase: 8
 * Domain: SECURITY
 * Purpose: Declare keyboard intent → ACL action binding (NO execution)
 * Authority: Frontend
 *
 * IMPORTANT:
 * Gate-8 only DECLARES binding.
 * No ACL evaluation is allowed here.
 */

const INTENT_ACL_MAP = Object.freeze({
  INTENT_BACK: {
    resource: "NAVIGATION",
    action: "BACK",
  },
  INTENT_SIDEBAR_HIDE: {
    resource: "NAVIGATION",
    action: "COLLAPSE_SIDEBAR",
  },
  INTENT_SIDEBAR_SHOW: {
    resource: "NAVIGATION",
    action: "EXPAND_SIDEBAR",
  },
  INTENT_LOGOUT_CONFIRM: {
    resource: "SESSION",
    action: "LOGOUT_CONFIRM",
  },
  // Future examples:
  // INTENT_SAVE: { resource: "DOCUMENT", action: "WRITE" }
});

/**
 * Returns the ACL binding for a keyboard intent.
 * Used by future gates (Gate-10+).
 */
export function getAclBindingForIntent(intent) {
  return INTENT_ACL_MAP[intent] || null;
}

/**
 * Gate-8 rule:
 * ACL is NOT executed here.
 * All intents are allowed by default.
 */
export function isKeyboardIntentAllowed() {
  // Gate-8: ACL execution disabled
  // All intents allowed by default
  return true;
}
