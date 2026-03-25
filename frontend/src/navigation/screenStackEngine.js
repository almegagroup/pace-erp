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

const screenStack = [];
const stackListeners = new Set();

const ROUTE_TO_SCREEN_CODE = new Map(
  Object.values(SCREEN_REGISTRY).map((screen) => [screen.route, screen.screen_code])
);

function buildScreenEntry(screenCode) {
  const screen = SCREEN_REGISTRY[screenCode];
  assert(screen, `Unknown screen: ${screenCode}`);

  return {
    screen_code: screen.screen_code,
    route: screen.route,
    type: screen.type,
    keepAlive: screen.keepAlive,
    universe: screen.universe,
  };
}

function emitStackChange(action) {
  const snapshot = [...screenStack];
  const active = snapshot[snapshot.length - 1] ?? null;

  if (snapshot.length > 0) {
    persistNavigationStack();
  }

  logNavigationEvent({
    type: action,
    active_screen: active?.screen_code ?? null,
    route: active?.route ?? null,
    depth: snapshot.length,
  });

  stackListeners.forEach((listener) => {
    listener(snapshot, {
      action,
      activeScreen: active,
    });
  });
}

export function subscribeToStack(listener) {
  stackListeners.add(listener);
  listener([...screenStack], {
    action: "SYNC",
    activeScreen: getActiveScreen(),
  });

  return () => {
    stackListeners.delete(listener);
  };
}

export function hasActiveStack() {
  return screenStack.length > 0;
}

export function getScreenCodeForRoute(route) {
  return ROUTE_TO_SCREEN_CODE.get(route) ?? null;
}

export function getScreenForRoute(route) {
  const screenCode = getScreenCodeForRoute(route);
  return screenCode ? SCREEN_REGISTRY[screenCode] : null;
}

/**
 * Initialize navigation with a root screen.
 * Must be called exactly once at app bootstrap.
 */
export function initNavigation(rootScreenCode) {
  if (screenStack.length > 0) {
    return getActiveScreen();
  }

  screenStack.push(buildScreenEntry(rootScreenCode));
  emitStackChange("INIT");
  return getActiveScreen();
}

/**
 * Push a new screen onto the stack.
 */
export function pushScreen(screenCode) {
  if (screenStack.length === 0) {
    return resetToScreen(screenCode);
  }

  const nextScreen = buildScreenEntry(screenCode);
  const active = getActiveScreen();

  if (active?.screen_code === nextScreen.screen_code) {
    return active;
  }

  screenStack.push(nextScreen);
  emitStackChange("PUSH");
  return nextScreen;
}

/**
 * Replace current screen with another.
 * Root screen cannot be replaced.
 */
export function replaceScreen(screenCode) {
  const nextScreen = buildScreenEntry(screenCode);

  if (screenStack.length === 0) {
    screenStack.push(nextScreen);
  } else {
    screenStack[screenStack.length - 1] = nextScreen;
  }

  emitStackChange("REPLACE");
  return nextScreen;
}

export function resetToScreen(screenCode) {
  const rootScreen = buildScreenEntry(screenCode);

  screenStack.length = 0;
  screenStack.push(rootScreen);

  emitStackChange("RESET");
  return rootScreen;
}

export function openScreen(screenCode, options = {}) {
  const mode = options.mode ?? "push";

  switch (mode) {
    case "replace":
      return replaceScreen(screenCode);
    case "reset":
      return resetToScreen(screenCode);
    default:
      return pushScreen(screenCode);
  }
}

export function openRoute(route, options = {}) {
  const screenCode = getScreenCodeForRoute(route);
  assert(screenCode, `Unknown route: ${route}`);

  return openScreen(screenCode, options);
}

/**
 * Pop current screen.
 * Root screen cannot be popped.
 */
export function popScreen() {
  assert(screenStack.length > 1, "Cannot pop root screen");
  screenStack.pop();
  emitStackChange("POP");
  return getActiveScreen();
}

/**
 * Return currently active screen.
 */
export function getActiveScreen() {
  return screenStack[screenStack.length - 1] ?? null;
}

export function getPreviousScreen() {
  if (screenStack.length < 2) return null;
  return screenStack[screenStack.length - 2];
}

export function getStackDepth() {
  return screenStack.length;
}

/**
 * Return immutable snapshot of stack.
 */
export function getStackSnapshot() {
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
  newStack.forEach((screen) => screenStack.push({
    ...buildScreenEntry(screen.screen_code),
  }));
  emitStackChange("RESTORE");
}

/**
 * Reset navigation stack completely.
 * Used on logout / SESSION_* events.
 */
export function resetStack() {
  screenStack.length = 0;
  logNavigationEvent({
    type: "CLEAR",
    active_screen: null,
    route: null,
    depth: 0,
  });

  stackListeners.forEach((listener) => {
    listener([], {
      action: "CLEAR",
      activeScreen: null,
    });
  });
}
