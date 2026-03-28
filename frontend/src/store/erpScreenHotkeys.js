/*
 * File-ID: 8.4F
 * File-Path: frontend/src/store/erpScreenHotkeys.js
 * Gate: 8
 * Phase: 8
 * Domain: FRONT
 * Purpose: Maintain route-level screen hotkeys for shared keyboard-first ERP actions
 * Authority: Frontend
 */

const screenHotkeyRegistry = new Map();

function normalizeAction(action) {
  if (!action || typeof action.perform !== "function") {
    return null;
  }

  return {
    disabled: Boolean(action.disabled),
    perform: action.perform,
  };
}

function normalizeHotkeys(hotkeys) {
  if (!hotkeys || typeof hotkeys !== "object") {
    return {};
  }

  return {
    save: normalizeAction(hotkeys.save),
    refresh: normalizeAction(hotkeys.refresh),
    focusSearch: normalizeAction(hotkeys.focusSearch),
    focusPrimary: normalizeAction(hotkeys.focusPrimary),
  };
}

export function registerErpScreenHotkeys(ownerId, hotkeys) {
  if (!ownerId) {
    return () => {};
  }

  screenHotkeyRegistry.set(ownerId, normalizeHotkeys(hotkeys));

  return () => {
    screenHotkeyRegistry.delete(ownerId);
  };
}

export function executeErpScreenHotkey(type, route = globalThis.location?.pathname ?? "") {
  if (!route || !type) {
    return false;
  }

  const routeHotkeys = screenHotkeyRegistry.get(route);
  const action = routeHotkeys?.[type];

  if (!action || action.disabled) {
    return false;
  }

  action.perform();
  return true;
}
