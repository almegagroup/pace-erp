/*
 * File-ID: FW-P1-1.4
 * File-Path: frontend/src/components/forms/ErpComboboxField.jsx
 * Gate: FAST-WORK
 * Phase: 1
 * Domain: FRONT
 * Purpose: Searchable combobox field primitive — replaces plain <select> with
 *          a type-to-filter dropdown that preserves keyboard-native ERP grammar
 * Authority: Frontend
 */

import { useEffect, useRef, useState } from "react";

/**
 * Normalise a string for loose matching: lowercase, collapse whitespace.
 */
function normalise(str) {
  return String(str ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * ErpComboboxField
 *
 * Controlled combobox that replaces a bare <select>.
 *
 * Props
 * -----
 * value          string | ""          – currently selected option value
 * onChange       (value: string) => void
 * options        { value: string, label: string }[]
 * placeholder    string               – shown when no value selected (default "-- Select --")
 * blankLabel     string               – label shown for blank option (default "-- Select --")
 * inputRef       React ref            – forwarded to the internal <input>
 * className      string               – extra classes added to the wrapper div
 * inputClassName string               – extra/override classes for the <input> element
 *                                       (replaces the default h-7 sizing when provided)
 * hideBlank      boolean              – when true, no blank "-- Select --" option is prepended;
 *                                       use when the field always has a valid selection
 * inputProps     object               – extra props spread onto the <input> element
 *                                       (e.g. data-workspace-primary-focus, aria-*, etc.)
 * disabled       boolean
 */
export default function ErpComboboxField({
  value = "",
  onChange,
  options = [],
  placeholder = "-- Select --",
  blankLabel = "-- Select --",
  inputRef,
  className = "",
  inputClassName = "",
  hideBlank = false,
  inputProps = {},
  disabled = false,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightIndex, setHighlightIndex] = useState(0);

  const wrapperRef = useRef(null);
  const listRef = useRef(null);
  const internalInputRef = useRef(null);
  const activeInputRef = inputRef ?? internalInputRef;

  // The full list — optionally includes a blank entry at position 0
  const allOptions = hideBlank
    ? options
    : [{ value: "", label: blankLabel }, ...options];

  // Filtered list (only when open and query is non-empty)
  const filtered = open
    ? query.trim() === ""
      ? allOptions
      : allOptions.filter(
          (opt) =>
            opt.value === "" || normalise(opt.label).includes(normalise(query)),
        )
    : allOptions;

  // Label currently shown in the collapsed input
  const selectedLabel =
    allOptions.find((opt) => opt.value === value)?.label ?? placeholder;

  // Keep highlightIndex in bounds when filtered list changes
  useEffect(() => {
    setHighlightIndex((prev) => Math.min(prev, Math.max(filtered.length - 1, 0)));
  }, [filtered.length]);

  // Scroll highlighted row into view
  useEffect(() => {
    if (!open || !listRef.current) return;
    const items = listRef.current.querySelectorAll("[data-combo-item]");
    items[highlightIndex]?.scrollIntoView({ block: "nearest" });
  }, [highlightIndex, open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  function openDropdown() {
    if (disabled) return;
    setQuery("");
    setHighlightIndex(
      Math.max(
        allOptions.findIndex((opt) => opt.value === value),
        0,
      ),
    );
    setOpen(true);
  }

  function selectOption(optValue) {
    onChange?.(optValue);
    setOpen(false);
    setQuery("");
  }

  function handleInputClick() {
    if (open) return;
    openDropdown();
  }

  function handleInputChange(event) {
    if (!open) {
      openDropdown();
    }
    setQuery(event.target.value);
    setHighlightIndex(0);
  }

  function handleKeyDown(event) {
    if (disabled) return;

    if (!open) {
      if (
        event.key === "ArrowDown" ||
        event.key === "ArrowUp" ||
        event.key === "Enter" ||
        event.key === " "
      ) {
        event.preventDefault();
        openDropdown();
      }
      return;
    }

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setHighlightIndex((prev) => Math.min(prev + 1, filtered.length - 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        setHighlightIndex((prev) => Math.max(prev - 1, 0));
        break;
      case "Enter":
        event.preventDefault();
        if (filtered[highlightIndex] != null) {
          selectOption(filtered[highlightIndex].value);
        }
        break;
      case "Escape":
        event.preventDefault();
        setOpen(false);
        setQuery("");
        break;
      case "Tab":
        setOpen(false);
        setQuery("");
        break;
      default:
        break;
    }
  }

  const defaultInputClass =
    "h-7 w-full border border-slate-400 bg-white px-2 py-0.5 text-sm text-slate-900 outline-none focus:border-sky-500 cursor-pointer";
  const resolvedInputClass = inputClassName
    ? `w-full border border-slate-300 bg-[#fffef7] text-slate-900 outline-none focus:border-sky-500 cursor-pointer ${inputClassName}`
    : defaultInputClass;

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      <input
        {...inputProps}
        ref={activeInputRef}
        type="text"
        role="combobox"
        aria-expanded={open}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        value={open ? query : selectedLabel}
        placeholder={open ? "Type to search…" : placeholder}
        onClick={handleInputClick}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        className={`${resolvedInputClass} ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
      />
      {open && filtered.length > 0 && (
        <ul
          ref={listRef}
          role="listbox"
          className="absolute left-0 top-full z-50 max-h-48 w-full overflow-y-auto border border-slate-400 bg-white shadow-md"
        >
          {filtered.map((opt, idx) => (
            <li
              key={opt.value === "" ? "__blank__" : opt.value}
              data-combo-item
              role="option"
              aria-selected={opt.value === value}
              onPointerDown={(event) => {
                event.preventDefault(); // keep focus on input
                selectOption(opt.value);
              }}
              className={`cursor-pointer px-2 py-1 text-sm ${
                idx === highlightIndex
                  ? "bg-sky-600 text-white"
                  : opt.value === value
                    ? "bg-sky-50 text-slate-900"
                    : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              {opt.label}
            </li>
          ))}
        </ul>
      )}
      {open && filtered.length === 0 && (
        <div className="absolute left-0 top-full z-50 w-full border border-slate-400 bg-white px-2 py-2 text-xs text-slate-400 shadow-md">
          No matches
        </div>
      )}
    </div>
  );
}
