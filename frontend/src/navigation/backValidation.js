/*
 * File-ID: 8.3A
 * File-Path: frontend/src/navigation/backValidation.js
 * Gate: 8
 * Phase: 8
 * Domain: SECURITY
 * Purpose: Validate whether back navigation is allowed
 * Authority: Frontend
 */

import { SCREEN_REGISTRY } from "./screenRegistry.js";

export function isBackAllowed(previousScreenCode) {
  if (!previousScreenCode) return false;

  const screen = SCREEN_REGISTRY[previousScreenCode];
  if (!screen) return false;

  // ACL / snapshot checks will be added in later Gates
  return true;
}
