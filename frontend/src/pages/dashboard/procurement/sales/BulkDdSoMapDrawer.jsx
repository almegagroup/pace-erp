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
import { listCustomerAddresses, createCustomerAddress, updateCustomerAddress } from "../../om/omApi.js";
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
    rows.push({
      row_index: rowIndexSeq,
      external_so_number: externalSoNumber,
      fo_number: cell(2),
      customer_gst: cell(3).toUpperCase(),
      customer_name: cell(4),
      customer_address: cell(5),
      has_site: cell(6).toUpperCase() === "YES",
      sku: cell(7),
      pack_qty: Number(cell(8)) || 0,
    });
  });
  return rows;
}

function CustomerResolutionCell({ row, raw, onChoose, onCreateNew }) {
  const resolution = row.customer_resolution;
  if (!resolution) return <span className="text-slate-400">—</span>;
  if (resolution.status === "FOUND" || resolution.status === "MATCHED") {
    return <span className="text-emerald-800">{resolution.customer_name || "Resolved"}</span>;
  }
  if (resolution.status === "FOUND_DIFFERENT_VDC") {
    return <span className="font-semibold text-rose-700">GST matched but in Different VDC — fix GST or remove row</span>;
  }
  if (resolution.status === "AMBIGUOUS") {
    return (
      <div className="grid gap-1">
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
    <button type="button" onClick={() => onCreateNew(row.row_index, raw)} className="border border-sky-700 bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-950">
      Not in database — Create
    </button>
  );
}

function SiteResolutionCell({ row, raw, onChooseSite, onAddSite }) {
  const resolution = row.site_resolution;
  if (!resolution) return <span className="text-slate-400">—</span>;
  if (resolution.status === "PENDING_CUSTOMER") return <span className="text-slate-400">Resolve customer first</span>;
  if (resolution.status === "SINGLE") {
    const candidate = resolution.candidates?.[0];
    return (
      <div className="flex items-center gap-2">
        <span className="text-emerald-800">{candidate?.site_name || "Site"}</span>
        <button type="button" onClick={() => onAddSite(row.row_index, raw)} className="text-[11px] font-semibold text-sky-700 underline">Add</button>
      </div>
    );
  }
  if (resolution.status === "CHOOSE") {
    return (
      <div className="grid gap-1">
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
      setRows(Array.isArray(previewRows) ? previewRows : []);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "SO_MAP_BULK_PREVIEW_FAILED");
    } finally {
      setUploading(false);
    }
  }

  // §6 point 9 dedup/reuse — once a customer is resolved for one row, every
  // OTHER row in this same batch with the exact same (Company + Address
  // Line) reuses it, no re-resolution needed.
  function applyDedup(sourceRowIndex, customerId, customerName, siteResolution) {
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
        customer_resolution: { mode: row.customer_resolution?.mode, status: "FOUND", customer_id: customerId, customer_name: customerName },
        site_resolution: row.has_site ? siteResolution : row.site_resolution,
      };
    }));
  }

  function chooseCustomer(rowIndex, customerId, candidates) {
    const candidate = (candidates ?? []).find((entry) => String(entry.customer_id) === String(customerId));
    const customerName = candidate?.customer_name || "Customer";
    const siteResolution = candidate?.customer_address_id
      ? { count: 1, status: "SINGLE", candidates: [{ id: candidate.customer_address_id, site_name: candidate.site_name, address_line: candidate.address_line, town: candidate.town }] }
      : { count: 0, status: "NONE", candidates: [] };
    updateRow(rowIndex, {
      customer_resolution: { status: "FOUND", customer_id: customerId, customer_name: customerName },
      site_resolution: (rows ?? []).find((row) => row.row_index === rowIndex)?.has_site ?? false ? siteResolution : null,
    });
    applyDedup(rowIndex, customerId, customerName, siteResolution);
  }

  function chooseSite(rowIndex, siteId, candidates) {
    const candidate = (candidates ?? []).find((entry) => String(entry.id) === String(siteId));
    updateRow(rowIndex, { site_resolution: { count: 1, status: "SINGLE", candidates: [candidate] } });
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
        customer_resolution: { status: "FOUND", customer_id: customer.id, customer_name: customer.customer_name },
        site_resolution: targetRow?.has_site ? siteResolution : null,
      });
      applyDedup(rowIndex, customer.id, customer.customer_name, siteResolution);
    } catch (chainError) {
      setError(chainError instanceof Error ? chainError.message : "SO_MAP_BULK_VDC_MAP_FAILED");
    } finally {
      setCreateDrawerRowIndex(null);
    }
  }

  function handleSiteAdded(rowIndex, createdAddress) {
    updateRow(rowIndex, { site_resolution: { count: 1, status: "SINGLE", candidates: [createdAddress] } });
    setAddSiteRowIndex(null);
  }

  async function handleSaveAll() {
    setSaving(true); setError(""); setNotice("");
    let savedCount = 0;
    try {
      for (const row of rows ?? []) {
        if (row.status !== "RESOLVED") continue;
        if (row.duplicate_status === "UNCHANGED") continue;
        const customerId = row.customer_resolution?.customer_id;
        if (!customerId) continue;
        const soLineId = row.sku_resolution?.so_line_id;
        if (!soLineId) continue;
        const siteId = row.site_resolution?.candidates?.[0]?.id;
        if (row.has_site && !siteId) continue;
        const raw = rawByIndex[row.row_index];
        await saveSoMapGroup({
          so_id: row.so_id,
          source: "address",
          customer_address_id: siteId || undefined,
          external_fo_number: raw?.fo_number || undefined,
          items: [{ so_line_id: soLineId, allocated_qty: raw?.pack_qty }],
        });
        savedCount += 1;
      }
      setNotice(`${savedCount} row(s) mapped.`);
      onSaved?.();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "SO_MAP_BULK_SAVE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  const readyCount = (rows ?? []).filter((row) => row.status === "RESOLVED" && row.customer_resolution?.customer_id && row.duplicate_status !== "UNCHANGED").length;

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
                { key: "sku", label: "SKU", width: "90px", render: (row) => rawByIndex[row.row_index]?.sku || "—" },
                {
                  key: "sku_status", label: "SKU Resolve", width: "160px", render: (row) => {
                    if (row.status !== "RESOLVED") return <span className="text-rose-700">{row.error_code}</span>;
                    if (row.sku_resolution?.status === "MATCHED") return <span className="text-emerald-800">Matched</span>;
                    return (
                      <select className="h-7 border border-amber-400 bg-amber-50 px-1 text-[11px]" defaultValue=""
                        onChange={(event) => updateRow(row.row_index, { sku_resolution: { status: "MATCHED", so_line_id: event.target.value } })}>
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
                    if (row.duplicate_status === "CHANGED_QTY") return <span className="font-semibold text-amber-700">Changed from {row.previous_qty}</span>;
                    return <span className="text-slate-400">—</span>;
                  },
                },
                {
                  key: "customer", label: "Customer", width: "280px", render: (row) => row.status === "RESOLVED" ? (
                    <CustomerResolutionCell
                      row={row}
                      raw={rawByIndex[row.row_index]}
                      onChoose={chooseCustomer}
                      onCreateNew={(rowIndex) => setCreateDrawerRowIndex(rowIndex)}
                    />
                  ) : <span className="text-slate-400">—</span>,
                },
                {
                  key: "site", label: "Site Address", width: "240px", render: (row) => (row.status === "RESOLVED" && row.has_site) ? (
                    <SiteResolutionCell
                      row={row}
                      raw={rawByIndex[row.row_index]}
                      onChooseSite={chooseSite}
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
            initialSiteName={rawByIndex[createDrawerRow.row_index]?.customer_name || ""}
            initialGstCategory="UNREGISTERED"
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
