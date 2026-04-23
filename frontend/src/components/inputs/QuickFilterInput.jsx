/*
 * File-ID: 9.15-FRONT
 * File-Path: frontend/src/components/inputs/QuickFilterInput.jsx
 * Gate: 9
 * Phase: 9
 * Domain: FRONT
 * Purpose: Provide the dense keyboard-native quick filter input used across ERP list and report surfaces
 * Authority: Frontend
 */

import { useCallback, useLayoutEffect, useRef } from "react";

function assignMutableRef(ref, value) {
  if (!ref || typeof ref !== "object") {
    return;
  }

  ref.current = value;
}

export default function QuickFilterInput({
  label = "Quick Filter",
  value,
  onChange,
  placeholder,
  hint,
  inputRef,
  primaryFocus = false,
  className = "",
  inputProps = {},
}) {
  const internalInputRef = useRef(null);
  const preserveCursorRef = useRef(null);

  const assignInputRef = useCallback(
    (element) => {
      internalInputRef.current = element;

      if (typeof inputRef === "function") {
        inputRef(element);
        return;
      }

      assignMutableRef(inputRef, element);
    },
    [inputRef]
  );

  useLayoutEffect(() => {
    const input = internalInputRef.current;
    const cursorState = preserveCursorRef.current;

    if (!(input instanceof HTMLInputElement) || !cursorState) {
      return;
    }

    preserveCursorRef.current = null;

    if (document.activeElement === input) {
      return;
    }

    input.focus({ preventScroll: true });

    if (
      typeof cursorState.start === "number" &&
      typeof cursorState.end === "number"
    ) {
      input.setSelectionRange(cursorState.start, cursorState.end);
    }
  }, [value]);

  const handleChange = useCallback(
    (event) => {
      const nextValue = event.target.value;
      preserveCursorRef.current =
        document.activeElement === event.target
          ? {
              start: event.target.selectionStart,
              end: event.target.selectionEnd,
            }
          : null;

      onChange(nextValue);
    },
    [onChange]
  );

  return (
    <label className={`block border border-slate-300 bg-slate-50 ${className}`.trim()}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-3 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {label}
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
          Filter
        </span>
      </div>
      <input
        ref={assignInputRef}
        data-workspace-primary-focus={primaryFocus ? "true" : undefined}
        value={value}
        onChange={handleChange}
        placeholder={placeholder}
        className="w-full border-0 bg-white px-3 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:bg-[#f8fbff]"
        {...inputProps}
      />
      {hint ? (
        <p className="border-t border-slate-200 bg-slate-50 px-3 py-2 text-[10px] uppercase tracking-[0.14em] text-slate-500">
          {hint}
        </p>
      ) : null}
    </label>
  );
}
