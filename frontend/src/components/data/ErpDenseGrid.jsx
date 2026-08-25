/*
 * File-ID: FW-P1-1.1
 * File-Path: frontend/src/components/data/ErpDenseGrid.jsx
 * Gate: FAST-WORK
 * Phase: 1
 * Domain: FRONT
 * Purpose: Dense ERP register/report grid primitive for keyboard-led row work
 * Authority: Frontend
 */

import { useCallback, useEffect, useRef, useState } from "react";
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
  rows = [],
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
          className={`h-[var(--erp-row-height)] border-b border-slate-200 bg-white text-[12px] text-slate-800 ${externalClassName ?? ""}`.trim()}
        >
          {columns.map((column, colIndex) => {
            const cellKeyboardHandler = (event) => {
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
              } else if (event.key === "Enter" && typeof onRowActivate === "function") {
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
                tabIndex={isInitialActiveCell ? 0 : -1}
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
                className={`px-2 py-1 align-middle outline-none focus:bg-sky-50 focus:ring-1 focus:ring-inset focus:ring-sky-400 ${column.wrap ? "" : "whitespace-nowrap"} ${normalizeCellAlign(column.align)} ${selected ? "bg-sky-100" : ""}`}
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
        className={`h-[var(--erp-row-height)] cursor-pointer border-b border-slate-200 bg-white text-[12px] text-slate-800 outline-none focus:bg-sky-50 focus:ring-1 focus:ring-inset focus:ring-sky-400 ${externalRowProps.className ?? ""}`.trim()}
      >
        {columns.map((column) => (
          <td
            key={column.key}
            className={`px-2 py-1 align-middle ${column.wrap ? "" : "whitespace-nowrap"} ${normalizeCellAlign(column.align)}`}
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
        <table className="erp-grid-table min-w-full text-xs">
          <thead className="bg-slate-800 text-white">
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  className={`${stickyHeader ? "sticky top-0 z-10" : ""} border-b border-slate-700 bg-slate-800 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white ${normalizeCellAlign(column.align)}`.trim()}
                  style={column.width ? { width: column.width } : undefined}
                >
                  {column.label}
                </th>
              ))}
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
