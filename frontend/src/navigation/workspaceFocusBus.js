/*
 * File-ID: 8.4B
 * File-Path: frontend/src/navigation/workspaceFocusBus.js
 * Gate: 8
 * Phase: 8
 * Domain: FRONT
 * Purpose: Provide deterministic workspace focus command fan-out for protected keyboard navigation
 * Authority: Frontend
 */

const listeners = new Set();

export function dispatchWorkspaceFocusCommand(command) {
  listeners.forEach((listener) => {
    listener(command);
  });
}

export function subscribeWorkspaceFocusCommands(listener) {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}
