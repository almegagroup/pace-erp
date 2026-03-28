/*
 * File-ID: 8.4C
 * File-Path: frontend/src/store/erpCommandPalette.js
 * Gate: 8
 * Phase: 8
 * Domain: FRONT
 * Purpose: Maintain protected-shell command palette visibility and screen command registry
 * Authority: Frontend
 */

const overlayListeners = new Set();
const commandListeners = new Set();

let overlayState = {
  visible: false,
};

const screenCommandRegistry = new Map();

function normalizeCommand(command, index = 0) {
  if (!command || typeof command.perform !== "function" || !command.label) {
    return null;
  }

  return {
    id: command.id ?? `${command.label}-${index}`,
    label: command.label,
    group: command.group ?? "Current Screen",
    hint: command.hint ?? "",
    keywords: Array.isArray(command.keywords) ? command.keywords : [],
    disabled: Boolean(command.disabled),
    order: Number.isFinite(command.order) ? command.order : index,
    perform: command.perform,
  };
}

function emitOverlay() {
  const snapshot = { ...overlayState };
  overlayListeners.forEach((listener) => listener(snapshot));
}

function emitCommands() {
  const snapshot = getRegisteredScreenCommands();
  commandListeners.forEach((listener) => listener(snapshot));
}

export function openErpCommandPalette() {
  if (overlayState.visible) {
    return;
  }

  overlayState = {
    visible: true,
  };
  emitOverlay();
}

export function closeErpCommandPalette() {
  if (!overlayState.visible) {
    return;
  }

  overlayState = {
    visible: false,
  };
  emitOverlay();
}

export function subscribeErpCommandPalette(listener) {
  overlayListeners.add(listener);
  listener({ ...overlayState });

  return () => {
    overlayListeners.delete(listener);
  };
}

export function registerErpScreenCommands(ownerId, commands) {
  if (!ownerId) {
    return () => {};
  }

  const normalized = Array.isArray(commands)
    ? commands
        .map((command, index) => normalizeCommand(command, index))
        .filter(Boolean)
    : [];

  screenCommandRegistry.set(ownerId, normalized);
  emitCommands();

  return () => {
    if (!screenCommandRegistry.has(ownerId)) {
      return;
    }

    screenCommandRegistry.delete(ownerId);
    emitCommands();
  };
}

export function getRegisteredScreenCommands() {
  return new Map(screenCommandRegistry);
}

export function subscribeRegisteredScreenCommands(listener) {
  commandListeners.add(listener);
  listener(getRegisteredScreenCommands());

  return () => {
    commandListeners.delete(listener);
  };
}
