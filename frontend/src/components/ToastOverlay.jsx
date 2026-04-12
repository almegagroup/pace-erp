/*
 * File-ID: UI-TOAST-2
 * File-Path: frontend/src/components/ToastOverlay.jsx
 * Gate: UI
 * Phase: UI
 * Domain: FRONT
 * Purpose: Render bottom-right toast stack for shared scaffold notices
 * Authority: Frontend
 */

import { useEffect, useState } from "react";
import {
  dismissToast,
  subscribeToasts,
  unsubscribeToasts,
} from "../store/uiToast.js";

const TOAST_TONE_CLASS = Object.freeze({
  success: "border-emerald-300 bg-emerald-50 text-emerald-950",
  error: "border-rose-300 bg-rose-50 text-rose-950",
  info: "border-sky-300 bg-sky-50 text-sky-950",
  neutral: "border-slate-300 bg-slate-50 text-slate-950",
});

const TOAST_TONE_LABEL = Object.freeze({
  success: "Saved",
  error: "Attention Required",
  info: "Heads Up",
  neutral: "Status",
});

export default function ToastOverlay() {
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    subscribeToasts(setToasts);
    return () => unsubscribeToasts(setToasts);
  }, []);

  if (toasts.length === 0) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[1400] flex w-[min(380px,calc(100vw-24px))] flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`pointer-events-auto border shadow-[0_14px_36px_rgba(15,23,42,0.16)] ${TOAST_TONE_CLASS[toast.tone] ?? TOAST_TONE_CLASS.info}`}
        >
          <div className="flex items-start justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] opacity-70">
                {toast.title || TOAST_TONE_LABEL[toast.tone] || TOAST_TONE_LABEL.info}
              </div>
              <div className="mt-1 break-words text-sm leading-6">
                {toast.message}
              </div>
            </div>
            <button
              type="button"
              onClick={() => dismissToast(toast.id)}
              className="border border-current/20 bg-white/70 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] hover:bg-white"
            >
              Close
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
