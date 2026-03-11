/*
 * File-ID: 8.2
 * File-Path: frontend/src/navigation/screenStackEngine.js
 * Gate: 8
 * Phase: 8
 * Domain: FRONT
 * Purpose: Execute deterministic screen stack navigation
 * Authority: Frontend
 */

import { SCREEN_REGISTRY } from "./screenRegistry.js";
import { persistNavigationStack } from "./navigationPersistence.js";
import { logNavigationEvent } from "./navigationEventLogger.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(`[SCREEN_STACK_ENGINE] ${message}`);
  }
}

/**
 * Internal navigation stack.
 * Root screen is always present once initialized.
 */
const screenStack = [];

/**
 * Initialize navigation with a root screen.
 * Must be called exactly once at app bootstrap.
 */
export function initNavigation(rootScreenCode) {
  assert(
    screenStack.length === 0,
    "Navigation already initialized"
  );

  const screen = SCREEN_REGISTRY[rootScreenCode];
  assert(screen, `Unknown root screen: ${rootScreenCode}`);

screenStack.push({
  screen_code: rootScreenCode,
  route: screen.route,
  type: screen.type,
  keepAlive: screen.keepAlive,
});

persistNavigationStack();
logNavigationEvent({
  type: "PUSH",
  screen: rootScreenCode,
});
}

/**
 * Push a new screen onto the stack.
 */
export function pushScreen(screenCode) {
  assert(screenStack.length > 0, "Navigation not initialized");

  const screen = SCREEN_REGISTRY[screenCode];
  assert(screen, `Unknown screen: ${screenCode}`);

  screenStack.push({
    screen_code: screenCode,
    route: screen.route,
    type: screen.type,
    keepAlive: screen.keepAlive,
  });

  persistNavigationStack();
}

/**
 * Replace current screen with another.
 * Root screen cannot be replaced.
 */
export function replaceScreen(screenCode) {
  assert(screenStack.length > 1, "Cannot replace root screen");

  const screen = SCREEN_REGISTRY[screenCode];
  assert(screen, `Unknown screen: ${screenCode}`);

 screenStack.pop();
screenStack.push({
  screen_code: screenCode,
  route: screen.route,
  type: screen.type,
  keepAlive: screen.keepAlive,
});

persistNavigationStack();
logNavigationEvent({
  type: "REPLACE",
  screen: screenCode,
});
}

/**
 * Pop current screen.
 * Root screen cannot be popped.
 */
export function popScreen() {
  assert(screenStack.length > 1, "Cannot pop root screen");
  screenStack.pop();
persistNavigationStack();
logNavigationEvent({
  type: "POP",
});
}

/**
 * Return currently active screen.
 */
export function getActiveScreen() {
  assert(screenStack.length > 0, "Navigation not initialized");
  return screenStack[screenStack.length - 1];
}

/**
 * Return immutable snapshot of stack.
 */
export function getStackSnapshot() {
  assert(screenStack.length > 0, "Navigation not initialized");
  return [...screenStack];
}
/**
 * Replace entire navigation stack.
 * Used ONLY for session restore.
 */
export function replaceStack(newStack) {
  assert(
    Array.isArray(newStack) && newStack.length > 0,
    "Invalid stack replacement"
  );

  const valid = newStack.every((s) => {
    const reg = SCREEN_REGISTRY[s.screen_code];
    return reg && reg.route === s.route;
  });

  assert(valid, "Stack restore contains invalid screen");

  screenStack.length = 0;
  newStack.forEach((screen) => screenStack.push(screen));
}

/**
 * Reset navigation stack completely.
 * Used on logout / SESSION_* events.
 */
export function resetStack() {
  screenStack.length = 0;
}
