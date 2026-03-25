import { useEffect, useRef } from "react";
import {
  closeBlockingLayer,
  isBlockingLayerActive,
  isTopBlockingLayer,
  openBlockingLayer,
} from "./blockingLayerStack.js";

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function getFocusableElements(container) {
  if (!container) return [];

  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
    (element) =>
      element instanceof HTMLElement &&
      !element.hasAttribute("disabled") &&
      element.getAttribute("aria-hidden") !== "true"
  );
}

export default function BlockingLayer({
  visible,
  onEscape,
  children,
  overlayStyle,
  dialogStyle,
  initialFocusRef,
  dialogProps,
}) {
  const dialogRef = useRef(null);
  const layerIdRef = useRef(null);
  const previousFocusRef = useRef(null);
  const previousOverflowRef = useRef("");

  useEffect(() => {
    if (!visible) {
      return undefined;
    }

    previousFocusRef.current = document.activeElement;
    previousOverflowRef.current = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const appShell = document.getElementById("app-shell");
    if (appShell) {
      appShell.setAttribute("inert", "");
      appShell.setAttribute("aria-hidden", "true");
    }

    const layerId = openBlockingLayer();
    layerIdRef.current = layerId;

    const focusInitialElement = () => {
      if (!isTopBlockingLayer(layerId)) return;

      const preferred = initialFocusRef?.current;
      const focusable = getFocusableElements(dialogRef.current);
      const fallback = focusable[0] ?? dialogRef.current;
      const target =
        preferred instanceof HTMLElement ? preferred : fallback;

      if (target instanceof HTMLElement) {
        target.focus();
      }
    };

    const onKeyDown = (event) => {
      if (!isTopBlockingLayer(layerId)) return;

      if (event.key === "Tab") {
        const focusable = getFocusableElements(dialogRef.current);

        if (focusable.length === 0) {
          event.preventDefault();
          dialogRef.current?.focus();
          return;
        }

        const currentIndex = focusable.indexOf(document.activeElement);
        const nextIndex = event.shiftKey
          ? currentIndex <= 0
            ? focusable.length - 1
            : currentIndex - 1
          : currentIndex === -1 || currentIndex === focusable.length - 1
            ? 0
            : currentIndex + 1;

        event.preventDefault();
        focusable[nextIndex]?.focus();
        return;
      }

      if (event.key === "Escape" && typeof onEscape === "function") {
        event.preventDefault();
        event.stopPropagation();
        onEscape();
      }
    };

    const onFocusIn = (event) => {
      if (!isTopBlockingLayer(layerId)) return;

      const dialog = dialogRef.current;
      if (!dialog || dialog.contains(event.target)) return;

      const focusable = getFocusableElements(dialog);
      const fallback = initialFocusRef?.current ?? focusable[0] ?? dialog;

      if (fallback instanceof HTMLElement) {
        fallback.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("focusin", onFocusIn, true);
    window.setTimeout(focusInitialElement, 0);

    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("focusin", onFocusIn, true);
      closeBlockingLayer(layerId);

      if (!isBlockingLayerActive()) {
        document.body.style.overflow = previousOverflowRef.current;
        if (appShell) {
          appShell.removeAttribute("inert");
          appShell.removeAttribute("aria-hidden");
        }
      }

      if (previousFocusRef.current instanceof HTMLElement) {
        previousFocusRef.current.focus();
      }
    };
  }, [initialFocusRef, onEscape, visible]);

  if (!visible) return null;

  return (
    <div style={overlayStyle} aria-modal="true" role="dialog">
      <div
        ref={dialogRef}
        style={dialogStyle}
        tabIndex={-1}
        {...dialogProps}
      >
        {children}
      </div>
    </div>
  );
}
