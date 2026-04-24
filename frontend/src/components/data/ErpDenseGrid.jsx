/*
 * File-ID: FW-P1-1.1
 * File-Path: frontend/src/components/data/ErpDenseGrid.jsx
 * Gate: FAST-WORK
 * Phase: 1
 * Domain: FRONT
 * Purpose: Dense ERP register/report grid primitive for keyboard-led row work
 * Authority: Frontend
 */

function mergeHandlers(primaryHandler, secondaryHandler) {
  if (!primaryHandler) {
    return secondaryHandler;
  }

  if (!secondaryHandler) {
    return primaryHandler;
  }

  return (event) => {
    primaryHandler(event);
    if (!event.defaultPrevented) {
      secondaryHandler(event);
    }
  };
}

function normalizeCellAlign(align) {
  if (align === "right") {
    return "text-right";
  }

  if (align === "center") {
    return "text-center";
  }

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
}) {
  const hasRows = Array.isArray(rows) && rows.length > 0;
  const viewportClassName =
    maxHeight === "none"
      ? "overflow-x-auto overflow-y-visible border border-slate-300 bg-white"
      : "overflow-auto border border-slate-300 bg-white";
  const viewportStyle = maxHeight === "none" ? undefined : { maxHeight };

  return (
    <div className="grid gap-0">
      <div className={viewportClassName} style={viewportStyle}>
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
            {hasRows ? (
              rows.map((row, index) => {
                const externalRowProps = getRowProps?.(row, index) ?? {};
                const activationHandler =
                  typeof onRowActivate === "function"
                    ? (event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          onRowActivate(row, index);
                        }
                      }
                    : null;

                const mergedRowProps = {
                  ...externalRowProps,
                  onKeyDown: mergeHandlers(
                    externalRowProps.onKeyDown,
                    activationHandler
                  ),
                };

                return (
                  <tr
                    key={rowKey ? rowKey(row, index) : `${index}`}
                    {...mergedRowProps}
                    className={`h-[var(--erp-row-height)] border-b border-slate-200 bg-white text-[12px] text-slate-800 ${externalRowProps.className ?? ""}`.trim()}
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
              })
            ) : (
              <tr>
                <td
                  colSpan={Math.max(columns.length, 1)}
                  className="px-3 py-6 text-left text-sm text-slate-500"
                >
                  {emptyMessage}
                </td>
              </tr>
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
