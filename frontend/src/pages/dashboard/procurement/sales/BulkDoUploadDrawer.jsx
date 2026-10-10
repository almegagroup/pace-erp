/*
 * File-Path: frontend/src/pages/dashboard/procurement/sales/BulkDoUploadDrawer.jsx
 * Domain: PROCUREMENT / Sales
 * Purpose: "Bulk DO Upload" — additive to DOListPage.jsx (SO03), per
 *          FG-STO-MTS-DISPATCH-DESIGN-DOC.md §6 points 14-15. One template
 *          row-group (same FO/SO Number) = one Delivery Order. A VDC row
 *          carries an FO Number (resolved against the already-mapped SO Map
 *          allocation, §6 points 8-12); a DC row carries a plain SO Number
 *          (no Customer/Site resolution needed, §6 point 10's correction).
 *          Driven entirely by the new previewDoBulkUpload/saveDoBulkUpload
 *          endpoints, which themselves only ever call the EXISTING,
 *          unmodified createDeliveryOrderUnifiedHandler/saveSoMapGroupHandler
 *          — see do_bulk.handlers.ts's own header note.
 * Authority: Frontend
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DrawerBase from "../../../../components/layer/DrawerBase.jsx";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import { previewDoBulkUpload, saveDoBulkUpload } from "../procurementApi.js";

const TEMPLATE_HEADERS = [
  "FO/SO Number", "DO Date", "Transporter", "LR Number", "LR Date", "SKU",
  "Pack Qty", "Storage Location", "Tally Invoice Number", "Tally Invoice Date",
  "Inbound Number", "Truck Number", "Dispatch Date",
];

async function buildTemplateWorkbook() {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Bulk DO Upload");
  sheet.addRow(TEMPLATE_HEADERS);
  sheet.getRow(1).font = { bold: true };
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
  anchor.download = "bulk_do_upload_template.xlsx";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.URL.revokeObjectURL(url);
}

function toIsoDate(value) {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

// fetchProcurement unwraps the standard `{ data: [...] }` API envelope for
// collection responses.  Keep this tolerant of either shape so a valid
// preview can never be mistaken for an empty upload when the client wrapper
// evolves.
function responseRows(result) {
  if (Array.isArray(result)) return result;
  return Array.isArray(result?.data) ? result.data : [];
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
      if (typeof value === "object" && "result" in value) return String(value.result ?? "").trim();
      return value;
    };
    const foOrSoNumber = String(cell(1) ?? "").trim();
    if (!foOrSoNumber) return;
    rowIndexSeq += 1;
    rows.push({
      row_index: rowIndexSeq,
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

export default function BulkDoUploadDrawer({ companyId, onClose, onSaved, initialDraft = null, onDraftRestored, onOpenTransporterMaster }) {
  const [rows, setRows] = useState(null);
  const [rawByIndex, setRawByIndex] = useState({});
  const [uploading, setUploading] = useState(false);
  const [validating, setValidating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saveResults, setSaveResults] = useState(null);
  const fileInputRef = useRef(null);
  const restoredDraftRef = useRef(false);

  function updateRaw(rowIndex, patch) {
    setRawByIndex((current) => ({ ...current, [rowIndex]: { ...current[rowIndex], ...patch } }));
  }
  function removeRow(rowIndex) {
    setRows((current) => (current ?? []).filter((row) => row.row_index !== rowIndex));
  }

  const runPreview = useCallback(async (parsedRows) => {
    const result = await previewDoBulkUpload({ company_id: companyId, rows: parsedRows });
    setRows(responseRows(result));
  }, [companyId]);

  // Returning from Transporter Master must restore the exact upload, then
  // preview it again.  The newly-created master record is consequently
  // resolved through the same normal resolver as every other transporter.
  useEffect(() => {
    const restoredRows = initialDraft?.raw_rows;
    if (restoredDraftRef.current || !Array.isArray(restoredRows) || restoredRows.length === 0) return;
    restoredDraftRef.current = true;
    const rawMap = {};
    restoredRows.forEach((row) => { rawMap[row.row_index] = row; });
    setRawByIndex(rawMap);
    setUploading(true);
    setError("");
    void runPreview(restoredRows)
      .catch((restoreError) => setError(restoreError instanceof Error ? restoreError.message : "DO_BULK_PREVIEW_FAILED"))
      .finally(() => {
        setUploading(false);
        onDraftRestored?.();
      });
  }, [initialDraft, onDraftRestored, runPreview]);

  async function handleFileChosen(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(""); setNotice(""); setSaveResults(null); setUploading(true);
    try {
      const parsedRows = await parseUploadedWorkbook(file);
      if (parsedRows.length === 0) { setError("The uploaded file has no data rows."); return; }
      const rawMap = {};
      parsedRows.forEach((row) => { rawMap[row.row_index] = row; });
      setRawByIndex(rawMap);
      await runPreview(parsedRows);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "DO_BULK_PREVIEW_FAILED");
    } finally {
      setUploading(false);
    }
  }

  async function handleRevalidate() {
    if (!rows) return;
    setValidating(true); setError("");
    try {
      const parsedRows = rows.map((row) => rawByIndex[row.row_index]).filter(Boolean);
      await runPreview(parsedRows);
    } catch (validateError) {
      setError(validateError instanceof Error ? validateError.message : "DO_BULK_PREVIEW_FAILED");
    } finally {
      setValidating(false);
    }
  }

  function chooseSku(rowIndex, soLineId, allocationId) {
    setRows((current) => (current ?? []).map((row) => (row.row_index === rowIndex
      ? { ...row, sku_resolution: { status: "MATCHED", so_line_id: soLineId, so_map_allocation_id: allocationId ?? null } }
      : row)));
  }
  function chooseTransporter(rowIndex, transporterId) {
    setRows((current) => (current ?? []).map((row) => (row.row_index === rowIndex
      ? { ...row, transporter_resolution: { status: "MATCHED", transporter_id: transporterId } }
      : row)));
  }

  function openTransporterMaster(row) {
    const rawRows = Object.values(rawByIndex).sort((left, right) => Number(left.row_index) - Number(right.row_index));
    onOpenTransporterMaster?.({
      company_id: companyId,
      raw_rows: rawRows,
      pending_transporter_row_index: row.row_index,
      transporter_name: rawByIndex[row.row_index]?.transporter_name || "",
    });
  }

  // One Delivery Order per (fo_or_so_number) group — §6 point 14/17. Header
  // fields (DO Date/LR/Transporter/Truck/Dispatch/Tally) are repeated on
  // every row of the same group in the source Excel; the first row's raw
  // values are used as the group's header.
  const groups = useMemo(() => {
    const byKey = new Map();
    for (const row of rows ?? []) {
      if (row.status !== "RESOLVED") continue;
      const raw = rawByIndex[row.row_index] ?? {};
      const key = row.fo_or_so_number;
      if (!byKey.has(key)) byKey.set(key, { fo_or_so_number: key, dd_flag: row.dd_flag, so_id: row.so_id, raw, rows: [] });
      byKey.get(key).rows.push(row);
    }
    return [...byKey.values()];
  }, [rows, rawByIndex]);

  function groupReadiness(group) {
    const problems = [];
    const raw = group.raw;
    if (!raw.do_date) problems.push("DO Date");
    if (!raw.transporter_name) problems.push("Transporter");
    if (!raw.lr_number) problems.push("LR Number");
    if (!raw.lr_date) problems.push("LR Date");
    if (!group.dd_flag) {
      if (!raw.truck_number) problems.push("Truck Number (DC mandatory)");
      if (!raw.dispatch_date) problems.push("Dispatch Date (DC mandatory)");
    }
    for (const row of group.rows) {
      if (row.transporter_resolution?.status !== "MATCHED") problems.push(`Row ${row.row_index}: Transporter not resolved`);
      if (row.sku_resolution?.status !== "MATCHED") problems.push(`Row ${row.row_index}: SKU not resolved`);
      if (!row.storage_location?.id) problems.push(`Row ${row.row_index}: Storage Location not resolved`);
      if (row.qty_status === "EXCEEDS_BALANCE") problems.push(`Row ${row.row_index}: exceeds remaining balance`);
      if ((row.format_errors ?? []).length) problems.push(`Row ${row.row_index}: ${row.format_errors.join(", ")}`);
    }
    return problems;
  }

  async function handleSaveAll() {
    setSaving(true); setError(""); setNotice(""); setSaveResults(null);
    try {
      const payloadGroups = groups
        .filter((group) => groupReadiness(group).length === 0)
        .map((group) => {
          const first = group.rows[0];
          const raw = group.raw;
          return {
            fo_or_so_number: group.fo_or_so_number,
            dd_flag: group.dd_flag,
            so_id: group.so_id,
            do_date: raw.do_date || undefined,
            transporter_id: first.transporter_resolution?.transporter_id,
            lr_number: raw.lr_number,
            lr_date: raw.lr_date,
            truck_number: raw.truck_number || undefined,
            dispatch_date: raw.dispatch_date || undefined,
            tally_invoice_number: raw.tally_invoice_number || undefined,
            tally_invoice_date: raw.tally_invoice_date || undefined,
            inbound_number: raw.inbound_number || undefined,
            rows: group.rows.map((row) => ({
              so_line_id: row.sku_resolution.so_line_id,
              so_map_allocation_id: row.sku_resolution.so_map_allocation_id || undefined,
              base_qty: row.base_qty,
              storage_location_id: row.storage_location.id,
            })),
          };
        });
      if (payloadGroups.length === 0) { setError("No group is fully ready to save yet."); return; }
      const result = await saveDoBulkUpload({ company_id: companyId, groups: payloadGroups });
      const resultRows = responseRows(result);
      setSaveResults(resultRows);
      const createdCount = resultRows.filter((row) => row.status === "CREATED").length;
      setNotice(`${createdCount} of ${resultRows.length} Delivery Order(s) created.`);
      if (createdCount > 0) onSaved?.();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "DO_BULK_SAVE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  const readyGroupCount = groups.filter((group) => groupReadiness(group).length === 0).length;

  return (
    <DrawerBase
      visible
      title="Bulk DO Upload"
      onEscape={onClose}
      onClose={onClose}
      width="min(1300px, calc(100vw - 24px))"
      actions={
        <button type="button" onClick={onClose} className="border border-sky-700 bg-sky-100 px-4 py-2 text-sm font-semibold uppercase tracking-[0.06em] text-sky-950">Done</button>
      }
    >
      <div className="grid gap-3">
        {error ? <div className="border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-800">{error}</div> : null}
        {notice ? <div className="border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">{notice}</div> : null}
        <p className="text-xs text-slate-600">
          One column takes either an FO Number (VDC rows — resolved against this SO's already-mapped SO Map allocation) or a plain SO Number (DC rows — Customer/Site resolution not required). Each distinct FO/SO Number becomes one Delivery Order.
        </p>

        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void downloadTemplate()} className="border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">Download Template</button>
          <button type="button" disabled={uploading} onClick={() => fileInputRef.current?.click()} className="border border-sky-700 bg-sky-100 px-3 py-1.5 text-xs font-semibold text-sky-950 disabled:opacity-50">
            {uploading ? "Uploading…" : "Upload Excel"}
          </button>
          <input ref={fileInputRef} type="file" accept=".xlsx" className="hidden" onChange={(event) => void handleFileChosen(event)} />
          {rows ? (
            <button type="button" disabled={validating} onClick={() => void handleRevalidate()} className="border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-50">
              {validating ? "Re-checking…" : "Re-check Rows"}
            </button>
          ) : null}
        </div>

        {rows ? (
          <>
            <ErpDenseGrid
              cellNavigate
              maxHeight="520px"
              columns={[
                { key: "fo_or_so", label: "FO/SO Number", width: "130px", render: (row) => row.fo_or_so_number },
                { key: "dd_flag", label: "DD Flag", width: "80px", render: (row) => row.status === "RESOLVED" ? (row.dd_flag ? "Yes" : "No") : "—" },
                { key: "so_number", label: "SO Number", width: "120px", render: (row) => row.so_number || "—" },
                { key: "do_date", label: "DO Date", width: "115px", render: (row) => rawByIndex[row.row_index]?.do_date || "—" },
                {
                  key: "status", label: "Status", width: "180px", render: (row) => row.status === "ERROR"
                    ? <span className="font-semibold text-rose-700">{row.error_code}</span>
                    : <span className="text-emerald-800">Resolved</span>,
                },
                { key: "sku", label: "SKU", width: "90px", render: (row) => rawByIndex[row.row_index]?.sku || "—" },
                {
                  key: "sku_status", label: "SKU Resolve", width: "160px", render: (row) => {
                    if (row.status !== "RESOLVED") return <span className="text-slate-400">—</span>;
                    if (row.sku_resolution?.status === "MATCHED") return <span className="text-emerald-800">Matched</span>;
                    return (
                      <select className="h-7 border border-amber-400 bg-amber-50 px-1 text-[11px]" defaultValue=""
                        onChange={(event) => {
                          const candidate = (row.sku_resolution?.candidates ?? []).find((c) => String(c.so_line_id) === event.target.value);
                          chooseSku(row.row_index, event.target.value, candidate?.allocation_id);
                        }}>
                        <option value="">Choose item…</option>
                        {(row.sku_resolution?.candidates ?? []).map((candidate) => (
                          <option key={candidate.so_line_id ?? candidate.allocation_id} value={candidate.so_line_id}>{candidate.display}</option>
                        ))}
                      </select>
                    );
                  },
                },
                { key: "pack_qty", label: "Pack Qty", width: "90px", align: "right", render: (row) => rawByIndex[row.row_index]?.pack_qty ?? "—" },
                { key: "base_qty", label: "Base Qty", width: "90px", align: "right", render: (row) => (row.base_qty != null ? Number(row.base_qty).toFixed(4) : "—") },
                {
                  key: "qty_status", label: "Qty Check", width: "110px", render: (row) => row.qty_status === "EXCEEDS_BALANCE"
                    ? <span className="font-semibold text-rose-700">Exceeds balance</span>
                    : row.status === "RESOLVED" ? <span className="text-emerald-800">OK</span> : <span className="text-slate-400">—</span>,
                },
                {
                  key: "storage_location", label: "Storage Location", width: "200px", render: (row) => {
                    if (row.status !== "RESOLVED") return <span className="text-slate-400">—</span>;
                    const resolved = row.storage_location;
                    const options = row.storage_location_candidates ?? [];
                    return (
                      <div className="grid gap-1">
                        {resolved?.id ? (
                          <span className="text-emerald-800">{resolved.code} — {resolved.name}</span>
                        ) : (
                          <span className="font-semibold text-rose-700">Not found</span>
                        )}
                        <select
                          value={rawByIndex[row.row_index]?.storage_location_code || ""}
                          onChange={(event) => updateRaw(row.row_index, { storage_location_code: event.target.value })}
                          className="h-6 border border-slate-300 bg-[#fffef7] px-1 text-[11px]"
                        >
                          <option value="">Choose F-location…</option>
                          {options.map((option) => <option key={option.id} value={option.code}>{option.code} — {option.name}</option>)}
                        </select>
                      </div>
                    );
                  },
                },
                {
                  key: "transporter", label: "Transporter", width: "220px", render: (row) => {
                    if (row.status !== "RESOLVED") return <span className="text-slate-400">—</span>;
                    const resolution = row.transporter_resolution;
                    if (resolution?.status === "MATCHED") return <span className="text-emerald-800">Resolved</span>;
                    if (resolution?.status === "AMBIGUOUS") {
                      return (
                        <select className="h-7 border border-amber-400 bg-amber-50 px-1 text-[11px]" defaultValue=""
                          onChange={(event) => chooseTransporter(row.row_index, event.target.value)}>
                          <option value="">Choose from {resolution.candidates?.length ?? 0}…</option>
                          {(resolution.candidates ?? []).map((candidate) => (
                            <option key={candidate.id} value={candidate.id}>{candidate.transporter_code} — {candidate.transporter_name}</option>
                          ))}
                        </select>
                      );
                    }
                    return <button type="button" onClick={() => openTransporterMaster(row)} className="border border-sky-300 bg-sky-50 px-2 py-1 text-[11px] font-semibold text-sky-800">Not found — Open Transporter Master</button>;
                  },
                },
                { key: "lr_number", label: "LR Number", width: "135px", render: (row) => rawByIndex[row.row_index]?.lr_number || "—" },
                { key: "lr_date", label: "LR Date", width: "115px", render: (row) => rawByIndex[row.row_index]?.lr_date || "—" },
                { key: "truck_number", label: "Truck Number", width: "135px", render: (row) => rawByIndex[row.row_index]?.truck_number || "—" },
                { key: "dispatch_date", label: "Dispatch Date", width: "125px", render: (row) => rawByIndex[row.row_index]?.dispatch_date || "—" },
                {
                  key: "missing", label: "Missing", width: "180px", render: (row) => row.status === "RESOLVED" && (row.missing_required_fields ?? []).length > 0
                    ? <span className="font-semibold text-amber-700">{[...(row.missing_required_fields ?? []), ...(row.format_errors ?? [])].join(", ")}</span>
                    : (row.format_errors ?? []).length > 0
                      ? <span className="font-semibold text-rose-700">{row.format_errors.join(", ")}</span>
                    : <span className="text-slate-400">—</span>,
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

            <div>
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-600">Delivery Orders to be created ({groups.length} group(s))</h4>
              <ul className="grid gap-1 text-xs text-slate-700">
                {groups.map((group) => {
                  const problems = groupReadiness(group);
                  return (
                    <li key={group.fo_or_so_number} className={problems.length ? "text-rose-700" : "text-emerald-800"}>
                      {group.fo_or_so_number} ({group.dd_flag ? "VDC" : "DC"}, {group.rows.length} line(s)) — {problems.length ? `Not ready: ${problems.join("; ")}` : "Ready"}
                    </li>
                  );
                })}
              </ul>
            </div>

            <button type="button" disabled={saving || readyGroupCount === 0} onClick={() => void handleSaveAll()} className="border border-sky-700 bg-sky-100 px-4 py-2 text-sm font-semibold text-sky-950 disabled:opacity-50">
              {saving ? "Saving…" : `Create ${readyGroupCount} Delivery Order(s)`}
            </button>

            {saveResults ? (
              <ul className="grid gap-1 text-xs">
                {saveResults.map((result) => (
                  <li key={result.fo_or_so_number} className={result.status === "CREATED" ? "text-emerald-800" : "text-rose-700"}>
                    {result.fo_or_so_number}: {result.status === "CREATED" ? `Created (DO ${result.dc_id})` : result.error_code}
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : null}
      </div>
    </DrawerBase>
  );
}
