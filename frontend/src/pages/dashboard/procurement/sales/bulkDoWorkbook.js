/*
 * File-Path: frontend/src/pages/dashboard/procurement/sales/bulkDoWorkbook.js
 * Purpose: The Bulk DO Upload template and its parser, shared by SO03's
 *          Bulk DO Upload drawer and SO02's Bulk Posting "Check with Upload
 *          Excel", so both read an uploaded sheet the same way.
 */

export const TEMPLATE_HEADERS = [
  "FO/SO Number", "DO Date", "Transporter", "LR Number", "LR Date", "SKU",
  "Pack Qty", "Storage Location", "Tally Invoice Number", "Tally Invoice Date",
  "Inbound Number", "Truck Number", "Dispatch Date",
];

function toIsoDate(value) {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  // ExcelJS may expose a date-formatted cell as its numeric serial instead
  // of a Date. Convert the workbook serial before falling through to text.
  if (typeof value === "number" && Number.isFinite(value) && value > 0 && value < 100000) {
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86_400_000).toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    const serial = Number(text);
    if (serial > 0 && serial < 100000) return new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000).toISOString().slice(0, 10);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  // Asian Paints' source files commonly carry a display-formatted Excel date
  // (DD/MM/YYYY). The API correctly requires ISO, so normalize it at the
  // upload boundary rather than flagging an otherwise valid LR/DO date.
  // A few source exports collapse the second separator, e.g. `03/102026`
  // instead of `03/10/2026`. Keep this deliberately narrow: it is only a
  // day + separator + month + four-digit-year date, never an identifier.
  const match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
    || text.match(/^(\d{1,2})[/-](\d{1,2})(\d{4})$/);
  if (!match) return text;
  const [, day, month, year] = match;
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (parsed.getUTCFullYear() !== Number(year) || parsed.getUTCMonth() !== Number(month) - 1 || parsed.getUTCDate() !== Number(day)) return text;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

export async function parseUploadedWorkbook(file) {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  const buffer = await file.arrayBuffer();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  const rows = [];
  let rowIndexSeq = 0;
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const cell = (index) => {
      const value = row.getCell(index).value;
      if (value == null) return "";
      if (typeof value === "object" && "text" in value) return String(value.text ?? "").trim();
      if (typeof value === "object" && "result" in value) return String(value.result ?? "").trim();
      return value;
    };
    const foOrSoNumber = String(cell(1) ?? "").trim();
    if (!foOrSoNumber) return;
    rowIndexSeq += 1;
    rows.push({
      row_index: rowIndexSeq,
      // The physical Excel row number, so the review grid can point the user
      // straight to the line to fix in their own sheet.
      excel_row: rowNumber,
      fo_or_so_number: foOrSoNumber,
      do_date: toIsoDate(cell(2)),
      transporter_name: String(cell(3) ?? "").trim(),
      lr_number: String(cell(4) ?? "").trim(),
      lr_date: toIsoDate(cell(5)),
      sku: String(cell(6) ?? "").trim(),
      pack_qty: Number(cell(7)) || 0,
      storage_location_code: String(cell(8) ?? "").trim(),
      tally_invoice_number: String(cell(9) ?? "").trim(),
      tally_invoice_date: toIsoDate(cell(10)),
      inbound_number: String(cell(11) ?? "").trim(),
      truck_number: String(cell(12) ?? "").trim(),
      dispatch_date: toIsoDate(cell(13)),
    });
  });
  return rows;
}
