/*
 * File-ID: FW-P1-1.7
 * File-Path: frontend/src/components/data/ErpInlineApprovalRow.jsx
 * Gate: FAST-WORK
 * Phase: 1
 * Domain: FRONT
 * Purpose: Dense approval inbox row with inline keyboard actions
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

function alignClass(align) {
  if (align === "right") {
    return "text-right";
  }

  if (align === "center") {
    return "text-center";
  }

  return "text-left";
}

export default function ErpInlineApprovalRow({
  row,
  index,
  isFocused,
  columns = [],
  onApprove,
  onReject,
  onActivate,
  rowProps = {},
}) {
  const statusText = String(row?.status ?? "").toUpperCase();
  const statusToneClass =
    statusText === "APPROVED"
      ? "text-emerald-700"
      : statusText === "REJECTED"
        ? "text-rose-600"
        : "text-slate-800";

  const keyboardHandler = (event) => {
    if (event.key === "A" || event.key === "a") {
      event.preventDefault();
      onApprove?.(row, index);
      return;
    }

    if (event.key === "R" || event.key === "r") {
      event.preventDefault();
      onReject?.(row, index);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      onActivate?.(row, index);
    }
  };

  const mergedRowProps = {
    ...rowProps,
    onKeyDown: mergeHandlers(rowProps.onKeyDown, keyboardHandler),
  };

  return (
    <tr
      {...mergedRowProps}
      className={`h-[var(--erp-row-height)] border-b border-slate-200 bg-white text-[12px] ${statusToneClass} ${rowProps.className ?? ""}`.trim()}
    >
      {columns.map((column, columnIndex) => (
        <td
          key={column.key}
          className={`px-2 py-1 align-middle ${alignClass(column.align)}`}
        >
          <div className="flex items-center justify-between gap-2">
            <span>
              {typeof column.render === "function"
                ? column.render(row, index)
                : (row?.[column.key] ?? "")}
            </span>
            {isFocused && columnIndex === columns.length - 1 ? (
              <span className="rounded border border-slate-300 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                A Approve | R Reject
              </span>
            ) : null}
          </div>
        </td>
      ))}
    </tr>
  );
}
