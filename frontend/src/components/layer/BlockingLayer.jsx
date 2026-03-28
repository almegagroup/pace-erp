import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
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

const NAVIGATION_GROUP_SELECTOR = "[data-erp-nav-group='true']";
const NAVIGATION_ITEM_SELECTOR = "[data-erp-nav-item='true']";

function getFocusableElements(container) {
  if (!container) return [];

  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
    (element) =>
      element instanceof HTMLElement &&
      !element.hasAttribute("disabled") &&
      element.getAttribute("aria-hidden") !== "true"
  );
}

function isEditableElement(target) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName;

  return (
    target.isContentEditable ||
    tagName === "INPUT" ||
    tagName === "TEXTAREA" ||
    tagName === "SELECT"
  );
}

function getNavigationGroup(target, container) {
  if (!(target instanceof HTMLElement) || !(container instanceof HTMLElement)) {
    return null;
  }

  const group = target.closest(NAVIGATION_GROUP_SELECTOR);
  if (!(group instanceof HTMLElement)) {
    return null;
  }

  return container.contains(group) ? group : null;
}

function getNavigationItems(group) {
  if (!(group instanceof HTMLElement)) {
    return [];
  }

  const preferredItems = Array.from(
    group.querySelectorAll(NAVIGATION_ITEM_SELECTOR)
  ).filter(
    (element) =>
      element instanceof HTMLElement &&
      element.closest(NAVIGATION_GROUP_SELECTOR) === group &&
      !element.hasAttribute("disabled") &&
      element.getAttribute("aria-hidden") !== "true"
  );

  if (preferredItems.length > 0) {
    return preferredItems;
  }

  return getFocusableElements(group).filter(
    (element) => element.closest(NAVIGATION_GROUP_SELECTOR) === group
  );
}

function getNavigationDirection(group, key) {
  const axis = group?.getAttribute("data-erp-nav-axis") ?? "horizontal";

  if (axis === "vertical") {
    if (key === "ArrowDown") return 1;
    if (key === "ArrowUp") return -1;
    return 0;
  }

  if (key === "ArrowRight") return 1;
  if (key === "ArrowLeft") return -1;
  if (key === "ArrowDown") return 1;
  if (key === "ArrowUp") return -1;
  return 0;
}

function shouldIgnoreNavigationKey(group, target, key) {
  if (!isEditableElement(target)) {
    return false;
  }

  if (!(group instanceof HTMLElement)) {
    return true;
  }

  const allowEditable =
    group.getAttribute("data-erp-nav-allow-editable") === "true";
  const axis = group.getAttribute("data-erp-nav-axis") ?? "horizontal";

  if (!allowEditable) {
    return true;
  }

  if (axis !== "vertical") {
    return true;
  }

  return key === "ArrowLeft" || key === "ArrowRight";
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
      const activeElement = document.activeElement;
      if (
        activeElement instanceof HTMLElement &&
        appShell.contains(activeElement)
      ) {
        activeElement.blur();
      }
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

      const dialog = dialogRef.current;
      const navigationGroup = getNavigationGroup(event.target, dialog);

      if (navigationGroup && !shouldIgnoreNavigationKey(navigationGroup, event.target, event.key)) {
        const items = getNavigationItems(navigationGroup);

        if (items.length > 0) {
          if (event.key === "Home") {
            event.preventDefault();
            items[0]?.focus();
            return;
          }

          if (event.key === "End") {
            event.preventDefault();
            items[items.length - 1]?.focus();
            return;
          }

          const direction = getNavigationDirection(navigationGroup, event.key);
          if (direction !== 0) {
            const currentIndex = items.indexOf(event.target);
            const nextIndex =
              currentIndex === -1
                ? 0
                : (currentIndex + direction + items.length) % items.length;

            event.preventDefault();
            items[nextIndex]?.focus();
            return;
          }
        }
      }

      if (event.key === "Tab") {
        const focusable = getFocusableElements(dialog);

        if (focusable.length === 0) {
          event.preventDefault();
          dialog?.focus();
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
      }

      if (previousFocusRef.current instanceof HTMLElement) {
        previousFocusRef.current.focus();
      }
    };
  }, [initialFocusRef, onEscape, visible]);

  if (!visible) return null;

  return createPortal(
    <div style={overlayStyle} aria-modal="true" role="dialog">
      <div
        ref={dialogRef}
        style={dialogStyle}
        tabIndex={-1}
        {...dialogProps}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
