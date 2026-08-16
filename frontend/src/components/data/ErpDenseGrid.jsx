/*
 * File-ID: FW-P1-1.1
 * File-Path: frontend/src/components/data/ErpDenseGrid.jsx
 * Gate: FAST-WORK
 * Phase: 1
 * Domain: FRONT
 * Purpose: Dense ERP register/report grid primitive for keyboard-led row work
 * Authority: Frontend
 */

import { useCallback, useRef } from "react";
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
}) {
  const rowRefs = useRef([]);
  const scrollElementRef = useRef(null);
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

  function renderRow(row, index) {
    const externalRowProps = getRowProps?.(row, index) ?? {};

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
            className={`px-2 py-1 align-middle ${normalizeCellAlign(column.align)}`}
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
