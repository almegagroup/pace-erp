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
const screenRefreshCallbacks = new Map();
const pendingScreenRefreshes = new Map();

const ROUTE_TO_SCREEN_CODE = new Map(
  Object.values(SCREEN_REGISTRY).map((screen) => [screen.route, screen.screen_code])
);

function generateStackEntryId() {
  if (typeof globalThis?.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return `stack-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeContext(context) {
  if (!context || typeof context !== "object" || Array.isArray(context)) {
    return null;
  }

  return { ...context };
}

function buildScreenEntry(screenCode, extras = {}) {
  const screen = SCREEN_REGISTRY[screenCode];
  assert(screen, `Unknown screen: ${screenCode}`);

  return {
    stack_entry_id: extras.stack_entry_id ?? generateStackEntryId(),
    screen_code: screen.screen_code,
    route: screen.route,
    type: screen.type,
    keepAlive: screen.keepAlive,
    universe: screen.universe,
    context: normalizeContext(extras.context),
  };
}

function pruneRefreshCallbacks() {
  const activeEntryIds = new Set(
    screenStack.map((entry) => entry?.stack_entry_id).filter(Boolean)
  );

  Array.from(screenRefreshCallbacks.keys()).forEach((entryId) => {
    if (!activeEntryIds.has(entryId)) {
      screenRefreshCallbacks.delete(entryId);
    }
  });

  Array.from(pendingScreenRefreshes.keys()).forEach((entryId) => {
    if (!activeEntryIds.has(entryId)) {
      pendingScreenRefreshes.delete(entryId);
    }
  });
}

function dispatchRefreshSignal(targetEntryId, meta) {
  if (!targetEntryId || !meta) {
    return;
  }

  const refreshCallback = screenRefreshCallbacks.get(targetEntryId);

  if (typeof refreshCallback === "function") {
    queueMicrotask(() => {
      refreshCallback(meta);
    });
    return;
  }

  pendingScreenRefreshes.set(targetEntryId, meta);
}

function emitStackChange(action) {
  const snapshot = [...screenStack];
  const active = snapshot[snapshot.length - 1] ?? null;

  pruneRefreshCallbacks();

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
export function pushScreen(screenCode, options = {}) {
  if (screenStack.length === 0) {
    return resetToScreen(screenCode, options);
  }

  const nextScreen = buildScreenEntry(screenCode, {
    context: options.context,
  });
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
export function replaceScreen(screenCode, options = {}) {
  const nextScreen = buildScreenEntry(screenCode, {
    context: options.context,
  });

  if (screenStack.length === 0) {
    screenStack.push(nextScreen);
  } else {
    screenStack[screenStack.length - 1] = nextScreen;
  }

  emitStackChange("REPLACE");
  return nextScreen;
}

export function resetToScreen(screenCode, options = {}) {
  const rootScreen = buildScreenEntry(screenCode, {
    context: options.context,
  });

  screenStack.length = 0;
  screenStack.push(rootScreen);

  emitStackChange("RESET");
  return rootScreen;
}

export function openScreen(screenCode, options = {}) {
  const mode = options.mode ?? "push";

  switch (mode) {
    case "replace":
      return replaceScreen(screenCode, options);
    case "reset":
      return resetToScreen(screenCode, options);
    default:
      return pushScreen(screenCode, options);
  }
}

export function openScreenWithContext(screenCode, context = {}, options = {}) {
  const active = getActiveScreen();
  const normalizedContext = normalizeContext(context) ?? {};

  return openScreen(screenCode, {
    ...options,
    context: {
      ...normalizedContext,
      contextKind:
        normalizedContext.contextKind ??
        (normalizedContext.refreshOnReturn ||
        normalizedContext.returnScreenCode ||
        normalizedContext.returnStackEntryId
          ? "DRILL_THROUGH"
          : "SCREEN_CONTEXT"),
      returnScreenCode:
        normalizedContext.returnScreenCode ?? active?.screen_code ?? null,
      returnStackEntryId:
        normalizedContext.returnStackEntryId ?? active?.stack_entry_id ?? null,
      refreshOnReturn: Boolean(normalizedContext.refreshOnReturn),
    },
  });
}

export function openRoute(route, options = {}) {
  const screenCode = getScreenCodeForRoute(route);
  assert(screenCode, `Unknown route: ${route}`);

  return openScreen(screenCode, options);
}

export function openRouteWithContext(route, context = {}, options = {}) {
  const screenCode = getScreenCodeForRoute(route);
  assert(screenCode, `Unknown route: ${route}`);

  return openScreenWithContext(screenCode, context, options);
}

function maybeRefreshParentAfterReturn(poppedScreen, nextActiveScreen) {
  if (
    poppedScreen?.context?.contextKind !== "DRILL_THROUGH" ||
    !poppedScreen?.context?.refreshOnReturn
  ) {
    return;
  }

  const expectedEntryId = poppedScreen.context.returnStackEntryId ?? null;
  const expectedScreenCode = poppedScreen.context.returnScreenCode ?? null;

  const matchesExpectedEntry =
    !expectedEntryId || expectedEntryId === nextActiveScreen?.stack_entry_id;
  const matchesExpectedScreen =
    !expectedScreenCode || expectedScreenCode === nextActiveScreen?.screen_code;

  if (!matchesExpectedEntry || !matchesExpectedScreen) {
    return;
  }

  dispatchRefreshSignal(nextActiveScreen?.stack_entry_id, {
    source: "return-refresh",
    fromScreen: poppedScreen.screen_code,
    toScreen: nextActiveScreen.screen_code,
    context: normalizeContext(poppedScreen.context),
  });
}

/**
 * Pop current screen.
 * Root screen cannot be popped.
 */
export function popScreen() {
  assert(screenStack.length > 1, "Cannot pop root screen");
  const poppedScreen = screenStack.pop();
  emitStackChange("POP");
  const nextActiveScreen = getActiveScreen();
  maybeRefreshParentAfterReturn(poppedScreen, nextActiveScreen);
  return nextActiveScreen;
}

/**
 * Return currently active screen.
 */
export function getActiveScreen() {
  return screenStack[screenStack.length - 1] ?? null;
}

export function getActiveScreenEntryId() {
  return getActiveScreen()?.stack_entry_id ?? null;
}

export function getActiveScreenContext() {
  return normalizeContext(getActiveScreen()?.context);
}

export function updateActiveScreenContext(contextPatch) {
  const activeScreen = getActiveScreen();
  const normalizedPatch = normalizeContext(contextPatch);

  if (!activeScreen || !normalizedPatch) {
    return activeScreen ?? null;
  }

  activeScreen.context = {
    ...(normalizeContext(activeScreen.context) ?? {}),
    ...normalizedPatch,
  };

  emitStackChange("CONTEXT_UPDATE");
  return activeScreen;
}

export function getScreenContext(screenCode = null) {
  if (!screenCode) {
    return getActiveScreenContext();
  }

  const matchingScreen = [...screenStack]
    .reverse()
    .find((entry) => entry.screen_code === screenCode);

  return normalizeContext(matchingScreen?.context);
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

export function registerScreenRefreshCallback(callback, options = {}) {
  assert(
    typeof callback === "function",
    "Refresh callback must be a function"
  );

  const targetEntryId =
    options.screenEntryId ?? getActiveScreen()?.stack_entry_id ?? null;

  if (!targetEntryId) {
    return () => {};
  }

  screenRefreshCallbacks.set(targetEntryId, callback);

  const pendingMeta = pendingScreenRefreshes.get(targetEntryId);
  if (pendingMeta) {
    pendingScreenRefreshes.delete(targetEntryId);
    queueMicrotask(() => {
      callback(pendingMeta);
    });
  }

  return () => {
    const activeCallback = screenRefreshCallbacks.get(targetEntryId);
    if (activeCallback === callback) {
      screenRefreshCallbacks.delete(targetEntryId);
    }
  };
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
  newStack.forEach((screen) =>
    screenStack.push({
      ...buildScreenEntry(screen.screen_code, {
        stack_entry_id: screen.stack_entry_id,
        context: screen.context,
      }),
    })
  );
  emitStackChange("RESTORE");
}

/**
 * Reset navigation stack completely.
 * Used on logout / SESSION_* events.
 */
export function resetStack() {
  screenStack.length = 0;
  screenRefreshCallbacks.clear();
  pendingScreenRefreshes.clear();
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
