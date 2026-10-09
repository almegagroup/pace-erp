/*
 * File-Path: frontend/src/pages/dashboard/procurement/sales/BulkDdSoMapDrawer.jsx
 * Domain: PROCUREMENT / Sales
 * Purpose: "Bulk DD SO Map" — additive to SO01MapPage.jsx (SO01 Tab 2),
 *          per FG-STO-MTS-DISPATCH-DESIGN-DOC.md §6 points 8-12. Resolves a
 *          bulk Excel upload (External SO Number, FO Number, Customer GST/
 *          Name/Address, Has Site, SKU, Pack Qty) into Customer+Site
 *          Address allocations for VDC (Dependent Direct) SOs — MTS never
 *          uses the existing FO (plan_feed)-based path, this is the manual
 *          "address" source driven in bulk. VDC-only; DC never uses this.
 * Authority: Frontend
 */

import { useMemo, useRef, useState } from "react";
import DrawerBase from "../../../../components/layer/DrawerBase.jsx";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import CustomerCreateForm from "../../om/customer/CustomerCreateForm.jsx";
import { createCustomer, listCustomerAddresses, createCustomerAddress, lookupCustomerGstProfile, updateCustomerAddress } from "../../om/omApi.js";
import { previewSoMapBulkUpload, saveSoMapGroup } from "../procurementApi.js";

const TEMPLATE_HEADERS = [
  "External SO Number", "FO Number", "Customer GST", "Customer Name",
  "Customer Address", "Has Site", "SKU", "Pack Qty",
];

