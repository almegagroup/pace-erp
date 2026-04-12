/*
 * File-ID: UI-TOAST-1
 * File-Path: frontend/src/store/uiToast.js
 * Gate: UI
 * Phase: UI
 * Domain: FRONT
 * Purpose: Lightweight global toast store for non-blocking status popups
 * Authority: Frontend
 */

const DEFAULT_DURATION_MS = 5000;
const TONE_DURATION_MS = Object.freeze({
  success: 4200,
  info: 5000,
  neutral: 5000,
  error: 7000,
});

let toasts = [];
let listeners = [];

function emit() {
  const snapshot = toasts.map((toast) => ({ ...toast }));
  listeners.forEach((listener) => listener(snapshot));
}

export function subscribeToasts(listener) {
  listeners.push(listener);
  listener(toasts.map((toast) => ({ ...toast })));
}

export function unsubscribeToasts(listener) {
  listeners = listeners.filter((entry) => entry !== listener);
}

export function dismissToast(id) {
  toasts = toasts.filter((toast) => toast.id !== id);
  emit();
}

export function pushToast(config) {
  const message =
    typeof config?.message === "string" ? config.message.trim() : "";

  if (!message) {
    return null;
  }

  const id =
    config?.id ??
    (globalThis.crypto?.randomUUID
      ? globalThis.crypto.randomUUID()
      : `toast-${Date.now()}-${Math.random().toString(16).slice(2)}`);

  const tone = config?.tone ?? "info";
  const durationMs =
    typeof config?.durationMs === "number"
      ? config.durationMs
      : TONE_DURATION_MS[tone] ?? DEFAULT_DURATION_MS;

  const toast = {
    id,
    tone,
    title: config?.title ?? "",
    message,
  };

  toasts = [...toasts.filter((entry) => entry.id !== id), toast];
  emit();

  if (durationMs > 0) {
    globalThis.setTimeout(() => {
      dismissToast(id);
    }, durationMs);
  }

  return id;
}
