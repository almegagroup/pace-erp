/*
 * File-Path: frontend/src/pages/dashboard/procurement/sales/BulkDdSoMapDrawer.jsx
 * Domain: PROCUREMENT / Sales
 * Purpose: "Bulk DD SO Map" — additive to SO01MapPage.jsx (SO01 Tab 2),
 *          per FG-STO-MTS-DISPATCH-DESIGN-DOC.md §6 points 8-12. Resolves a
 *          bulk Excel upload (External SO Number, FO Number, Customer GST/
 *          Name/Address/Town, Has Site, Site Name/Address/Town, SKU, Pack Qty)
 *          into Customer+Site
 *          Address allocations for VDC (Dependent Direct) SOs — MTS never
 *          uses the existing FO (plan_feed)-based path, this is the manual
 *          "address" source driven in bulk. VDC-only; DC never uses this.
 * Authority: Frontend
 */

import { useMemo, useRef, useState } from "react";
import DrawerBase from "../../../../components/layer/DrawerBase.jsx";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import CustomerCreateForm from "../../om/customer/CustomerCreateForm.jsx";
import { listCustomerAddresses, createCustomerAddress, updateCustomerAddress } from "../../om/omApi.js";
import { createMissingGstCustomersForSoMap, previewSoMapBulkUpload, saveSoMapBulkGroups } from "../procurementApi.js";
import { markSpreadsheetDuplicates, prioritizeUploadReviewRows } from "../../../../shared/uploadReviewRows.js";

const TEMPLATE_HEADERS = [
  "External SO Number", "FO Number", "Customer GST", "Customer Name",
  "Customer Address", "TOWN", "Has Site", "SITE NAME", "Site Address", "SITE TOWN", "SKU", "Pack Qty",
];

async function buildTemplateWorkbook() {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Bulk DD SO Map");
  sheet.addRow(TEMPLATE_HEADERS);
  sheet.getRow(1).font = { bold: true };
  for (let rowNumber = 2; rowNumber <= 500; rowNumber += 1) {
    sheet.getCell(rowNumber, 7).dataValidation = { type: "list", allowBlank: true, formulae: ['"Yes,No"'] };
  }
  sheet.columns.forEach((column) => { column.width = 20; });
  return workbook;
}

async function downloadTemplate() {
  const workbook = await buildTemplateWorkbook();
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "bulk_dd_so_map_template.xlsx";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.URL.revokeObjectURL(url);
}

// One business line in the upload: External SO (leading zeros ignored, as
// the server does) + FO + SKU. Pack Qty is deliberately not part of it.
function uploadKey(raw) {
  return [String(raw?.external_so_number ?? "").replace(/^0+(?=\d)/, ""), raw?.fo_number, raw?.sku]
    .map((value) => String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "")).join("::");
}

