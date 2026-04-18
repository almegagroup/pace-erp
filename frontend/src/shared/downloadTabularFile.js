function escapeCsvCell(value) {
  const normalized = value === null || value === undefined ? "" : String(value);
  if (/[",\r\n]/.test(normalized)) {
    return `"${normalized.replace(/"/g, "\"\"")}"`;
  }
  return normalized;
}

export function downloadCsvFile({ fileName, columns, rows }) {
  const safeColumns = Array.isArray(columns) ? columns : [];
  const safeRows = Array.isArray(rows) ? rows : [];
  const header = safeColumns.map((column) => escapeCsvCell(column.label ?? column.key ?? "")).join(",");
  const body = safeRows
    .map((row) =>
      safeColumns
        .map((column) => escapeCsvCell(row?.[column.key] ?? ""))
        .join(","),
    )
    .join("\r\n");

  const csv = `\uFEFF${header}\r\n${body}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.URL.revokeObjectURL(url);
}
