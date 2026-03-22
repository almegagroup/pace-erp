/*
 * File-ID: 8.6
 * File-Path: frontend/src/navigation/navigationPersistence.js
 * Gate: 8
 * Phase: 8
 * Domain: FRONT
 * Purpose: Persist and restore screen stack within session
 * Authority: Frontend
 */

import {
  getStackSnapshot,
  resetStack,
  replaceStack,
} from "./screenStackEngine.js";
import { SCREEN_REGISTRY } from "./screenRegistry.js";

const STORAGE_KEY = "__PACE_NAV_STACK__";

/**
 * Save current stack snapshot into sessionStorage
 */
export function persistNavigationStack() {
  try {
    const snapshot = getStackSnapshot();
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // silent fail — persistence must never block navigation
  }
}

/**
 * Restore stack snapshot on refresh
 */
export function restoreNavigationStack() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return false;

    const snapshot = JSON.parse(raw);
    if (!Array.isArray(snapshot) || snapshot.length === 0) return false;

    const valid = snapshot.every((s) => {
      const reg = SCREEN_REGISTRY[s.screen_code];
      return reg && reg.route === s.route;
    });

    if (!valid) return false;

    replaceStack(snapshot);
    return true;
  } catch {
    return false;
  }
}

/**
 * Clear persisted navigation stack
 */
export function clearNavigationStack() {
  sessionStorage.removeItem(STORAGE_KEY);
  resetStack();
}