function collapseSpaces(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

// Source exports append the town to the address after a wide gap
// ("...742151  DWANSARAI") although TOWN is its own column. Drop only that
// exact trailing copy, so the address does not carry the town twice.
function stripTrailingTown(rawAddress, town) {
  const match = String(rawAddress ?? "").match(/^([\s\S]*\S)\s{2,}(\S[\s\S]*?)\s*$/);
  if (match && town && collapseSpaces(match[2]).toUpperCase() === town.toUpperCase()) return collapseSpaces(match[1]);
  return collapseSpaces(rawAddress);
}

// Server preview error codes, in words a user can act on in the Excel.
const UPLOAD_ERROR_TEXT = {
  INVALID_UPLOAD_ROW: "A required column is blank or invalid (SO, FO, Customer Name/Address, SKU, Pack Qty, or Has Site not Yes/No)",
  CUSTOMER_TOWN_REQUIRED: "TOWN is blank",
  SITE_DETAILS_REQUIRED: "Has Site = Yes but Site Name / Site Address / Site Town is blank",
  DUPLICATE_UPLOAD_ROW: "Same External SO + FO + SKU repeated in this Excel",
  DUPLICATE_UPLOAD_ROW_QTY_CONFLICT: "Same External SO + FO + SKU repeated in this Excel with DIFFERENT Pack Qty — keep only the correct line",
  SO_NOT_FOUND: "External SO Number not found",
  SO_COMPANY_MISMATCH: "External SO belongs to another company",
  SO_NOT_VDC_DD: "SO is not a Dependent Direct (DD) SO",
  SO_NO_VDC: "SO has no VDC",
};

function uploadErrorText(code) {
  if (!code) return "";
  const prefix = String(code).split(":")[0];
  return UPLOAD_ERROR_TEXT[prefix] ?? String(code);
}

// Mirrors BulkDoUploadDrawer's "Export Excel": a reason sheet plus the same
// template layout, so the rows can be corrected and uploaded again as-is.
async function exportNotMappedRows(notMappedRows) {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  const reasonSheet = workbook.addWorksheet("Not mapped");
  reasonSheet.addRow(["Excel Row No.", "External SO Number", "FO Number", "SKU", "Pack Qty", "Reason"]);
  notMappedRows.forEach((entry) => reasonSheet.addRow([entry.excel_row_number, entry.raw.external_so_number, entry.raw.fo_number, entry.raw.sku, entry.raw.pack_qty, entry.reason]));
  reasonSheet.getRow(1).font = { bold: true };
  reasonSheet.columns.forEach((column) => { column.width = 22; });
  reasonSheet.getColumn(6).width = 80;
  const rowsSheet = workbook.addWorksheet("Rows to re-upload");
  rowsSheet.addRow(TEMPLATE_HEADERS);
  notMappedRows.forEach(({ raw }) => rowsSheet.addRow([
    raw.external_so_number, raw.fo_number, raw.customer_gst, raw.customer_name, raw.customer_address, raw.town,
    raw.has_site ? "Yes" : "No", raw.site_name, raw.site_address, raw.site_town, raw.sku, raw.pack_qty,
  ]));
  rowsSheet.getRow(1).font = { bold: true };
  rowsSheet.columns.forEach((column) => { column.width = 20; });
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `bulk_dd_so_map_not_mapped_${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.URL.revokeObjectURL(url);
}

async function parseUploadedWorkbook(file) {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  const buffer = await file.arrayBuffer();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  const normalizedHeader = (value) => String(value ?? "").replace(/\u00a0/g, " ").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
  const cellText = (row, index) => {
    const excelCell = row.getCell(index);
    // `.text` preserves Excel display formatting, including a leading zero in
    // an External SO/FO number stored as a numeric cell.
    const displayValue = String(excelCell.text ?? "").trim();
    if (displayValue) return displayValue;
    const value = excelCell.value;
    if (value == null) return "";
    if (typeof value === "object" && "text" in value) return String(value.text ?? "").trim();
    if (typeof value === "object" && "result" in value) return String(value.result ?? "").trim();
    return String(value).trim();
  };
  const aliases = {
    external_so_number: ["externalsonumber"],
    fo_number: ["fonumber"],
    customer_gst: ["customergst", "gstnumber"],
    customer_name: ["customername"],
    customer_address: ["customeraddress"],
    town: ["town", "customertown"],
    has_site: ["hassite"],
    site_name: ["sitename"],
    // Accept the legacy `Site adress` spelling used in the operations feed.
    site_address: ["siteaddress", "siteadress"],
    site_town: ["sitetown"],
    sku: ["sku"],
    pack_qty: ["packqty", "packquantity"],
  };
  let headerRowNumber = 0;
  let columnByField = {};
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (headerRowNumber || rowNumber > 25) return;
    const candidateColumns = {};
    row.eachCell({ includeEmpty: false }, (excelCell, columnNumber) => {
      const header = normalizedHeader(excelCell.text || excelCell.value);
      for (const [field, accepted] of Object.entries(aliases)) {
        if (accepted.includes(header)) candidateColumns[field] = columnNumber;
      }
    });
    if (Object.keys(aliases).every((field) => candidateColumns[field])) {
      headerRowNumber = rowNumber;
      columnByField = candidateColumns;
    }
  });
  if (!headerRowNumber) {
    throw new Error("Template header not found. Required columns: External SO Number, FO Number, Customer GST, Customer Name, Customer Address, TOWN, Has Site, SITE NAME, Site Address, SITE TOWN, SKU, Pack Qty.");
  }
  const rows = [];
  let rowIndexSeq = 0;
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber <= headerRowNumber) return;
    // Raw text keeps internal spacing so the address/town separator below can
    // still be seen; every value stored on the row is whitespace-normalized
    // (non-breaking spaces, tabs, repeated spaces -> one space, trimmed), so a
    // cell holding only spaces is simply blank.
    const rawCell = (field) => (columnByField[field] ? cellText(row, columnByField[field]).replace(/\u00a0/g, " ") : "");
    const cell = (field) => collapseSpaces(rawCell(field));
    const externalSoNumber = cell("external_so_number");
    if (!externalSoNumber) return;
    rowIndexSeq += 1;
    // Business rule (2026-10-13): a blank Has Site means "No". Only a value
    // that is neither Yes nor No is invalid.
    const hasSiteValue = cell("has_site").toUpperCase() || "NO";
    rows.push({
      row_index: rowIndexSeq,
      // Keep the real worksheet row visible in validation messages. The
      // sequence number alone becomes misleading when users leave blanks or
      // notes above/between data rows.
      excel_row_number: rowNumber,
      external_so_number: externalSoNumber,
      fo_number: cell("fo_number"),
      customer_gst: cell("customer_gst").toUpperCase(),
      customer_name: cell("customer_name"),
      customer_address: stripTrailingTown(rawCell("customer_address"), cell("town")),
      town: cell("town"),
      has_site: hasSiteValue === "YES" || hasSiteValue === "Y",
      has_site_valid: ["YES", "Y", "NO", "N"].includes(hasSiteValue),
      site_name: cell("site_name"),
      site_address: cell("site_address"),
      site_town: cell("site_town"),
      sku: cell("sku"),
      pack_qty: Number(cell("pack_qty").replace(/,/g, "")) || 0,
    });
  });
  return rows;
}

function CustomerResolutionCell({ row, raw, onChoose, onChange, onCreateNew }) {
  const resolution = row.customer_resolution;
  if (!resolution) return <span className="text-slate-400">—</span>;
  if (resolution.status === "FOUND" || resolution.status === "MATCHED") {
    const count = row.has_site ? row.site_resolution?.count : null;
    const canChange = new Set((resolution.candidates ?? []).map((candidate) => String(candidate.customer_id))).size > 1;
    return <div className="flex items-center gap-2"><span className="text-emerald-800">{resolution.customer_name || "Resolved"}{count != null ? ` (${count} site${count === 1 ? "" : "s"})` : ""}</span>{canChange ? <button type="button" onClick={() => onChange(row.row_index)} className="text-[11px] font-semibold text-sky-700 underline">Change</button> : null}</div>;
  }
  if (resolution.status === "FOUND_DIFFERENT_VDC") {
    return <span className="font-semibold text-rose-700">GST matched but in Different VDC — fix GST or remove row</span>;
  }
  if (resolution.status === "AUTO_CREATE_FAILED") {
    return <span className="font-semibold text-rose-700">GST customer could not be created automatically — remove row or correct its data</span>;
  }
  if (resolution.status === "AMBIGUOUS") {
    return (
      <div className="grid gap-1">
        <span className="text-[10px] text-slate-500">Excel customer: {[raw?.customer_address, raw?.town].filter(Boolean).join(", ") || "—"}</span>
        <select
          className="h-7 border border-amber-400 bg-amber-50 px-1 text-[11px]"
          defaultValue=""
          onChange={(event) => { if (event.target.value) onChoose(row.row_index, event.target.value, resolution.candidates); }}
        >
          <option value="">Choose from {resolution.candidates?.length ?? 0}…</option>
          {(resolution.candidates ?? []).map((candidate) => (
            <option key={`${candidate.customer_id}-${candidate.customer_address_id}`} value={candidate.customer_id}>
              {candidate.customer_name} — {[candidate.address_line, candidate.town].filter(Boolean).join(", ")}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => onCreateNew(row.row_index, raw)} className="text-left text-[11px] font-semibold text-sky-700 underline">None of these — Create New</button>
      </div>
    );
  }
  // NOT_FOUND
  return (
    <div className="grid gap-1">
      <span className="text-[10px] text-slate-500">Excel customer: {[raw?.customer_address, raw?.town].filter(Boolean).join(", ") || "—"}</span>
      <button type="button" onClick={() => onCreateNew(row.row_index, raw)} className="border border-sky-700 bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-950">
        Not in database — Create
      </button>
    </div>
  );
}

function SiteResolutionCell({ row, raw, onChooseSite, onChangeSite, onAddSite }) {
  const resolution = row.site_resolution;
  if (!resolution) return <span className="text-slate-400">—</span>;
  if (resolution.status === "PENDING_CUSTOMER") return <span className="text-slate-400">Resolve customer first</span>;
  if (resolution.status === "SINGLE" || resolution.status === "MATCHED") {
    const candidate = resolution.candidates?.[0];
    return (
      <div className="flex items-center gap-2">
        <span className="text-emerald-800">{candidate?.site_name || "Site"} — {[candidate?.address_line, candidate?.town].filter(Boolean).join(", ")}</span>
        {(resolution.all_candidates?.length ?? 0) > 1 ? <button type="button" onClick={() => onChangeSite(row.row_index)} className="text-[11px] font-semibold text-sky-700 underline">Change</button> : null}
        <button type="button" onClick={() => onAddSite(row.row_index, raw)} className="text-[11px] font-semibold text-sky-700 underline">Add</button>
      </div>
    );
  }
  if (resolution.status === "CHOOSE") {
    return (
      <div className="grid gap-1">
        <span className="text-[10px] text-slate-500">Excel site: {[raw?.site_name, raw?.site_address, raw?.site_town].filter(Boolean).join(" — ") || "—"}</span>
        <select
          className="h-7 border border-amber-400 bg-amber-50 px-1 text-[11px]"
          defaultValue=""
          onChange={(event) => { if (event.target.value) onChooseSite(row.row_index, event.target.value, resolution.candidates); }}
        >
          <option value="">Choose from {resolution.candidates?.length ?? 0} sites…</option>
          {(resolution.candidates ?? []).map((candidate) => (
            <option key={candidate.id} value={candidate.id}>{candidate.site_name} — {[candidate.address_line, candidate.town].filter(Boolean).join(", ")}</option>
          ))}
        </select>
        <button type="button" onClick={() => onAddSite(row.row_index, raw)} className="text-left text-[11px] font-semibold text-sky-700 underline">None of these — Add Site Address</button>
      </div>
    );
  }
  // NONE
  return (
    <button type="button" onClick={() => onAddSite(row.row_index, raw)} className="border border-sky-700 bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-950">
      Add Site Address
    </button>
  );
}

function AddSiteAddressForm({ customerId, vdcId, raw, onDone, onCancel }) {
  const [sameAsCustomer, setSameAsCustomer] = useState(!raw?.site_address);
  const [siteName, setSiteName] = useState(raw?.site_name || raw?.customer_name || "");
  const [addressLine, setAddressLine] = useState(raw?.site_address || raw?.customer_address || "");
  const [town, setTown] = useState(raw?.site_town || raw?.town || "");
  const [pinCode, setPinCode] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    if (!town.trim()) { setError("Town is required."); return; }
    setSaving(true); setError("");
    try {
      const created = await createCustomerAddress({
        customer_id: customerId,
        site_name: (sameAsCustomer ? (raw?.customer_name || siteName) : siteName) || siteName,
        address_line: (sameAsCustomer ? (raw?.customer_address || addressLine) : addressLine) || addressLine,
        town: town.trim(),
        pin_code: pinCode.trim() || undefined,
        depot_code_id: vdcId,
      });
      const createdAddress = created?.data ?? created;
      onDone(createdAddress);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "OM_ADDRESS_CREATE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-2 text-sm">
      {error ? <div className="border border-rose-300 bg-rose-50 px-2 py-1 text-xs text-rose-800">{error}</div> : null}
      <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
        <input type="checkbox" checked={sameAsCustomer} onChange={(event) => setSameAsCustomer(event.target.checked)} />
        Same as Customer (Site Name + Address auto-filled)
      </label>
      {!sameAsCustomer ? (
        <>
          <label className="grid gap-1 text-xs text-slate-600">Site Name
            <input value={siteName} onChange={(event) => setSiteName(event.target.value)} className="h-8 border border-slate-300 bg-white px-2" />
          </label>
          <label className="grid gap-1 text-xs text-slate-600">Address Line
            <input value={addressLine} onChange={(event) => setAddressLine(event.target.value)} className="h-8 border border-slate-300 bg-white px-2" />
          </label>
        </>
      ) : null}
      <label className="grid gap-1 text-xs text-slate-600">Town *
        <input value={town} onChange={(event) => setTown(event.target.value)} className="h-8 border border-slate-300 bg-[#fffef7] px-2" />
      </label>
      <label className="grid gap-1 text-xs text-slate-600">Pin Code
        <input value={pinCode} onChange={(event) => setPinCode(event.target.value)} className="h-8 border border-slate-300 bg-white px-2" />
      </label>
      <div className="flex gap-2">
        <button type="button" disabled={saving} onClick={() => void handleSave()} className="border border-sky-700 bg-sky-100 px-3 py-1.5 text-xs font-semibold text-sky-950 disabled:opacity-50">Save</button>
        <button type="button" onClick={onCancel} className="border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-600">Cancel</button>
      </div>
    </div>
  );
}

export default function BulkDdSoMapDrawer({ companyId, onClose, onSaved }) {
  const [rows, setRows] = useState(null);
  const [rawByIndex, setRawByIndex] = useState({});
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [createDrawerRowIndex, setCreateDrawerRowIndex] = useState(null);
  const [addSiteRowIndex, setAddSiteRowIndex] = useState(null);
  // row_index -> server error code for FO groups the bulk save rejected.
  const [saveFailures, setSaveFailures] = useState({});
  const [showNotMapped, setShowNotMapped] = useState(false);
  const fileInputRef = useRef(null);

  const createDrawerRow = useMemo(() => (rows ?? []).find((row) => row.row_index === createDrawerRowIndex), [rows, createDrawerRowIndex]);
  const addSiteRow = useMemo(() => (rows ?? []).find((row) => row.row_index === addSiteRowIndex), [rows, addSiteRowIndex]);

  function updateRow(rowIndex, patch) {
    setRows((current) => (current ?? []).map((row) => (row.row_index === rowIndex ? { ...row, ...patch } : row)));
  }
  function rowHasSite(row) {
    return row?.has_site === true || rawByIndex[row?.row_index]?.has_site === true;
  }
  function normalizedInput(value) {
    return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
  }
  function sameCustomerInput(left, right) {
    return Boolean(left?.customer_address && right?.customer_address)
      && normalizedInput(left.customer_address) === normalizedInput(right.customer_address)
      && normalizedInput(left.town) === normalizedInput(right.town);
  }
  function sameSiteInput(left, right) {
    return Boolean(left?.site_name && left?.site_address && left?.site_town && right?.site_name && right?.site_address && right?.site_town)
      && normalizedInput(left.site_name) === normalizedInput(right.site_name)
      && normalizedInput(left.site_address) === normalizedInput(right.site_address)
      && normalizedInput(left.site_town) === normalizedInput(right.site_town);
  }
  function recalculateQtyStatuses(nextRows) {
    const totals = new Map();
    for (const row of nextRows) {
      const resolution = row.sku_resolution;
      if (row.status !== "RESOLVED" || resolution?.status !== "MATCHED" || !resolution.so_line_id) continue;
      const key = String(resolution.so_line_id);
      const entry = totals.get(key) ?? { lineTotal: Number(resolution.line_total_qty ?? 0), allocated: Number(resolution.existing_allocated_qty ?? 0), replacing: 0, requested: 0 };
      entry.replacing += Number(resolution.existing_group_qty ?? 0);
      const perPackQty = Number(resolution.per_pack_qty ?? 0);
      entry.requested += Number(rawByIndex[row.row_index]?.pack_qty ?? 0) * (perPackQty > 0 ? perPackQty : 1);
      totals.set(key, entry);
    }
    return nextRows.map((row) => {
      const entry = totals.get(String(row.sku_resolution?.so_line_id ?? ""));
      if (!entry) return row;
      return { ...row, qty_status: entry.allocated - entry.replacing + entry.requested > entry.lineTotal + 0.0001 ? "EXCEEDS_BALANCE" : "OK" };
    });
  }
  function chooseSku(rowIndex, soLineId) {
    setRows((current) => {
      const nextRows = (current ?? []).map((row) => {
        if (row.row_index !== rowIndex) return row;
        const candidate = (row.sku_resolution?.candidates ?? []).find((item) => String(item.so_line_id) === String(soLineId));
        return candidate ? { ...row, sku_resolution: { status: "MATCHED", ...candidate } } : row;
      });
      return recalculateQtyStatuses(nextRows);
    });
  }
  function removeRow(rowIndex) {
    removeRows([rowIndex]);
  }
  function removeRows(rowIndexes) {
    const indexes = new Set(rowIndexes);
    const remainingRows = (rows ?? []).filter((row) => !indexes.has(row.row_index));
    const remainingRaw = Object.fromEntries(Object.entries(rawByIndex).filter(([rowIndex]) => !indexes.has(Number(rowIndex))));
    setRows(remainingRows);
    setRawByIndex(remainingRaw);
    // A quantity-conflict row whose other copy was just removed is now a
    // normal row; ask the server to resolve it instead of leaving the stale
    // conflict error on screen.
    const keyCounts = new Map();
    for (const raw of Object.values(remainingRaw)) keyCounts.set(uploadKey(raw), (keyCounts.get(uploadKey(raw)) ?? 0) + 1);
    const nowUnique = remainingRows
      .filter((row) => row.error_code === "DUPLICATE_UPLOAD_ROW_QTY_CONFLICT" && keyCounts.get(uploadKey(remainingRaw[row.row_index])) === 1)
      .map((row) => remainingRaw[row.row_index]);
    if (nowUnique.length === 0) return;
    previewSoMapBulkUpload({ company_id: companyId, rows: nowUnique })
      .then((result) => {
        const refreshed = Array.isArray(result) ? result : result?.data;
        const byIndex = new Map((Array.isArray(refreshed) ? refreshed : []).map((row) => [row.row_index, row]));
        setRows((current) => recalculateQtyStatuses((current ?? []).map((row) => byIndex.get(row.row_index) ?? row)));
      })
      .catch((previewError) => setError(previewError instanceof Error ? previewError.message : "SO_MAP_BULK_PREVIEW_FAILED"));
  }

  async function handleFileChosen(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(""); setNotice(""); setUploading(true);
    setSaveFailures({}); setShowNotMapped(false);
    try {
      const parsedRows = await parseUploadedWorkbook(file);
      if (parsedRows.length === 0) { setError("The uploaded file has no data rows."); return; }
      const rawMap = {};
      parsedRows.forEach((row) => { rawMap[row.row_index] = row; });
      setRawByIndex(rawMap);
      // The server first performs its own authoritative preview and creates
      // only GST-NOT_FOUND groups. Calling it unconditionally avoids a
      // browser-side preview/write/preview chain: every upload has exactly
      // one bulk action followed by one final review-grid preview.
      const batchResult = await createMissingGstCustomersForSoMap({ company_id: companyId, rows: parsedRows });
      const batchData = batchResult?.data ?? batchResult;
      const failedCount = Array.isArray(batchData?.failed) ? batchData.failed.length : 0;
      if (failedCount > 0) {
        setNotice(`${failedCount} GST customer group(s) could not be auto-created. Those rows remain available for correction.`);
      }
      // Re-run the single preview after the batch write so all rows use the
      // normal resolver path (including customer/site reuse and counts).
      const refreshedResult = await previewSoMapBulkUpload({ company_id: companyId, rows: parsedRows });
      const refreshedRows = Array.isArray(refreshedResult) ? refreshedResult : refreshedResult?.data;
      setRows(Array.isArray(refreshedRows) ? refreshedRows : []);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "SO_MAP_BULK_PREVIEW_FAILED");
    } finally {
      setUploading(false);
    }
  }

  // §6 point 9 dedup/reuse — once a customer is resolved for one row, every
  // OTHER row in this same batch with the exact same customer address + town
  // reuses it. A site is reused only when its name, address and town all
  // match; a generic customer-address match must never silently cross-map
  // two physical sites.
  function applyDedup(sourceRowIndex, customerId, customerName, customerAddressId, siteResolution) {
    const sourceRaw = rawByIndex[sourceRowIndex];
    if (!sourceRaw) return;
    setRows((current) => (current ?? []).map((row) => {
      if (row.row_index === sourceRowIndex) return row;
      const otherRaw = rawByIndex[row.row_index];
      if (!sameCustomerInput(otherRaw, sourceRaw)) return row;
      return {
        ...row,
        customer_resolution: { mode: row.customer_resolution?.mode, status: "FOUND", customer_id: customerId, customer_name: customerName, customer_address_id: customerAddressId },
        site_resolution: rowHasSite(row) && sameSiteInput(otherRaw, sourceRaw) ? siteResolution : row.site_resolution,
      };
    }));
  }

  function chooseCustomer(rowIndex, customerId, candidates) {
    const matchingCandidates = (candidates ?? []).filter((entry) => String(entry.customer_id) === String(customerId));
    const candidate = matchingCandidates[0];
    const customerName = candidate?.customer_name || "Customer";
    const siteCandidates = matchingCandidates.map((entry) => ({
      id: entry.customer_address_id, site_name: entry.site_name,
      address_line: entry.address_line, town: entry.town, state: entry.state,
    }));
    const siteResolution = {
      count: siteCandidates.length,
      status: siteCandidates.length === 0 ? "NONE" : siteCandidates.length === 1 ? "SINGLE" : "CHOOSE",
      candidates: siteCandidates,
    };
    updateRow(rowIndex, {
      customer_resolution: { status: "FOUND", customer_id: customerId, customer_name: customerName, customer_address_id: candidate?.customer_address_id, candidates },
      site_resolution: rowHasSite((rows ?? []).find((row) => row.row_index === rowIndex)) ? siteResolution : null,
    });
    applyDedup(rowIndex, customerId, customerName, candidate?.customer_address_id, siteResolution);
  }

  function chooseSite(rowIndex, siteId, candidates) {
    const candidate = (candidates ?? []).find((entry) => String(entry.id) === String(siteId));
    updateRow(rowIndex, { site_resolution: { count: 1, status: "SINGLE", candidates: [candidate], all_candidates: candidates } });
  }

  async function handleCustomerCreated(rowIndex, vdcId, customer) {
    try {
      // The Customer POST returns its VDC-mapped first address. The fallback
      // only supports an older backend while a stale browser tab is open.
      let firstAddress = customer?.first_address;
      if (!firstAddress?.id) {
        const addrResult = await listCustomerAddresses(customer.id);
        const addresses = Array.isArray(addrResult?.data) ? addrResult.data : (Array.isArray(addrResult) ? addrResult : []);
        firstAddress = addresses[0];
        if (firstAddress?.id) await updateCustomerAddress({ id: firstAddress.id, depot_code_id: vdcId });
      }
      const targetRow = (rows ?? []).find((row) => row.row_index === rowIndex);
      const raw = rawByIndex[rowIndex];
      let siteResolution = null;
      if (rowHasSite(targetRow)) {
        const siteResult = await createCustomerAddress({
          customer_id: customer.id,
          site_name: raw?.site_name,
          address_line: raw?.site_address,
          town: raw?.site_town,
          depot_code_id: vdcId,
        });
        const site = siteResult?.data ?? siteResult;
        if (!site?.id) throw new Error("SO_MAP_SITE_CREATE_FAILED");
        siteResolution = { count: 1, status: "MATCHED", candidates: [site] };
      }
      updateRow(rowIndex, {
        customer_resolution: { status: "FOUND", customer_id: customer.id, customer_name: customer.customer_name, customer_address_id: firstAddress?.id },
        site_resolution: siteResolution,
      });
      applyDedup(rowIndex, customer.id, customer.customer_name, firstAddress?.id, siteResolution);
    } catch (chainError) {
      setError(chainError instanceof Error ? chainError.message : "SO_MAP_BULK_VDC_MAP_FAILED");
    } finally {
      setCreateDrawerRowIndex(null);
    }
  }

  function handleSiteAdded(rowIndex, createdAddress) {
    const source = (rows ?? []).find((row) => row.row_index === rowIndex);
    const sourceRaw = rawByIndex[rowIndex];
    setRows((current) => (current ?? []).map((row) => {
      const sameCustomer = String(row.customer_resolution?.customer_id) === String(source?.customer_resolution?.customer_id);
      const sameVdc = String(row.vdc_id) === String(source?.vdc_id);
      const sameSite = sameSiteInput(rawByIndex[row.row_index], sourceRaw);
      if (!sameCustomer || !sameVdc || !rowHasSite(row)) return row;

      // A Site Address created from one row is immediately a valid candidate
      // for every other row of that customer in this VDC. Exact same uploaded
      // site details auto-select it; other rows deliberately get it in their
      // dropdown instead of being forced to create the same site again.
      const resolution = row.site_resolution ?? {};
      const currentCandidates = resolution.all_candidates ?? resolution.candidates ?? [];
      const allCandidates = currentCandidates.some((candidate) => String(candidate?.id) === String(createdAddress?.id))
        ? currentCandidates
        : [...currentCandidates, createdAddress];
      if (row.row_index === rowIndex || sameSite) {
        return {
          ...row,
          site_resolution: {
            count: allCandidates.length,
            status: "MATCHED",
            candidates: [createdAddress],
            all_candidates: allCandidates,
          },
        };
      }
      if (resolution.status === "SINGLE" || resolution.status === "MATCHED") {
        return { ...row, site_resolution: { ...resolution, count: allCandidates.length, all_candidates: allCandidates } };
      }
      return {
        ...row,
        site_resolution: {
          count: allCandidates.length,
          status: "CHOOSE",
          candidates: allCandidates,
          all_candidates: allCandidates,
        },
      };
    }));
    setAddSiteRowIndex(null);
  }

  async function handleSaveAll() {
    setSaving(true); setError(""); setNotice("");
    try {
      const groups = saveAnalysis.groups;
      const attemptedRows = groups.reduce((total, group) => total + group.row_indexes.length, 0);
      const result = await saveSoMapBulkGroups({ groups });
      const saveResult = result?.data ?? result;
      const failures = Array.isArray(saveResult?.failed) ? saveResult.failed : [];
      const nextFailures = {};
      for (const failure of failures) {
        for (const rowIndex of failure.row_indexes ?? []) nextFailures[rowIndex] = failure.error_code || "SO_MAP_GROUP_SAVE_FAILED";
      }
      setSaveFailures(nextFailures);
      const failedRowCount = Object.keys(nextFailures).length;
      const mappedCount = attemptedRows - failedRowCount;
      // Re-run the authoritative preview so just-saved rows show as already
      // mapped and every remaining row shows its real, current state.
      const refreshedResult = await previewSoMapBulkUpload({ company_id: companyId, rows: Object.values(rawByIndex) });
      const refreshedRows = Array.isArray(refreshedResult) ? refreshedResult : refreshedResult?.data;
      if (Array.isArray(refreshedRows)) setRows(refreshedRows);
      const keptBack = saveAnalysis.notMapped.length + failedRowCount;
      setNotice(keptBack > 0
        ? `${mappedCount} row(s) mapped. ${keptBack} row(s) NOT mapped — open "Not mapped rows" to see why and export them.`
        : `${mappedCount} row(s) mapped.`);
      if (keptBack > 0) setShowNotMapped(true);
      if (mappedCount > 0) onSaved?.();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "SO_MAP_BULK_SAVE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  function getRowBlockReason(row) {
    if (row.duplicate_status === "UNCHANGED") return null;
    if (saveFailures[row.row_index]) return `Save failed: ${saveFailures[row.row_index]}`;
    if (row.status !== "RESOLVED") return uploadErrorText(row.error_code) || "Upload row is invalid";
    if (row.duplicate_status === "CHANGED_QTY" && !row.change_confirmed) return "Confirm changed quantity or remove this row";
    if (row.sku_resolution?.status !== "MATCHED") return "Choose a SKU from this SO";
    if (row.qty_status !== "OK") return "Quantity exceeds this SO item's remaining balance";
    if (!row.customer_resolution?.customer_id) {
      if (row.customer_resolution?.status === "FOUND_DIFFERENT_VDC") return "GST belongs to a different VDC";
      return "Resolve or create the customer";
    }
    const addressId = row.site_resolution?.candidates?.[0]?.id || row.customer_resolution?.customer_address_id;
    if (!addressId) return "Customer address is not resolved";
    if (rowHasSite(row) && !row.site_resolution?.candidates?.[0]?.id) return "Choose or add the Site Address";
    return null;
  }
  const reviewedRowsWithDuplicates = useMemo(() => markSpreadsheetDuplicates(rows, (row) => uploadKey(rawByIndex[row.row_index])).map((row) => {
    const isUploadDuplicate = row.error_code === "DUPLICATE_UPLOAD_ROW" || (row.upload_duplicate === true && row.error_code !== "DUPLICATE_UPLOAD_ROW_QTY_CONFLICT");
    return {
      ...row,
      upload_duplicate_of: row.upload_duplicate_of ?? row.duplicate_of_row_index ?? null,
      review_duplicate_kind: row.duplicate_status === "UNCHANGED" ? "ALREADY_MAPPED" : isUploadDuplicate ? "UPLOAD_DUPLICATE" : null,
    };
  }), [rawByIndex, rows]);
  const effectiveRows = useMemo(() => reviewedRowsWithDuplicates.filter((row) => !row.review_duplicate_kind), [reviewedRowsWithDuplicates]);
  const uploadDuplicateRows = useMemo(() => reviewedRowsWithDuplicates.filter((row) => row.review_duplicate_kind === "UPLOAD_DUPLICATE"), [reviewedRowsWithDuplicates]);
  const alreadyMappedCount = reviewedRowsWithDuplicates.filter((row) => row.review_duplicate_kind === "ALREADY_MAPPED").length;

  // One FO is saved as one mapping group. If any line of an FO is not ready,
  // the whole FO is kept back (never half-mapped) and listed with a reason.
  const saveAnalysis = (() => {
    const excelRow = (row) => rawByIndex[row.row_index]?.excel_row_number ?? row.row_index;
    const byFo = new Map();
    for (const row of effectiveRows) {
      const raw = rawByIndex[row.row_index] ?? {};
      const key = [String(raw.external_so_number ?? "").replace(/^0+(?=\d)/, ""), raw.fo_number].map(normalizedInput).join("::");
      if (!byFo.has(key)) byFo.set(key, []);
      byFo.get(key).push({ row, reason: getRowBlockReason(row) });
    }
    const groups = [];
    const notMapped = [];
    for (const entries of byFo.values()) {
      const blocked = entries.find((entry) => entry.reason);
      const siteIds = new Set(entries.map(({ row }) => String(row.site_resolution?.candidates?.[0]?.id || row.customer_resolution?.customer_address_id || "")));
      const foNumber = rawByIndex[entries[0].row.row_index]?.fo_number || "";
      if (blocked || siteIds.size > 1) {
        for (const { row, reason } of entries) {
          notMapped.push({
            row_index: row.row_index,
            excel_row_number: excelRow(row),
            raw: rawByIndex[row.row_index] ?? {},
            reason: reason
              || (blocked
                ? `Another line of FO ${foNumber} is not ready (Excel row ${excelRow(blocked.row)}) — the whole FO is kept back`
                : `Lines of FO ${foNumber} resolve to different customer/site addresses — one FO must have one destination`),
          });
        }
        continue;
      }
      const first = entries[0].row;
      const raw = rawByIndex[first.row_index] ?? {};
      groups.push({
        so_id: first.so_id,
        source: "address",
        customer_address_id: first.site_resolution?.candidates?.[0]?.id || first.customer_resolution?.customer_address_id,
        external_fo_number: raw.fo_number || undefined,
        items: entries.map(({ row }) => {
          const perPackQty = Number(row.sku_resolution?.per_pack_qty ?? 0);
          const packQty = Number(rawByIndex[row.row_index]?.pack_qty ?? 0);
          return { so_line_id: row.sku_resolution?.so_line_id, allocated_qty: packQty * (perPackQty > 0 ? perPackQty : 1) };
        }),
        row_indexes: entries.map(({ row }) => row.row_index),
      });
    }
    notMapped.sort((left, right) => left.excel_row_number - right.excel_row_number);
    return { groups, notMapped };
  })();
  const readyCount = saveAnalysis.groups.reduce((total, group) => total + group.row_indexes.length, 0);
  const notMappedReasonByRow = new Map(saveAnalysis.notMapped.map((entry) => [entry.row_index, entry.reason]));
  const reviewRows = prioritizeUploadReviewRows(reviewedRowsWithDuplicates, (row) => row.review_duplicate_kind ? -10 : notMappedReasonByRow.has(row.row_index));

  return (
    <DrawerBase
      visible
      title="Bulk DD SO Map"
      onEscape={onClose}
      onClose={onClose}
      width="min(1200px, calc(100vw - 24px))"
      actions={
        <button type="button" onClick={onClose} className="border border-sky-700 bg-sky-100 px-4 py-2 text-sm font-semibold uppercase tracking-[0.06em] text-sky-950">Done</button>
      }
    >
      <div className="grid gap-3">
        {error ? <div className="border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-800">{error}</div> : null}
        {notice ? <div className="border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">{notice}</div> : null}

        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void downloadTemplate()} className="border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">Download Template</button>
          <button type="button" disabled={uploading} onClick={() => fileInputRef.current?.click()} className="border border-sky-700 bg-sky-100 px-3 py-1.5 text-xs font-semibold text-sky-950 disabled:opacity-50">
            {uploading ? "Uploading…" : "Upload Excel"}
          </button>
          <input ref={fileInputRef} type="file" accept=".xlsx" className="hidden" onChange={(event) => void handleFileChosen(event)} />
          {uploadDuplicateRows.length ? <button type="button" onClick={() => removeRows(uploadDuplicateRows.map((row) => row.row_index))} className="border border-amber-500 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900">Remove {uploadDuplicateRows.length} duplicate row(s)</button> : null}
          {rows && alreadyMappedCount ? <span className="text-xs text-slate-500">{alreadyMappedCount} row(s) already mapped — skipped automatically</span> : null}
          {rows && saveAnalysis.notMapped.length ? <button type="button" onClick={() => setShowNotMapped((current) => !current)} className="border border-rose-400 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-800">Not mapped rows ({saveAnalysis.notMapped.length})</button> : null}
        </div>

        {rows && showNotMapped && saveAnalysis.notMapped.length ? (
          <div className="grid gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2 border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-900">
              <span>These Excel rows are not mapped. Correct them (in the Excel or in the grid below) and upload the exported &quot;Rows to re-upload&quot; sheet again.</span>
              <button type="button" onClick={() => void exportNotMappedRows(saveAnalysis.notMapped)} className="border border-emerald-600 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-900">Export Excel</button>
            </div>
            <ErpDenseGrid
              cellNavigate
              columnFilter
              maxHeight="320px"
              columns={[
                { key: "excel_row_number", label: "Excel Row No.", width: "100px", align: "right" },
                { key: "external_so_number", label: "External SO Number", width: "145px", render: (entry) => entry.raw.external_so_number || "—" },
                { key: "fo_number", label: "FO Number", width: "120px", render: (entry) => entry.raw.fo_number || "—" },
                { key: "sku", label: "SKU", width: "120px", render: (entry) => entry.raw.sku || "—" },
                { key: "pack_qty", label: "Pack Qty", width: "80px", align: "right", render: (entry) => entry.raw.pack_qty ?? "—" },
                { key: "reason", label: "Reason", width: "520px" },
              ]}
              rows={saveAnalysis.notMapped}
              rowKey={(entry) => entry.row_index}
              emptyMessage="No rows."
            />
          </div>
        ) : null}

        {rows ? (
          <>
            <ErpDenseGrid
              cellNavigate
              columnFilter
              maxHeight="520px"
              columns={[
                {
                  key: "review_status", label: "Review Status", width: "260px", render: (row) => {
                    if (row.review_duplicate_kind === "ALREADY_MAPPED") return <span className="font-semibold text-slate-600">Already mapped — excluded from save</span>;
                    if (row.review_duplicate_kind === "UPLOAD_DUPLICATE") return <span className="font-semibold text-slate-600">Duplicate of Excel row {row.upload_duplicate_of}</span>;
                    const reason = notMappedReasonByRow.get(row.row_index);
                    return reason
                      ? <span className="font-semibold text-rose-700">Excel row {rawByIndex[row.row_index]?.excel_row_number ?? row.row_index}: {reason}</span>
                      : <span className="text-emerald-800">Ready</span>;
                  },
                },
                { key: "external_so_number", label: "External SO Number", width: "145px", render: (row) => rawByIndex[row.row_index]?.external_so_number || "—" },
                { key: "fo_number", label: "FO Number", width: "120px", render: (row) => rawByIndex[row.row_index]?.fo_number || "—" },
                { key: "customer_gst", label: "Customer GST", width: "145px", render: (row) => rawByIndex[row.row_index]?.customer_gst || "—" },
                {
                  key: "customer", label: "Customer Name", width: "280px", render: (row) => row.status === "RESOLVED" ? (
                    <CustomerResolutionCell
                      row={row}
                      raw={rawByIndex[row.row_index]}
                      onChoose={chooseCustomer}
                      onChange={(rowIndex) => updateRow(rowIndex, { customer_resolution: { ...row.customer_resolution, status: "AMBIGUOUS" } })}
                      onCreateNew={(rowIndex) => setCreateDrawerRowIndex(rowIndex)}
                    />
                  ) : <span className="text-rose-700">{row.error_code || "—"}</span>,
                },
                { key: "customer_address", label: "Customer Address", width: "220px", render: (row) => rawByIndex[row.row_index]?.customer_address || "—" },
                { key: "town", label: "Town", width: "130px", render: (row) => rawByIndex[row.row_index]?.town || "—" },
                { key: "has_site", label: "Has Site", width: "90px", render: (row) => rawByIndex[row.row_index]?.has_site ? "Yes" : "No" },
                { key: "site_name", label: "Site Name", width: "170px", render: (row) => rawByIndex[row.row_index]?.site_name || "—" },
                {
                  key: "site", label: "Site Address", width: "260px", render: (row) => (row.status === "RESOLVED" && rowHasSite(row)) ? (
                    <SiteResolutionCell
                      row={row}
                      raw={rawByIndex[row.row_index]}
                      onChooseSite={chooseSite}
                      onChangeSite={(rowIndex) => updateRow(rowIndex, { site_resolution: { ...row.site_resolution, status: "CHOOSE", candidates: row.site_resolution?.all_candidates ?? [] } })}
                      onAddSite={(rowIndex) => setAddSiteRowIndex(rowIndex)}
                    />
                  ) : <span className="text-slate-400">—</span>,
                },
                { key: "site_town", label: "Site Town", width: "140px", render: (row) => rawByIndex[row.row_index]?.site_town || "—" },
                { key: "sku", label: "SKU", width: "180px", render: (row) => row.sku_resolution?.status === "MATCHED" ? (row.sku_resolution.document_name || rawByIndex[row.row_index]?.sku || "—") : (rawByIndex[row.row_index]?.sku || "—") },
                {
                  key: "sku_status", label: "SKU Resolve", width: "160px", render: (row) => {
                    if (row.status !== "RESOLVED") return <span className="text-rose-700">{row.error_code}</span>;
                    if (row.sku_resolution?.status === "MATCHED") return <span className="text-emerald-800">Matched</span>;
                    return (
                      <select className="h-7 border border-amber-400 bg-amber-50 px-1 text-[11px]" defaultValue=""
                        onChange={(event) => chooseSku(row.row_index, event.target.value)}>
                        <option value="">Choose SO item…</option>
                        {(row.sku_resolution?.candidates ?? []).map((candidate) => (
                          <option key={candidate.so_line_id} value={candidate.so_line_id}>{candidate.display}</option>
                        ))}
                      </select>
                    );
                  },
                },
                { key: "pack_qty", label: "Pack Qty", width: "90px", align: "right", render: (row) => rawByIndex[row.row_index]?.pack_qty ?? "—" },
                { key: "so_number", label: "SO Number", width: "120px", render: (row) => row.so_number || "—" },
                { key: "dd_flagged", label: "DD Flagged", width: "95px", render: (row) => row.status === "RESOLVED" ? <span className="text-emerald-800">{row.dd_flagged ? "Yes" : "No"}</span> : "—" },
                {
                  key: "qty_status", label: "Qty Check", width: "110px", render: (row) => row.qty_status === "EXCEEDS_BALANCE"
                    ? <span className="font-semibold text-rose-700">Exceeds balance</span>
                    : <span className="text-emerald-800">OK</span>,
                },
                {
                  key: "duplicate", label: "Duplicate", width: "150px", render: (row) => {
                    if (row.duplicate_status === "UNCHANGED") return <span className="text-slate-500">Duplicate (skip)</span>;
                    if (row.duplicate_status === "CHANGED_QTY") return row.change_confirmed
                      ? <span className="font-semibold text-emerald-800">Qty change confirmed</span>
                      : <span className="flex items-center gap-1 font-semibold text-amber-700">Changed from {row.previous_pack_qty ?? row.previous_qty}<button type="button" onClick={() => updateRow(row.row_index, { change_confirmed: true })} className="border border-amber-500 bg-amber-50 px-1 text-[10px]">Confirm</button></span>;
                    return <span className="text-slate-400">—</span>;
                  },
                },
                {
                  key: "actions", label: "", width: "70px", render: (row) => (
                    <button type="button" onClick={() => removeRow(row.row_index)} className="border border-rose-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-rose-700">Remove</button>
                  ),
                },
              ]}
              rows={reviewRows}
              rowKey={(row) => row.row_index}
              getRowProps={(row) => row.review_duplicate_kind ? { className: "bg-slate-100 text-slate-500" } : (notMappedReasonByRow.has(row.row_index) ? { className: "bg-amber-50" } : {})}
              emptyMessage="No rows."
            />
            {saveAnalysis.notMapped.length ? (
              <div className="border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
                {saveAnalysis.notMapped.length} row(s) will NOT be mapped by Save. Fix them here, or open &quot;Not mapped rows&quot; to see each reason and export them to Excel.
              </div>
            ) : null}
            <button type="button" disabled={saving || readyCount === 0} onClick={() => void handleSaveAll()} className="border border-sky-700 bg-sky-100 px-4 py-2 text-sm font-semibold text-sky-950 disabled:opacity-50">
              {saving ? "Saving…" : `Save ${readyCount} Mapping(s)`}
            </button>
          </>
        ) : null}
      </div>

      {createDrawerRow ? (
        <DrawerBase
          visible
          title="Create New Customer"
          onEscape={() => setCreateDrawerRowIndex(null)}
          onClose={() => setCreateDrawerRowIndex(null)}
          width="min(560px, calc(100vw - 24px))"
        >
          <CustomerCreateForm
            companyMode="LOCKED"
            lockedCompanyId={companyId}
            fieldMode="MINIMAL"
            initialCustomerName={rawByIndex[createDrawerRow.row_index]?.customer_name || ""}
            initialDeliveryAddress={rawByIndex[createDrawerRow.row_index]?.customer_address || ""}
            initialBillingState={createDrawerRow.vdc_state || ""}
            initialTown={rawByIndex[createDrawerRow.row_index]?.town || ""}
            initialSiteName={rawByIndex[createDrawerRow.row_index]?.customer_name || ""}
            initialPinCode=""
            initialGstNumber={rawByIndex[createDrawerRow.row_index]?.customer_gst || ""}
            initialGstCategory={rawByIndex[createDrawerRow.row_index]?.customer_gst ? "REGISTERED" : "UNREGISTERED"}
            initialDepotCodeId={createDrawerRow.vdc_id}
            lockBillingState
            requireTown
            onSaved={(customer) => void handleCustomerCreated(createDrawerRow.row_index, createDrawerRow.vdc_id, customer)}
            onCancel={() => setCreateDrawerRowIndex(null)}
            submitLabel="Create Customer"
          />
        </DrawerBase>
      ) : null}

      {addSiteRow ? (
        <DrawerBase
          visible
          title="Add Site Address"
          onEscape={() => setAddSiteRowIndex(null)}
          onClose={() => setAddSiteRowIndex(null)}
          width="min(480px, calc(100vw - 24px))"
        >
          <AddSiteAddressForm
            customerId={addSiteRow.customer_resolution?.customer_id}
            vdcId={addSiteRow.vdc_id}
            raw={rawByIndex[addSiteRow.row_index]}
            onDone={(createdAddress) => handleSiteAdded(addSiteRow.row_index, createdAddress)}
            onCancel={() => setAddSiteRowIndex(null)}
          />
        </DrawerBase>
      ) : null}
    </DrawerBase>
  );
}
