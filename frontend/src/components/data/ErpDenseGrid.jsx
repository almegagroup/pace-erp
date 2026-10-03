/*
 * File-ID: FW-P1-1.1
 * File-Path: frontend/src/components/data/ErpDenseGrid.jsx
 * Gate: FAST-WORK
 * Phase: 1
 * Domain: FRONT
 * Purpose: Dense ERP register/report grid primitive for keyboard-led row work
 * Authority: Frontend
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useVirtualizer } from "@tanstack/react-virtual";

// Matches --erp-row-height in index.css. Only used as the virtualizer's size
// estimate (rows still render at their real CSS height) — update this too if
// that variable ever changes.
const ROW_HEIGHT_PX = 30;

function mergeHandlers(primaryHandler, secondaryHandler) {
  if (!primaryHandler) return secondaryHandler;
  if (!secondaryHandler) return primaryHandler;
  return (event) => {
    primaryHandler(event);
    if (!event.defaultPrevented) secondaryHandler(event);
  };
}

function normalizeCellAlign(align) {
  if (align === "right") return "text-right";
  if (align === "center") return "text-center";
  return "text-left";
}

function isInteractiveTarget(target) {
  return target instanceof Element
    && Boolean(target.closest("input, select, textarea, button, a, [contenteditable='true'], [role='combobox']"));
}

// A row's own bg-* override (from getRowProps, e.g. a Total row's amber
// fill, or a variance/discrepancy highlight) and this component's default
// `bg-white` have identical CSS specificity (both plain single-class
// selectors) — whichever rule is declared LATER in the compiled Tailwind
// stylesheet wins the cascade, regardless of which class comes later in the
// className string. Confirmed empirically against this project's own build:
// .bg-white is emitted after .bg-amber-50/.bg-rose-50/.bg-emerald-50/
// .bg-slate-50, so bg-white was silently winning and swallowing every such
// row highlight (Total rows, variance/discrepancy rows) across every caller
// of this component, not just a cosmetic Stock History issue. Only ever
// emit bg-white when the caller hasn't already supplied its own bg-*.
function hasBackgroundUtility(className) {
  return /(^|\s)bg-\S/.test(className ?? "");
}

// Legacy fallback for non-secure contexts / older browsers where
// navigator.clipboard is unavailable — mirrors the standard
// hidden-textarea + execCommand("copy") pattern.
function legacyCopyToClipboard(text) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try {
    document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
  }
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // fall through to legacy path
    }
  }
  legacyCopyToClipboard(text);
}

// A column's own value for Excel-style filtering — same fallback chain as
// copyValue's own precedent (a column with a custom JSX `render`, e.g. a
// colored badge, should supply plain text here or via copyValue; otherwise
// filtering falls back to the raw row[column.key] value).
function getColumnFilterValue(column, row) {
  if (typeof column.filterValue === "function") return String(column.filterValue(row) ?? "");
  if (typeof column.copyValue === "function") return String(column.copyValue(row) ?? "");
  return String(row?.[column.key] ?? "");
}

// Small funnel icon, two visual states — outline (no exclusion applied for
// this column) vs filled/highlighted (this column currently excludes at
// least one of its own values). Fixed 12px, flex-shrink-0 at every call
// site, so it never eats into a narrow column's own header label (found
// live 2026-10-03, business owner: a naive inline icon can crowd out the
// header text until it's unreadable).
function FilterIcon({ active }) {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" className="shrink-0">
      <path d="M1 2.5h14L9.5 9v4.5l-3 2V9L1 2.5z" className={active ? "fill-sky-300" : "fill-slate-400"} />
    </svg>
  );
}

// One column's Excel-style AutoFilter panel — a DRAFT checkbox selection
// (only committed to the grid's real columnFilters state on "OK", mirroring
// real Excel) so toggling individual checkboxes doesn't re-filter/re-render
// the whole grid on every click. Portaled to document.body, positioned via
// getBoundingClientRect of its own trigger button, same technique as
// ErpComboboxField's own dropdown panel — otherwise any ancestor with
// overflow-hidden/overflow-auto (this grid's own scroll viewport included)
// would clip it.
function ColumnFilterPanel({ anchorMapRef, columnKey, options, selected, onApply, onClose }) {
  const [draft, setDraft] = useState(() => new Set(selected));
  const [query, setQuery] = useState("");
  const [rect, setRect] = useState(null);
  const panelRef = useRef(null);

  useLayoutEffect(() => {
    function updateRect() {
      const el = anchorMapRef.current[columnKey];
      if (!el) return;
      const r = el.getBoundingClientRect();
      const PANEL_WIDTH = 220;
      const VIEWPORT_MARGIN = 8;
      const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - PANEL_WIDTH - VIEWPORT_MARGIN);
      setRect({ top: r.bottom, left: Math.min(r.left, maxLeft), width: PANEL_WIDTH });
    }
    updateRect();
    window.addEventListener("scroll", updateRect, true);
    window.addEventListener("resize", updateRect);
    return () => {
      window.removeEventListener("scroll", updateRect, true);
      window.removeEventListener("resize", updateRect);
    };
  }, [anchorMapRef, columnKey]);

  useEffect(() => {
    function handlePointerDown(event) {
      const anchorEl = anchorMapRef.current[columnKey];
      const insideAnchor = anchorEl && anchorEl.contains(event.target);
      const insidePanel = panelRef.current && panelRef.current.contains(event.target);
      if (!insideAnchor && !insidePanel) onClose();
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [anchorMapRef, columnKey, onClose]);

  function toggleValue(value) {
    setDraft((current) => {
      const next = new Set(current);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  if (!rect) return null;

  const filteredOptions = query.trim()
    ? options.filter((opt) => opt.toLowerCase().includes(query.trim().toLowerCase()))
    : options;

  return createPortal(
    <div
      ref={panelRef}
      style={{ position: "fixed", top: rect.top, left: rect.left, width: rect.width, zIndex: 1000300 }}
      className="flex max-h-72 flex-col border border-slate-400 bg-white text-xs text-slate-800 shadow-lg"
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); onClose(); }
      }}
    >
      <div className="border-b border-slate-200 p-1.5">
        <input
          autoFocus
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search…"
          className="h-6 w-full border border-slate-300 px-1.5 text-xs outline-none focus:border-sky-500"
        />
      </div>
      <div className="flex gap-2 border-b border-slate-200 px-1.5 py-1">
        <button type="button" className="text-[11px] text-sky-700 hover:underline" onClick={() => setDraft(new Set(options))}>
          Select All
        </button>
        <button type="button" className="text-[11px] text-sky-700 hover:underline" onClick={() => setDraft(new Set())}>
          Clear
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-1">
        {filteredOptions.length === 0 ? (
          <p className="px-1.5 py-2 text-slate-400">No values</p>
        ) : (
          filteredOptions.map((value) => (
            <label key={value || "__blank__"} className="flex items-center gap-1.5 px-1.5 py-0.5 hover:bg-slate-50">
              <input type="checkbox" checked={draft.has(value)} onChange={() => toggleValue(value)} className="h-3 w-3" />
              <span className="min-w-0 truncate" title={value}>{value || "(blank)"}</span>
            </label>
          ))
        )}
      </div>
      <div className="flex justify-end gap-1.5 border-t border-slate-200 p-1.5">
        <button type="button" className="h-6 border border-slate-300 bg-white px-2 text-[11px] hover:bg-slate-50" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="h-6 border border-sky-600 bg-sky-600 px-2 text-[11px] font-semibold text-white hover:bg-sky-700"
          onClick={() => onApply(draft)}
        >
          OK
        </button>
      </div>
    </div>,
    document.body,
  );
}

function normalizeSelection(selection) {
  if (!selection) return null;
  return {
    rowMin: Math.min(selection.anchorRow, selection.activeRow),
    rowMax: Math.max(selection.anchorRow, selection.activeRow),
    colMin: Math.min(selection.anchorCol, selection.activeCol),
    colMax: Math.max(selection.anchorCol, selection.activeCol),
  };
}

export default function ErpDenseGrid({
  columns = [],
  rows: rawRows = [],
  rowKey,
  onRowActivate,
  getRowProps,
  summaryRow,
  stickyHeader = true,
  maxHeight = "calc(100vh - 200px)",
  emptyMessage = "No rows available.",
  rowTabIndex = 0,
  // Opt-in only — default false, so every existing caller of this component
  // keeps its exact current (non-virtualized) rendering. Pass true for
  // reports that can load a large, unpaginated row set (e.g. IN02) so the
  // browser only ever mounts the rows currently in/near the viewport.
  virtualize = false,
  // Opt-in only, same shape as `virtualize` — default false keeps every
  // existing caller's exact current row-to-row-only ArrowUp/ArrowDown
  // behavior. Pass true for dense entry grids (CSN Tracker, AC01/AC03) that
  // need Excel-style cell-to-cell arrow navigation (all four arrow keys move
  // one cell, not one row) instead of row-level-only nav. When true, the
  // focusable unit becomes each <td> rather than each <tr> — `getRowProps`'s
  // onKeyDown/onClick/className still apply to the <tr> itself (unaffected),
  // but ArrowUp/ArrowDown/ArrowLeft/ArrowRight/Enter are handled per-cell.
  cellNavigate = false,
  // Opt-in only (§130.10) — default false, every existing caller unaffected.
  // Pass true for report grids that need Excel-style range selection:
  // Shift+Click / click-drag / Shift+Arrow extends a rectangular selection
  // from the last plain click/arrow move, and Ctrl+C (Cmd+C on Mac) copies
  // the selected range as tab/newline-separated text. Implies cellNavigate's
  // per-cell focus rendering (a caller doesn't need to also pass
  // cellNavigate). Each column may define `copyValue(row)` to control what
  // gets copied for that column — falls back to the same raw
  // `row?.[column.key]` value used when `render` is absent, so a column with
  // a custom `render` (e.g. colored/formatted JSX) should also define
  // `copyValue` to copy sensible plain text instead of "[object Object]".
  rangeSelect = false,
  // Opt-in only — default false, every existing caller unaffected. Pass true
  // when the table is wide enough (many columns, or a narrow container like
  // a half-width modal panel) that reaching a trailing action column
  // requires horizontal scroll — without this, the row's own identity
  // (usually the first column, e.g. a name) scrolls out of view exactly
  // when the user needs it most, right as they're about to click that row's
  // action. Found live 2026-08-25 (business owner): AC06's SLOC Group
  // "Manage Materials" Included/Excluded lists — the Exclude/Include button
  // sits past a horizontal scroll, and the material name (the only way to
  // tell which row you're about to act on) scrolls away with it.
  stickyFirstColumn = false,
  // Opt-in for wide entry grids. Declared widths remain authoritative so
  // input values stay visible; the viewport scrolls instead of squeezing.
  fitColumnWidths = false,
  // Opt-in only (business owner, 2026-10-03) — default false, every existing
  // caller unaffected. Pass true for an Excel-style per-column AutoFilter: a
  // small funnel button in each header opens a checkbox dropdown of that
  // column's own distinct values (dependent/cascading on every OTHER
  // column's currently-active filter, same as real Excel). Hidden/off until
  // the user clicks a column's own funnel — no filter row is ever shown by
  // default. A column opts OUT with `filterable: false` (e.g. an Actions
  // column with buttons, nothing meaningful to filter). A column with a
  // custom `render` should supply `filterValue(row)` (falls back to
  // `copyValue`, then the raw `row[column.key]`, same precedent as
  // copyValue's own fallback chain).
  columnFilter = false,
}) {
  const effectiveCellNavigate = cellNavigate || rangeSelect;
  const rowRefs = useRef([]);
  // cellRefs.current[rowIndex][colIndex] — only populated when effectiveCellNavigate.
  const cellRefs = useRef([]);
  // Tracks which single cell currently carries tabIndex=0 so Tab from
  // outside the grid lands on the right spot next time, without triggering
  // a re-render on every arrow press (mirrors focusRow's ref-only approach
  // below, just one level deeper).
  const activeCellRef = useRef({ row: 0, col: 0 });
  const scrollElementRef = useRef(null);
  // Selection state is only ever populated when rangeSelect is on — kept as
  // real state (not a ref) since the selected range needs to re-render as a
  // highlight, unlike the single active cell above which only needs tabIndex.
  const [selection, setSelection] = useState(null);
  const isDraggingRef = useRef(false);

  // columnFilter state. { [columnKey]: Set<string> } — a column only ever
  // appears as a key once the user has excluded at least one of its own
  // values (see applyColumnFilter below); absent key = that column imposes
  // no restriction of its own, even if OTHER columns' filters still narrow
  // what's shown.
  const [columnFilters, setColumnFilters] = useState({});
  const [openFilterColumnKey, setOpenFilterColumnKey] = useState(null);
  const filterAnchorMapRef = useRef({});

  // Every distinct value a column holds across ALL rows, ignoring every
  // active filter — the fixed "total universe" used only to detect whether
  // a freshly-applied selection actually excludes anything (see
  // applyColumnFilter), never used to populate the dropdown's own checkbox
  // list (that's getAvailableValuesForColumn below, which IS dependent).
  const getAllValuesForColumn = useCallback(
    (column) => [...new Set(rawRows.map((row) => getColumnFilterValue(column, row)))].sort((a, b) => a.localeCompare(b)),
    [rawRows],
  );

  // Dependent/cascading: a column's own dropdown only ever lists values
  // still reachable once every OTHER column's current filter is applied —
  // same behavior as real Excel AutoFilter (filtering column A narrows what
  // column B's own dropdown can even offer).
  const getAvailableValuesForColumn = useCallback(
    (column) => {
      const otherEntries = Object.entries(columnFilters).filter(([key]) => key !== column.key);
      const candidateRows = otherEntries.length === 0
        ? rawRows
        : rawRows.filter((row) => otherEntries.every(([key, set]) => {
          const otherColumn = columns.find((c) => c.key === key);
          return !otherColumn || set.has(getColumnFilterValue(otherColumn, row));
        }));
      return [...new Set(candidateRows.map((row) => getColumnFilterValue(column, row)))].sort((a, b) => a.localeCompare(b));
    },
    [columnFilters, columns, rawRows],
  );

  const filteredRows = useMemo(() => {
    if (!columnFilter) return rawRows;
    const activeEntries = Object.entries(columnFilters);
    if (activeEntries.length === 0) return rawRows;
    return rawRows.filter((row) => activeEntries.every(([key, set]) => {
      const column = columns.find((c) => c.key === key);
      return !column || set.has(getColumnFilterValue(column, row));
    }));
  }, [columnFilter, rawRows, columns, columnFilters]);

  // Every reference below this point reads `rows` — shadowing it with the
  // filtered result means virtualizer/focus/selection/copy/render logic
  // needs zero further changes to respect an active column filter.
  const rows = filteredRows;

  function applyColumnFilter(column, draftSet) {
    const allValues = getAllValuesForColumn(column);
    setColumnFilters((current) => {
      const next = { ...current };
      // Selecting every value this column actually has (its full universe,
      // not just the currently-narrowed dropdown list) means this column
      // itself excludes nothing — drop its key entirely so its funnel icon
      // correctly reverts to the inactive state.
      if (draftSet.size >= allValues.length) delete next[column.key];
      else next[column.key] = draftSet;
      return next;
    });
    setOpenFilterColumnKey(null);
  }

  const hasRows = Array.isArray(rows) && rows.length > 0;
  const viewportClassName =
    maxHeight === "none"
      ? "overflow-x-auto overflow-y-visible border border-slate-300 bg-white"
      : "overflow-x-auto border border-slate-300 bg-white";
  const viewportStyle = maxHeight === "none" ? undefined : { height: maxHeight, overflowY: "auto" };

  const virtualizer = useVirtualizer({
    count: virtualize ? rows.length : 0,
    getScrollElement: () => scrollElementRef.current,
    estimateSize: () => ROW_HEIGHT_PX,
    overscan: 12,
  });

  // Ends a click-drag range selection even if the mouseup happens outside
  // the grid (or outside the browser window and back in).
  useEffect(() => {
    if (!rangeSelect) return undefined;
    function handleWindowMouseUp() {
      isDraggingRef.current = false;
    }
    window.addEventListener("mouseup", handleWindowMouseUp);
    return () => window.removeEventListener("mouseup", handleWindowMouseUp);
  }, [rangeSelect]);

  const focusRow = useCallback(
    (index) => {
      if (virtualize) {
        virtualizer.scrollToIndex(index, { align: "auto" });
        // Off-screen rows aren't mounted yet — scrollToIndex schedules the
        // mount, so focus has to happen on the next frame, not synchronously.
        requestAnimationFrame(() => {
          rowRefs.current[index]?.focus();
        });
        return;
      }
      rowRefs.current[index]?.focus();
    },
    [virtualize, virtualizer],
  );

  const focusCell = useCallback(
    (rowIndex, colIndex) => {
      const clampedRow = Math.max(0, Math.min(rows.length - 1, rowIndex));
      const clampedCol = Math.max(0, Math.min(columns.length - 1, colIndex));
      const previous = activeCellRef.current;
      const previousCell = cellRefs.current[previous.row]?.[previous.col];
      if (previousCell) previousCell.tabIndex = -1;
      activeCellRef.current = { row: clampedRow, col: clampedCol };

      const doFocus = () => {
        const target = cellRefs.current[clampedRow]?.[clampedCol];
        if (!target) return;
        const actionControl = columns[clampedCol]?.focusActionControl
          ? target.querySelector("[data-erp-grid-action-control]")
          : null;
        if (actionControl instanceof HTMLElement) {
          target.tabIndex = -1;
          actionControl.focus();
          return;
        }
        target.tabIndex = 0;
        target.focus();
      };
      if (virtualize) {
        virtualizer.scrollToIndex(clampedRow, { align: "auto" });
        // Off-screen rows aren't mounted yet — scrollToIndex schedules the
        // mount, so focus has to happen on the next frame, not synchronously.
        requestAnimationFrame(doFocus);
        return;
      }
      doFocus();
    },
    [virtualize, virtualizer, rows.length, columns.length],
  );

  const copySelectionToClipboard = useCallback(
    (rowIndex, colIndex) => {
      const normalized = normalizeSelection(selection) ?? { rowMin: rowIndex, rowMax: rowIndex, colMin: colIndex, colMax: colIndex };
      const lines = [];
      for (let r = normalized.rowMin; r <= normalized.rowMax; r += 1) {
        const row = rows[r];
        const cells = [];
        for (let c = normalized.colMin; c <= normalized.colMax; c += 1) {
          const column = columns[c];
          if (!column) continue;
          const value = typeof column.copyValue === "function"
            ? column.copyValue(row)
            : (row?.[column.key] ?? "");
          cells.push(String(value ?? ""));
        }
        lines.push(cells.join("\t"));
      }
      void copyTextToClipboard(lines.join("\n"));
    },
    [selection, rows, columns],
  );

  function isCellSelected(rowIndex, colIndex) {
    const normalized = normalizeSelection(selection);
    if (!normalized) return false;
    return rowIndex >= normalized.rowMin && rowIndex <= normalized.rowMax
      && colIndex >= normalized.colMin && colIndex <= normalized.colMax;
  }

  function renderRow(row, index) {
    const externalRowProps = getRowProps?.(row, index) ?? {};

    if (effectiveCellNavigate) {
      if (!cellRefs.current[index]) cellRefs.current[index] = [];
      const { className: externalClassName, onKeyDown: externalOnKeyDown, ...restRowProps } = externalRowProps;

      return (
        <tr
          key={rowKey ? rowKey(row, index) : `${index}`}
          ref={(el) => { rowRefs.current[index] = el; }}
          {...restRowProps}
          className={`h-[var(--erp-row-height)] border-b border-slate-200 ${hasBackgroundUtility(externalClassName) ? "" : "bg-white"} text-[12px] text-slate-800 ${externalClassName ?? ""}`.trim()}
        >
          {columns.map((column, colIndex) => {
            const cellKeyboardHandler = (event) => {
              // Inputs and comboboxes own their keyboard interaction. Letting the
              // cell's Excel navigation intercept their keys steals focus/search.
              const actionControlFocused = Boolean(
                column.focusActionControl
                && event.target instanceof Element
                && event.target.closest("[data-erp-grid-action-control]"),
              );
              if (event.target !== event.currentTarget && !actionControlFocused) return;
              const isCopyShortcut = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c";
              if (rangeSelect && isCopyShortcut) {
                event.preventDefault();
                copySelectionToClipboard(index, colIndex);
                return;
              }
              if (rangeSelect && event.shiftKey && ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(event.key)) {
                event.preventDefault();
                setSelection((current) => {
                  const anchor = current ?? { anchorRow: index, anchorCol: colIndex, activeRow: index, activeCol: colIndex };
                  let nextActiveRow = anchor.activeRow;
                  let nextActiveCol = anchor.activeCol;
                  if (event.key === "ArrowRight") nextActiveCol = Math.min(columns.length - 1, anchor.activeCol + 1);
                  if (event.key === "ArrowLeft") nextActiveCol = Math.max(0, anchor.activeCol - 1);
                  if (event.key === "ArrowDown") nextActiveRow = Math.min(rows.length - 1, anchor.activeRow + 1);
                  if (event.key === "ArrowUp") nextActiveRow = Math.max(0, anchor.activeRow - 1);
                  if (virtualize) virtualizer.scrollToIndex(nextActiveRow, { align: "auto" });
                  return { ...anchor, activeRow: nextActiveRow, activeCol: nextActiveCol };
                });
                return;
              }
              if (event.key === "ArrowRight") {
                event.preventDefault();
                if (rangeSelect) setSelection(null);
                focusCell(index, colIndex + 1);
              } else if (event.key === "ArrowLeft") {
                event.preventDefault();
                if (rangeSelect) setSelection(null);
                focusCell(index, colIndex - 1);
              } else if (event.key === "ArrowDown") {
                event.preventDefault();
                if (rangeSelect) setSelection(null);
                focusCell(index + 1, colIndex);
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                if (rangeSelect) setSelection(null);
                focusCell(index - 1, colIndex);
              } else if (event.key === "Enter" && !actionControlFocused && typeof onRowActivate === "function") {
                event.preventDefault();
                onRowActivate(row, index);
              }
            };
            const isInitialActiveCell = index === activeCellRef.current.row && colIndex === activeCellRef.current.col;
            const selected = rangeSelect && isCellSelected(index, colIndex);

            return (
              <td
                key={column.key}
                ref={(el) => { cellRefs.current[index][colIndex] = el; }}
                tabIndex={column.focusActionControl ? -1 : (isInitialActiveCell ? 0 : -1)}
                onKeyDown={mergeHandlers(externalOnKeyDown, cellKeyboardHandler)}
                onMouseDown={rangeSelect ? (event) => {
                  isDraggingRef.current = true;
                  setSelection((current) => {
                    if (event.shiftKey && current) {
                      return { ...current, activeRow: index, activeCol: colIndex };
                    }
                    return { anchorRow: index, anchorCol: colIndex, activeRow: index, activeCol: colIndex };
                  });
                  focusCell(index, colIndex);
                  externalRowProps.onClick?.(event);
                } : undefined}
                onMouseEnter={rangeSelect ? () => {
                  if (!isDraggingRef.current) return;
                  setSelection((current) => (current ? { ...current, activeRow: index, activeCol: colIndex } : current));
                } : undefined}
                onClick={!rangeSelect ? (event) => {
                  if (isInteractiveTarget(event.target)) return;
                  focusCell(index, colIndex);
                  externalRowProps.onClick?.(event);
                } : undefined}
                // Found live 2026-08-19 (business owner): cells had no
                // white-space rule, so any column narrower than its content
                // silently wrapped -- rows becoming taller than the fixed
                // ROW_HEIGHT_PX the virtualizer assumes for every row, which
                // desyncs virtualized scroll position (overlaps/gaps), not
                // just a readability problem. nowrap is now the default (the
                // container already scrolls horizontally); a column that
                // genuinely needs multi-line text (long remarks/notes) can
                // opt back in with `wrap: true`.
                style={column.width ? { width: column.width, minWidth: column.width } : undefined}
                className={`px-2 py-1 align-middle outline-none focus:bg-sky-50 focus:ring-1 focus:ring-inset focus:ring-sky-400 ${column.wrap ? "" : "whitespace-nowrap"} ${normalizeCellAlign(column.align)} ${selected ? "bg-sky-100" : stickyFirstColumn && colIndex === 0 ? "sticky left-0 z-[1] bg-white border-r border-slate-200" : ""} ${column.className ?? ""}`}
              >
                {typeof column.render === "function"
                  ? column.render(row, index)
                  : (row?.[column.key] ?? "")}
              </td>
            );
          })}
        </tr>
      );
    }

    const keyboardHandler = (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        focusRow(Math.min(index + 1, rows.length - 1));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        focusRow(Math.max(index - 1, 0));
      } else if (event.key === "Enter" && typeof onRowActivate === "function") {
        event.preventDefault();
        onRowActivate(row, index);
      }
    };

    const mergedRowProps = {
      ...externalRowProps,
      onKeyDown: mergeHandlers(externalRowProps.onKeyDown, keyboardHandler),
    };

    return (
      <tr
        key={rowKey ? rowKey(row, index) : `${index}`}
        ref={(el) => { rowRefs.current[index] = el; }}
        tabIndex={rowTabIndex}
        {...mergedRowProps}
        className={`h-[var(--erp-row-height)] cursor-pointer border-b border-slate-200 ${hasBackgroundUtility(externalRowProps.className) ? "" : "bg-white"} text-[12px] text-slate-800 outline-none focus:bg-sky-50 focus:ring-1 focus:ring-inset focus:ring-sky-400 ${externalRowProps.className ?? ""}`.trim()}
      >
        {columns.map((column, colIndex) => (
          <td
            key={column.key}
            style={column.width ? { width: column.width, minWidth: column.width } : undefined}
            className={`px-2 py-1 align-middle ${column.wrap ? "" : "whitespace-nowrap"} ${normalizeCellAlign(column.align)} ${stickyFirstColumn && colIndex === 0 ? "sticky left-0 z-[1] bg-white border-r border-slate-200" : ""} ${column.className ?? ""}`}
          >
            {typeof column.render === "function"
              ? column.render(row, index)
              : (row?.[column.key] ?? "")}
          </td>
        ))}
      </tr>
    );
  }

  const virtualItems = virtualize ? virtualizer.getVirtualItems() : [];
  const paddingTop = virtualize && virtualItems.length > 0 ? virtualItems[0].start : 0;
  const paddingBottom =
    virtualize && virtualItems.length > 0
      ? virtualizer.getTotalSize() - virtualItems[virtualItems.length - 1].end
      : 0;

  return (
    <div className="grid gap-0">
      <div className={viewportClassName} style={viewportStyle} ref={scrollElementRef}>
        {/* min-w-full forces the table to at least fill its container -- correct
            for the default stretch layout, but it fights fitColumnWidths's own
            point (declared widths stay authoritative, no stretching, the
            viewport scrolls instead) when a grid has few/narrow columns: with
            table-fixed, a table forced wider than the sum of its own declared
            column widths redistributes the extra space across columns
            proportionally, which looks exactly like the widths being ignored.
            Found live 2026-09-26 (business owner) on Plan Feed's Report tab,
            5 narrow columns in a wide container. */}
        <table className={`erp-grid-table text-xs ${fitColumnWidths ? "w-max table-fixed" : "min-w-full"}`.trim()}>
          {fitColumnWidths ? (
            <colgroup>
              {columns.map((column) => <col key={column.key} style={column.width ? { width: column.width, minWidth: column.width } : undefined} />)}
            </colgroup>
          ) : null}
          <thead className="bg-slate-800 text-white">
            <tr>
              {columns.map((column, colIndex) => {
                const isStickyFirst = stickyFirstColumn && colIndex === 0;
                const canFilterColumn = columnFilter && column.filterable !== false;
                const isFilterActive = Boolean(columnFilters[column.key]);
                return (
                  <th
                    key={column.key}
                    className={`${stickyHeader ? "sticky top-0" : ""} ${isStickyFirst ? "sticky left-0 z-20" : stickyHeader ? "z-10" : ""} border-b border-slate-700 bg-slate-800 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white ${isStickyFirst ? "border-r border-slate-600" : ""} ${normalizeCellAlign(column.align)}`.trim()}
                    style={column.width ? { width: column.width, minWidth: column.width } : undefined}
                  >
                    {canFilterColumn ? (
                      <div className="flex w-full items-center justify-between gap-1">
                        <span className="min-w-0 flex-1 truncate" title={column.label}>{column.label}</span>
                        <button
                          type="button"
                          ref={(el) => { filterAnchorMapRef.current[column.key] = el; }}
                          onClick={() => setOpenFilterColumnKey((current) => (current === column.key ? null : column.key))}
                          title={`Filter ${column.label}`}
                          className={`flex-shrink-0 rounded p-0.5 normal-case tracking-normal hover:bg-slate-700 ${isFilterActive ? "bg-slate-700" : ""}`}
                        >
                          <FilterIcon active={isFilterActive} />
                        </button>
                        {openFilterColumnKey === column.key ? (
                          <ColumnFilterPanel
                            anchorMapRef={filterAnchorMapRef}
                            columnKey={column.key}
                            options={getAvailableValuesForColumn(column)}
                            selected={columnFilters[column.key] ?? new Set(getAvailableValuesForColumn(column))}
                            onApply={(draftSet) => applyColumnFilter(column, draftSet)}
                            onClose={() => setOpenFilterColumnKey(null)}
                          />
                        ) : null}
                      </div>
                    ) : (
                      column.label
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {!hasRows ? (
              <tr>
                <td
                  colSpan={Math.max(columns.length, 1)}
                  className="px-3 py-6 text-left text-sm text-slate-500"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : virtualize ? (
              <>
                {paddingTop > 0 ? (
                  <tr aria-hidden="true">
                    <td colSpan={Math.max(columns.length, 1)} style={{ height: paddingTop, padding: 0, border: "none" }} />
                  </tr>
                ) : null}
                {virtualItems.map((virtualRow) => renderRow(rows[virtualRow.index], virtualRow.index))}
                {paddingBottom > 0 ? (
                  <tr aria-hidden="true">
                    <td colSpan={Math.max(columns.length, 1)} style={{ height: paddingBottom, padding: 0, border: "none" }} />
                  </tr>
                ) : null}
              </>
            ) : (
              rows.map((row, index) => renderRow(row, index))
            )}
          </tbody>
          {summaryRow ? (
            <tfoot className="bg-slate-100">
              <tr className="h-[var(--erp-row-height)] border-t border-slate-300 text-[12px] font-semibold text-slate-800">
                {columns.map((column, index) => (
                  <td
                    key={column.key}
                    className={`px-2 py-1 ${normalizeCellAlign(column.align)}`}
                  >
                    {index === 0
                      ? summaryRow.label
                      : (summaryRow.values?.[column.key] ?? "")}
                  </td>
                ))}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </div>
  );
}
