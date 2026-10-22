/*
 * File-Path: frontend/src/components/data/tableClipboard.js
 * Purpose: Copy displayed report-table rows as Excel-ready TSV, including
 *          the visible header row.
 */

function spreadsheetCell(value) {
  // A tab/newline inside one displayed value would shift cells/rows when the
  // user pastes into Excel. Keep the visible text together in its cell.
  return String(value ?? "").replace(/[\t\r\n]+/g, " ");
}

function columnValue(column, row) {
  if (typeof column.copyValue === "function") return column.copyValue(row);
  return row?.[column.key] ?? "";
}

export function tableRowsToTsv(columns, rows) {
  const exportColumns = columns.filter((column) => column.copyable !== false);
  return [
    exportColumns.map((column) => spreadsheetCell(typeof column.label === "string" ? column.label : column.key)).join("\t"),
    ...rows.map((row) => exportColumns.map((column) => spreadsheetCell(columnValue(column, row))).join("\t")),
  ].join("\n");
}

// Legacy fallback for non-secure contexts / older browsers where
// navigator.clipboard is unavailable.
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

export async function copyTableRowsWithHeaders(columns, rows) {
  const text = tableRowsToTsv(columns, rows);
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through to the supported legacy path.
    }
  }
  legacyCopyToClipboard(text);
}