async function buildTemplateWorkbook() {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Bulk DD SO Map");
  sheet.addRow(TEMPLATE_HEADERS);
  sheet.getRow(1).font = { bold: true };
  for (let rowNumber = 2; rowNumber <= 500; rowNumber += 1) {
    sheet.getCell(rowNumber, 6).dataValidation = { type: "list", allowBlank: true, formulae: ['"Yes,No"'] };
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

async function parseUploadedWorkbook(file) {
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
      return String(value).trim();
    };
    const externalSoNumber = cell(1);
    if (!externalSoNumber) return;
    rowIndexSeq += 1;
    const hasSiteValue = cell(6).toUpperCase();
    rows.push({
      row_index: rowIndexSeq,
      external_so_number: externalSoNumber,
      fo_number: cell(2),
      customer_gst: cell(3).toUpperCase(),
      customer_name: cell(4),
      customer_address: cell(5),
      has_site: hasSiteValue === "YES",
      has_site_valid: hasSiteValue === "YES" || hasSiteValue === "NO",
      sku: cell(7),
      pack_qty: Number(cell(8)) || 0,
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
        <span className="text-[10px] text-slate-500">Excel address: {raw?.customer_address || "—"}</span>
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
      <span className="text-[10px] text-slate-500">Excel address: {raw?.customer_address || "—"}</span>
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
  if (resolution.status === "SINGLE") {
    const candidate = resolution.candidates?.[0];
    return (
      <div className="flex items-center gap-2">
        <span className="text-emerald-800">{candidate?.site_name || "Site"}</span>
        {(resolution.all_candidates?.length ?? 0) > 1 ? <button type="button" onClick={() => onChangeSite(row.row_index)} className="text-[11px] font-semibold text-sky-700 underline">Change</button> : null}
        <button type="button" onClick={() => onAddSite(row.row_index, raw)} className="text-[11px] font-semibold text-sky-700 underline">Add</button>
      </div>
    );
  }
  if (resolution.status === "CHOOSE") {
    return (
      <div className="grid gap-1">
        <span className="text-[10px] text-slate-500">Excel address: {raw?.customer_address || "—"}</span>
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
  const [sameAsCustomer, setSameAsCustomer] = useState(true);
  const [siteName, setSiteName] = useState(raw?.customer_name || "");
  const [addressLine, setAddressLine] = useState(raw?.customer_address || "");
  const [town, setTown] = useState("");
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
      });
      const createdAddress = created?.data ?? created;
      if (createdAddress?.id) {
        await updateCustomerAddress({ id: createdAddress.id, depot_code_id: vdcId });
      }
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
  const fileInputRef = useRef(null);

  const createDrawerRow = useMemo(() => (rows ?? []).find((row) => row.row_index === createDrawerRowIndex), [rows, createDrawerRowIndex]);
  const addSiteRow = useMemo(() => (rows ?? []).find((row) => row.row_index === addSiteRowIndex), [rows, addSiteRowIndex]);

  function updateRow(rowIndex, patch) {
    setRows((current) => (current ?? []).map((row) => (row.row_index === rowIndex ? { ...row, ...patch } : row)));
  }
  function rowHasSite(row) {
    return row?.has_site === true || rawByIndex[row?.row_index]?.has_site === true;
  }
  function recalculateQtyStatuses(nextRows) {
    const totals = new Map();
    for (const row of nextRows) {
      const resolution = row.sku_resolution;
      if (row.status !== "RESOLVED" || resolution?.status !== "MATCHED" || !resolution.so_line_id) continue;
      const key = String(resolution.so_line_id);
      const entry = totals.get(key) ?? { lineTotal: Number(resolution.line_total_qty ?? 0), allocated: Number(resolution.existing_allocated_qty ?? 0), replacing: 0, requested: 0 };
      entry.replacing += Number(resolution.existing_group_qty ?? 0);
      entry.requested += Number(rawByIndex[row.row_index]?.pack_qty ?? 0);
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
    setRows((current) => (current ?? []).filter((row) => row.row_index !== rowIndex));
  }

  async function handleFileChosen(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(""); setNotice(""); setUploading(true);
    try {
      const parsedRows = await parseUploadedWorkbook(file);
      if (parsedRows.length === 0) { setError("The uploaded file has no data rows."); return; }
      const rawMap = {};
      parsedRows.forEach((row) => { rawMap[row.row_index] = row; });
      setRawByIndex(rawMap);
      const result = await previewSoMapBulkUpload({ company_id: companyId, rows: parsedRows });
      // fetchProcurement unwraps the standard `{ data: [...] }` envelope, so
      // preview responses arrive here as the array itself. Retain the nested
      // fallback for callers that return an unwrapped API payload.
      const previewRows = Array.isArray(result) ? result : result?.data;
      const resolvedPreviewRows = await autoCreateMissingGstCustomers(Array.isArray(previewRows) ? previewRows : [], rawMap);
      setRows(resolvedPreviewRows);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "SO_MAP_BULK_PREVIEW_FAILED");
    } finally {
      setUploading(false);
    }
  }

  // A GST that exists nowhere in MM04 is not a user-selection case. The
  // confirmed SO Map design creates the domestic customer and its first VDC
  // site automatically from the uploaded row, then reuses it within the
  // current batch. The no-GST path remains deliberately manual.
  async function autoCreateMissingGstCustomers(previewRows, rawMap) {
    const createdByVdcAndGst = new Map();
    const nextRows = [];
    for (const row of previewRows) {
      const raw = rawMap[row.row_index];
      if (row.status !== "RESOLVED" || !raw?.customer_gst || row.customer_resolution?.status !== "NOT_FOUND") {
        nextRows.push(row);
        continue;
      }
      const key = `${row.vdc_id}::${raw.customer_gst}`;
      try {
        let created = createdByVdcAndGst.get(key);
        if (!created) {
          if (!row.vdc_state) throw new Error("SO_MAP_VDC_STATE_REQUIRED");
          const profileResult = await lookupCustomerGstProfile(raw.customer_gst);
          const profile = profileResult?.data ?? profileResult;
          if (!profile?.full_address || !profile?.state_name) throw new Error("SO_MAP_GST_PROFILE_REQUIRED");
          const result = await createCustomer({
            company_id: companyId,
            customer_name: raw.customer_name,
            customer_type: "DOMESTIC",
            currency_code: "INR",
            // GST legal name is intentionally NOT used: it can be the
            // proprietor's personal name. The Excel consignee name remains
            // the customer name; Applyflow supplies address/state/pin only.
            delivery_address: profile.full_address,
            billing_state: profile.state_name,
            site_name: raw.customer_name,
            gst_number: raw.customer_gst,
            gst_category: "REGISTERED",
            pin_code: profile.pin_code || undefined,
          });
          const customer = result?.data ?? result;
          const addressResult = await listCustomerAddresses(customer.id);
          const addresses = Array.isArray(addressResult?.data) ? addressResult.data : (Array.isArray(addressResult) ? addressResult : []);
          const firstAddress = addresses[0];
          if (!firstAddress?.id) throw new Error("SO_MAP_GST_ADDRESS_CREATE_FAILED");
          await updateCustomerAddress({ id: firstAddress.id, depot_code_id: row.vdc_id, pin_code: profile.pin_code || undefined });
          created = { customer, firstAddress: { ...firstAddress, depot_code_id: row.vdc_id } };
          createdByVdcAndGst.set(key, created);
        }
        const siteResolution = raw.has_site
          ? { count: 1, status: "SINGLE", candidates: [created.firstAddress] }
          : null;
        nextRows.push({
          ...row,
          customer_resolution: {
            mode: "GST", status: "FOUND", customer_id: created.customer.id,
            customer_name: created.customer.customer_name || raw.customer_name,
            customer_address_id: created.firstAddress.id,
          },
          site_resolution: siteResolution,
        });
      } catch {
        nextRows.push({ ...row, customer_resolution: { mode: "GST", status: "AUTO_CREATE_FAILED" } });
      }
    }
    return nextRows;
  }

  // §6 point 9 dedup/reuse — once a customer is resolved for one row, every
  // OTHER row in this same batch with the exact same (Company + Address
  // Line) reuses it, no re-resolution needed.
  function applyDedup(sourceRowIndex, customerId, customerName, customerAddressId, siteResolution) {
    const sourceRaw = rawByIndex[sourceRowIndex];
    if (!sourceRaw) return;
    setRows((current) => (current ?? []).map((row) => {
      if (row.row_index === sourceRowIndex) return row;
      const otherRaw = rawByIndex[row.row_index];
      const sameAddress = otherRaw
        && otherRaw.customer_address?.trim().toLowerCase() === sourceRaw.customer_address?.trim().toLowerCase()
        && otherRaw.customer_address?.trim().length > 0;
      if (!sameAddress) return row;
      return {
        ...row,
        customer_resolution: { mode: row.customer_resolution?.mode, status: "FOUND", customer_id: customerId, customer_name: customerName, customer_address_id: customerAddressId },
        site_resolution: rowHasSite(row) ? siteResolution : row.site_resolution,
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
      const addrResult = await listCustomerAddresses(customer.id);
      const addresses = Array.isArray(addrResult?.data) ? addrResult.data : (Array.isArray(addrResult) ? addrResult : []);
      const firstAddress = addresses[0];
      if (firstAddress?.id) await updateCustomerAddress({ id: firstAddress.id, depot_code_id: vdcId });
      const siteResolution = firstAddress ? { count: 1, status: "SINGLE", candidates: [firstAddress] } : { count: 0, status: "NONE", candidates: [] };
      const targetRow = (rows ?? []).find((row) => row.row_index === rowIndex);
      updateRow(rowIndex, {
        customer_resolution: { status: "FOUND", customer_id: customer.id, customer_name: customer.customer_name, customer_address_id: firstAddress?.id },
        site_resolution: rowHasSite(targetRow) ? siteResolution : null,
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
      const sameAddress = rawByIndex[row.row_index]?.customer_address?.trim().toLowerCase()
        === sourceRaw?.customer_address?.trim().toLowerCase();
      return row.row_index === rowIndex || (sameCustomer && sameAddress && rowHasSite(row))
        ? { ...row, site_resolution: { count: 1, status: "SINGLE", candidates: [createdAddress] } }
        : row;
    }));
    setAddSiteRowIndex(null);
  }

  async function handleSaveAll() {
    setSaving(true); setError(""); setNotice("");
    let savedCount = 0;
    try {
      const groups = new Map();
      for (const row of rows ?? []) {
        if (row.duplicate_status === "UNCHANGED" || !isRowReady(row)) continue;
        const soLineId = row.sku_resolution?.so_line_id;
        if (!soLineId) continue;
        const siteId = row.site_resolution?.candidates?.[0]?.id || row.customer_resolution?.customer_address_id;
        if (!siteId) continue;
        const raw = rawByIndex[row.row_index];
        const key = `${row.so_id}::${raw?.fo_number || ""}`;
        const group = groups.get(key);
        if (group && String(group.customer_address_id) !== String(siteId)) {
          throw new Error("SO_MAP_FO_DESTINATION_MISMATCH: one FO must resolve to one customer and site address.");
        }
        const target = group ?? {
          so_id: row.so_id,
          source: "address",
          customer_address_id: siteId,
          external_fo_number: raw?.fo_number || undefined,
          items: [],
        };
        target.items.push({ so_line_id: soLineId, allocated_qty: raw?.pack_qty });
        groups.set(key, target);
      }
      for (const group of groups.values()) {
        await saveSoMapGroup(group);
        savedCount += group.items.length;
      }
      setNotice(`${savedCount} row(s) mapped.`);
      onSaved?.();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "SO_MAP_BULK_SAVE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  function isRowReady(row) {
    if (row.status !== "RESOLVED" || row.duplicate_status === "UNCHANGED") return row.duplicate_status === "UNCHANGED";
    if (row.duplicate_status === "CHANGED_QTY" && !row.change_confirmed) return false;
    if (row.sku_resolution?.status !== "MATCHED" || row.qty_status !== "OK" || !row.customer_resolution?.customer_id) return false;
    const addressId = row.site_resolution?.candidates?.[0]?.id || row.customer_resolution?.customer_address_id;
    return Boolean(addressId) && (!rowHasSite(row) || Boolean(row.site_resolution?.candidates?.[0]?.id));
  }
  const readyCount = (rows ?? []).filter((row) => row.duplicate_status !== "UNCHANGED" && isRowReady(row)).length;
  const blockingCount = (rows ?? []).filter((row) => row.duplicate_status !== "UNCHANGED" && !isRowReady(row)).length;

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
        </div>

        {rows ? (
          <>
            <ErpDenseGrid
              cellNavigate
              maxHeight="520px"
              columns={[
                { key: "so_number", label: "SO Number", width: "120px", render: (row) => row.so_number || "—" },
                { key: "fo_number", label: "FO Number", width: "120px", render: (row) => rawByIndex[row.row_index]?.fo_number || "—" },
                { key: "dd_flagged", label: "DD Flagged", width: "95px", render: (row) => row.status === "RESOLVED" ? <span className="text-emerald-800">{row.dd_flagged ? "Yes" : "No"}</span> : "—" },
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
                      : <span className="flex items-center gap-1 font-semibold text-amber-700">Changed from {row.previous_qty}<button type="button" onClick={() => updateRow(row.row_index, { change_confirmed: true })} className="border border-amber-500 bg-amber-50 px-1 text-[10px]">Confirm</button></span>;
                    return <span className="text-slate-400">—</span>;
                  },
                },
                {
                  key: "customer", label: "Customer", width: "280px", render: (row) => row.status === "RESOLVED" ? (
                    <CustomerResolutionCell
                      row={row}
                      raw={rawByIndex[row.row_index]}
                      onChoose={chooseCustomer}
                      onChange={(rowIndex) => updateRow(rowIndex, { customer_resolution: { ...row.customer_resolution, status: "AMBIGUOUS" } })}
                      onCreateNew={(rowIndex) => setCreateDrawerRowIndex(rowIndex)}
                    />
                  ) : <span className="text-slate-400">—</span>,
                },
                {
                  key: "site", label: "Site Address", width: "240px", render: (row) => (row.status === "RESOLVED" && rowHasSite(row)) ? (
                    <SiteResolutionCell
                      row={row}
                      raw={rawByIndex[row.row_index]}
                      onChooseSite={chooseSite}
                      onChangeSite={(rowIndex) => updateRow(rowIndex, { site_resolution: { ...row.site_resolution, status: "CHOOSE", candidates: row.site_resolution?.all_candidates ?? [] } })}
                      onAddSite={(rowIndex) => setAddSiteRowIndex(rowIndex)}
                    />
                  ) : <span className="text-slate-400">—</span>,
                },
                {
                  key: "actions", label: "", width: "70px", render: (row) => (
                    <button type="button" onClick={() => removeRow(row.row_index)} className="border border-rose-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-rose-700">Remove</button>
                  ),
                },
              ]}
              rows={rows}
              rowKey={(row) => row.row_index}
              emptyMessage="No rows."
            />
            {blockingCount ? <div className="text-xs font-semibold text-amber-800">Resolve, confirm, or remove {blockingCount} highlighted row(s) before saving.</div> : null}
            <button type="button" disabled={saving || readyCount === 0 || blockingCount > 0} onClick={() => void handleSaveAll()} className="border border-sky-700 bg-sky-100 px-4 py-2 text-sm font-semibold text-sky-950 disabled:opacity-50">
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
            initialSiteName={rawByIndex[createDrawerRow.row_index]?.customer_name || ""}
            initialPinCode=""
            initialGstNumber={rawByIndex[createDrawerRow.row_index]?.customer_gst || ""}
            initialGstCategory={rawByIndex[createDrawerRow.row_index]?.customer_gst ? "REGISTERED" : "UNREGISTERED"}
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
