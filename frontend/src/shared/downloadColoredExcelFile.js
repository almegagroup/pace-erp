// §130.14 — coloured .xlsx export for report grids whose cells carry
// on-screen sign/status colors (e.g. Stock History's green/red movement
// columns, amber Total rows) that a plain CSV can't represent. Kept in its
// own module (not downloadTabularFile.js) so exceljs — a genuinely heavy
// dependency — only ever enters a page's bundle via a dynamic import() at
// the moment Export is actually clicked, never as part of that page's main
// chunk, and never affects pages that only need the existing CSV export.
import ExcelJS from "exceljs";

const HEADER_FILL_ARGB = "FF1E293B"; // slate-800, matches ErpDenseGrid's header
const HEADER_FONT_ARGB = "FFFFFFFF";

function pxWidthToExcelWidth(width) {
  const px = Number(String(width ?? "100px").replace("px", ""));
  if (!Number.isFinite(px) || px <= 0) return 14;
  return Math.max(8, Math.round(px / 7));
}

/**
 * @param {object} params
 * @param {string} params.fileName
 * @param {string} [params.sheetName]
 * @param {Array<{key:string,label:string,align?:string,width?:string}>} params.columns
 * @param {Array<object>} params.rows
 * @param {(row:object, column:object) => (string|number)} [params.getCellValue] — defaults to row[column.key]
 * @param {(row:object, column:object) => ({fontArgb?:string, bold?:boolean}|null)} [params.getCellColor]
 * @param {(row:object) => (string|null)} [params.getRowFillArgb] — whole-row fill, e.g. a Total row
 * @param {(row:object, column:object) => (Array<{text:string,fontArgb?:string}>|null)} [params.getCellRichText]
 *   — for a cell whose on-screen render carries more than one independently
 *   colored signal in one spot (e.g. two status dots) that a single
 *   getCellColor can't represent. Takes precedence over getCellValue/
 *   getCellColor for that cell when it returns a non-empty array.
 */
export async function downloadColoredExcelFile({
  fileName,
  sheetName = "Sheet1",
  columns,
  rows,
  getCellValue,
  getCellColor,
  getRowFillArgb,
  getCellRichText,
}) {
  const safeColumns = Array.isArray(columns) ? columns : [];
  const safeRows = Array.isArray(rows) ? rows : [];

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);

  sheet.columns = safeColumns.map((column) => ({
    header: column.label ?? column.key ?? "",
    key: column.key,
    width: pxWidthToExcelWidth(column.width),
  }));

  const headerRow = sheet.getRow(1);
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: HEADER_FONT_ARGB } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL_ARGB } };
  });

  safeRows.forEach((row) => {
    const values = {};
    safeColumns.forEach((column) => {
      values[column.key] = typeof getCellValue === "function" ? getCellValue(row, column) : (row?.[column.key] ?? "");
    });
    const excelRow = sheet.addRow(values);
    const rowFillArgb = typeof getRowFillArgb === "function" ? getRowFillArgb(row) : null;

    safeColumns.forEach((column, index) => {
      const cell = excelRow.getCell(index + 1);
      if (column.align === "right") {
        cell.alignment = { horizontal: "right" };
      }
      if (rowFillArgb) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: rowFillArgb } };
      }

      const richTextRuns = typeof getCellRichText === "function" ? getCellRichText(row, column) : null;
      if (Array.isArray(richTextRuns) && richTextRuns.length > 0) {
        cell.value = {
          richText: richTextRuns.map((run) => ({
            text: run.text ?? "",
            font: run.fontArgb ? { color: { argb: run.fontArgb } } : undefined,
          })),
        };
        return;
      }

      const colorInfo = typeof getCellColor === "function" ? getCellColor(row, column) : null;
      if (colorInfo?.fontArgb || colorInfo?.bold) {
        cell.font = {
          ...(cell.font ?? {}),
          ...(colorInfo.fontArgb ? { color: { argb: colorInfo.fontArgb } } : {}),
          ...(colorInfo.bold ? { bold: true } : {}),
        };
      }
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.URL.revokeObjectURL(url);
}
