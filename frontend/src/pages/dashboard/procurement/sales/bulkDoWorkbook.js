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

// SO02 Bulk Posting review sheet: the exported queue with DO Number first,
// then the upload template's own columns (correctable), then read-only
// reference columns. The same sheet, corrected, is uploaded back.
export const REVIEW_SHEET_NAME = "Bulk Posting Review";
export const REVIEW_HEADERS = [
  "DO Number", ...TEMPLATE_HEADERS,
  "SO Number", "External SO Number", "Party", "Party GST", "Site", "Site Address", "Site State",
  "Document Name", "Pack UOM", "Base Qty", "Rate", "Value", "SO02 Action", "Checks",
];

function normalizeHeader(value) {
  return String(value ?? "").replace(/\u00a0/g, " ").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

// Reads a corrected review sheet by column NAME (never by position), so a
// user who reorders or hides columns in Excel cannot shift the values.
export async function parseReviewWorkbook(file) {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const sheet = workbook.getWorksheet(REVIEW_SHEET_NAME) ?? workbook.worksheets[0];
  const fields = {
    dc_number: "donumber", fo_or_so_number: "fosonumber", do_date: "dodate", transporter_name: "transporter",
    lr_number: "lrnumber", lr_date: "lrdate", sku: "sku", pack_qty: "packqty", storage_location_code: "storagelocation",
    tally_invoice_number: "tallyinvoicenumber", tally_invoice_date: "tallyinvoicedate", inbound_number: "inboundnumber",
    truck_number: "trucknumber", dispatch_date: "dispatchdate",
  };
  const columnByField = {};
  sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, columnNumber) => {
    const header = normalizeHeader(cell.text || cell.value);
    for (const [field, accepted] of Object.entries(fields)) if (header === accepted) columnByField[field] = columnNumber;
  });
  if (!columnByField.dc_number || !columnByField.sku) {
    throw new Error("This is not a Bulk Posting review sheet: the \"DO Number\" and \"SKU\" columns are required. Export the sheet from this page, correct it, and upload it back.");
  }
  const rows = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const value = (field) => {
      if (!columnByField[field]) return "";
      const raw = row.getCell(columnByField[field]).value;
      if (raw == null) return "";
      if (raw instanceof Date) return raw;
      if (typeof raw === "object" && "text" in raw) return String(raw.text ?? "").trim();
      if (typeof raw === "object" && "result" in raw) return raw.result;
      return raw;
    };
    const dcNumber = String(value("dc_number") ?? "").trim();
    const sku = String(value("sku") ?? "").trim();
    if (!dcNumber && !sku) return;
    rows.push({
      excel_row: rowNumber,
      dc_number: dcNumber,
      fo_or_so_number: String(value("fo_or_so_number") ?? "").trim(),
      do_date: toIsoDate(value("do_date")),
      transporter_name: String(value("transporter_name") ?? "").trim(),
      lr_number: String(value("lr_number") ?? "").trim(),
      lr_date: toIsoDate(value("lr_date")),
      sku,
      // Blank Pack Qty means "unchanged", not zero.
      pack_qty: String(value("pack_qty") ?? "").trim() === "" ? null : Number(value("pack_qty")),
      storage_location_code: String(value("storage_location_code") ?? "").trim(),
      tally_invoice_number: String(value("tally_invoice_number") ?? "").trim(),
      tally_invoice_date: toIsoDate(value("tally_invoice_date")),
      inbound_number: String(value("inbound_number") ?? "").trim(),
      truck_number: String(value("truck_number") ?? "").trim(),
      dispatch_date: toIsoDate(value("dispatch_date")),
    });
  });
  return rows;
}
