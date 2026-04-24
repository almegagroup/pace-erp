/*
 * File-ID: UX4-FRONT
 * File-Path: frontend/src/hooks/useErpListNavigation.js
 * Gate: 9
 * Phase: 9
 * Domain: FRONT
 * Purpose: Keyboard-first row navigation, selection, and activation for all ERP list/table screens
 * Authority: Frontend
 *
 * Provides SAP/Tally-style list workability:
 *   Arrow ↑↓   — move focus between rows
 *   Home/End   — jump to first/last row
 *   PageUp/Dn  — jump 10 rows
 *   Space      — toggle row selection (multi-select)
 *   Enter      — activate row (drill-through hook point via onActivate)
 *   Escape     — clear selection, or call onEscape (back navigation)
 *
 * Usage:
 *   const { getRowProps, selectedRows, clearSelection, getRowElement } =
 *     useErpListNavigation(rows, { onActivate, onEscape });
 *
 *   <tr key={row.id} {...getRowProps(index)} className="...existing classes...">
 */

import { useCallback, useRef, useState } from "react";

function isInteractiveControl(target) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName;

  return (
    tagName === "INPUT" ||
    tagName === "SELECT" ||
    tagName === "TEXTAREA" ||
    tagName === "BUTTON" ||
    tagName === "A" ||
    target.isContentEditable
  );
}

export function useErpListNavigation(rows, { onActivate, onEscape } = {}) {
  const rowRefs = useRef([]);
  const [selectedIndices, setSelectedIndices] = useState(() => new Set());

  const rowCount = Array.isArray(rows) ? rows.length : 0;

  const focusRow = useCallback(
    (index) => {
      const clamped = Math.max(0, Math.min(index, rowCount - 1));
      rowRefs.current[clamped]?.focus();
    },
    [rowCount],
  );

  const getRowElement = useCallback(
    (index) => rowRefs.current[index] ?? null,
    [],
  );

  const toggleSelection = useCallback((index) => {
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIndices(new Set());
  }, []);

  const getRowProps = useCallback(
    (index) => {
      const isSelected = selectedIndices.has(index);

      return {
        ref(element) {
          rowRefs.current[index] = element;
        },
        tabIndex: 0,
        "aria-selected": isSelected,
        ...(isSelected ? { "data-erp-row-selected": true } : {}),
        onKeyDown(event) {
          if (event.defaultPrevented) return;

          switch (event.key) {
            case "ArrowDown": {
              event.preventDefault();
              focusRow(index + 1);
              break;
            }
            case "ArrowUp": {
              event.preventDefault();
              focusRow(index - 1);
              break;
            }
            case "Home": {
              event.preventDefault();
              focusRow(0);
              break;
            }
            case "End": {
              event.preventDefault();
              focusRow(rowCount - 1);
              break;
            }
            case "PageDown": {
              event.preventDefault();
              focusRow(Math.min(index + 10, rowCount - 1));
              break;
            }
            case "PageUp": {
              event.preventDefault();
              focusRow(Math.max(index - 10, 0));
              break;
            }
            case " ": {
              if (isInteractiveControl(event.target)) {
                break;
              }
              // Only toggle selection when the row itself is focused,
              // not when a child button/input is active
              if (event.target === event.currentTarget) {
                event.preventDefault();
                toggleSelection(index);
              }
              break;
            }
            case "Enter": {
              if (isInteractiveControl(event.target)) {
                break;
              }
              // Only fire activation when the row itself is focused
              if (event.target === event.currentTarget && typeof onActivate === "function") {
                event.preventDefault();
                onActivate(rows?.[index], index);
              }
              break;
            }
            case "Escape": {
              if (selectedIndices.size > 0) {
                event.preventDefault();
                clearSelection();
              } else if (typeof onEscape === "function") {
                event.preventDefault();
                onEscape();
              }
              break;
            }
            default:
              break;
          }
        },
      };
    },
    [
      selectedIndices,
      rowCount,
      rows,
      onActivate,
      onEscape,
      focusRow,
      toggleSelection,
      clearSelection,
    ],
  );

  return {
    /** Spread onto each <tr>: getRowProps(index) */
    getRowProps,
    /** Set of currently selected row indices */
    selectedIndices,
    /** Array of the actual row data objects that are selected */
    selectedRows: [...selectedIndices].map((i) => rows?.[i]).filter(Boolean),
    /** Clear all selections */
    clearSelection,
    /** Programmatically focus a row by index */
    focusRow,
    /** Get the DOM element for a row by index */
    getRowElement,
  };
}
