import { useEffect } from "react";

const EXPLICIT_FIELD_SELECTOR = "[data-erp-form-field='true']";
const FALLBACK_FIELD_SELECTOR = [
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[data-erp-form-field='true']",
].join(",");
const SECTION_SELECTOR = "[data-erp-form-section='true']";

function isFocusableField(element) {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  if (element.hasAttribute("disabled")) {
    return false;
  }

  if (element.getAttribute("aria-hidden") === "true") {
    return false;
  }

  return element.getClientRects().length > 0;
}

function getFormFields(container) {
  if (!(container instanceof HTMLElement)) {
    return [];
  }

  const explicitFields = Array.from(
    container.querySelectorAll(EXPLICIT_FIELD_SELECTOR)
  ).filter(isFocusableField);

  if (explicitFields.length > 0) {
    return explicitFields;
  }

  return Array.from(container.querySelectorAll(FALLBACK_FIELD_SELECTOR)).filter(
    isFocusableField
  );
}

function focusField(element) {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  element.focus();

  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement
  ) {
    element.select?.();
  }

  return true;
}

function findAdjacentField(fields, currentIndex, step) {
  for (
    let nextIndex = currentIndex + step;
    nextIndex >= 0 && nextIndex < fields.length;
    nextIndex += step
  ) {
    if (isFocusableField(fields[nextIndex])) {
      return fields[nextIndex];
    }
  }

  return null;
}

function findSectionJumpTarget(container, currentTarget, step) {
  if (!(container instanceof HTMLElement)) {
    return null;
  }

  const sections = Array.from(container.querySelectorAll(SECTION_SELECTOR)).filter(
    (section) => section instanceof HTMLElement
  );

  if (sections.length === 0) {
    return null;
  }

  const currentSection = currentTarget.closest(SECTION_SELECTOR);
  const currentIndex = sections.indexOf(currentSection);
  const startIndex = currentIndex >= 0 ? currentIndex + step : step > 0 ? 0 : sections.length - 1;

  for (
    let nextIndex = startIndex;
    nextIndex >= 0 && nextIndex < sections.length;
    nextIndex += step
  ) {
    const fields = getFormFields(sections[nextIndex]);
    if (fields.length > 0) {
      return fields[0];
    }
  }

  return null;
}

function shouldIgnoreEnter(target) {
  if (!(target instanceof HTMLElement)) {
    return true;
  }

  if (target.dataset.erpEnterMode === "native") {
    return true;
  }

  if (target instanceof HTMLTextAreaElement) {
    return true;
  }

  const role = target.getAttribute("role");
  const expanded = target.getAttribute("aria-expanded");
  const hasPopup = target.getAttribute("aria-haspopup");

  if (role === "combobox" || hasPopup === "listbox" || expanded === "true") {
    return true;
  }

  if (target instanceof HTMLButtonElement && target.dataset.erpFormField !== "true") {
    return true;
  }

  return false;
}

function isSectionJumpIntent(event) {
  if (event.ctrlKey || event.metaKey || !event.altKey) {
    return false;
  }

  return (
    event.key === "PageDown" ||
    event.key === "PageUp" ||
    event.key === "ArrowDown" ||
    event.key === "ArrowUp"
  );
}

export function useErpDenseFormNavigation(
  containerRef,
  { disabled = false, submitOnFinalField = false, onSubmit } = {}
) {
  useEffect(() => {
    const container = containerRef?.current;

    if (!(container instanceof HTMLElement) || disabled) {
      return undefined;
    }

    function onKeyDown(event) {
      if (event.defaultPrevented) {
        return;
      }

      const target = event.target;

      if (!(target instanceof HTMLElement) || !container.contains(target)) {
        return;
      }

      if (
        isSectionJumpIntent(event)
      ) {
        const jumpTarget = findSectionJumpTarget(
          container,
          target,
          event.key === "PageDown" || event.key === "ArrowDown" ? 1 : -1
        );

        if (jumpTarget) {
          event.preventDefault();
          focusField(jumpTarget);
        }

        return;
      }

      if (event.key !== "Enter" || shouldIgnoreEnter(target)) {
        return;
      }

      const fields = getFormFields(container);
      const currentIndex = fields.indexOf(target);

      if (currentIndex === -1) {
        return;
      }

      event.preventDefault();

      if (event.shiftKey) {
        focusField(findAdjacentField(fields, currentIndex, -1));
        return;
      }

      const nextField = findAdjacentField(fields, currentIndex, 1);

      if (nextField) {
        focusField(nextField);
        return;
      }

      if (submitOnFinalField && typeof onSubmit === "function") {
        void Promise.resolve(onSubmit({ source: "FINAL_FIELD_ENTER" }));
      }
    }

    container.addEventListener("keydown", onKeyDown);

    return () => {
      container.removeEventListener("keydown", onKeyDown);
    };
  }, [containerRef, disabled, onSubmit, submitOnFinalField]);
}
