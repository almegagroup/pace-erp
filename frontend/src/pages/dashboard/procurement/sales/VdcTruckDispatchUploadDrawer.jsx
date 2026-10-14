/*
 * VDC (DD) Truck + Dispatch Date upload/review, §6 point 19.
 *
 * DD delivery orders only. The invoice already exists (SO02 posted it as
 * "Invoice only"); this drawer records the physical dispatch and posts the
 * deferred PGI. Upload guards, same family as the Bulk DO Upload:
 *   - FO Number (or DO Number when FO is blank) is the row key;
 *   - repeated FO rows: identical copies are ignored, differing copies block
 *     that FO;
 *   - an FO already dispatched keeps its posted Dispatch Date;
 *   - DOs not yet invoiced / not DD / cancelled / not found are listed with
 *     the reason and can be exported;
 *   - dates are accepted as Excel dates, DD-MM-YYYY, DD/MM/YYYY or ISO;
 *   - a DO missing Truck or Dispatch Date stays pending (invoice only).
 */
import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import DrawerBase from "../../../../components/layer/DrawerBase.jsx";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import { prioritizeUploadReviewRows } from "../../../../shared/uploadReviewRows.js";
import { checkVdcTruckDispatchUpload, listVdcTruckDispatchPending, postVdcTruckDispatch } from "../procurementApi.js";
import { toIsoDate } from "./bulkDoWorkbook.js";

const POST_CHUNK_SIZE = 25;
const TEMPLATE_HEADERS = ["DO Number", "FO Number", "SO Number", "Ship-To Address", "SKU", "Storage Location", "LR Date", "Truck Number", "Dispatch Date"];

const RESULT_LABEL = {
  DUPLICATE: "Duplicate (ignored)",
  CONFLICT: "Conflicting duplicate",
  ALREADY_DISPATCHED: "Already dispatched",
  NOT_INVOICED: "Invoice not made yet",
  NOT_DD: "Not a DD DO",
  CANCELLED: "Cancelled DO",
  NOT_FOUND: "Not found",
  INVALID: "Invalid value",
  INCOMPLETE: "Incomplete — stays pending",
  NO_KEY: "FO / DO Number blank",
};
const RESULT_TONE = {
  DUPLICATE: "text-amber-800",
  INCOMPLETE: "text-amber-800",
  ALREADY_DISPATCHED: "text-slate-700",
};

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { cell += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) { row.push(cell); cell = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += char;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const normalizeHeader = (value) => String(value ?? "").replace(/\u00a0/g, " ").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
const keyOf = (value) => String(value ?? "").trim().toUpperCase();
const cleanTruck = (value) => String(value ?? "").replace(/\s+/g, " ").trim().toUpperCase();

function cellValue(cell) {
  const value = cell?.value;
  if (value == null) return "";
  if (value instanceof Date) return value;
  if (typeof value === "object" && "text" in value) return String(value.text ?? "").trim();
  if (typeof value === "object" && "result" in value) return value.result ?? "";
  return value;
}

/** Read an .xlsx or .csv into [{ excel_row, dc_number, fo_number, truck_raw, date_raw }]. */
async function readUploadRows(file) {
  let table;
  if (/\.csv$/i.test(file.name)) {
    const parsed = parseCsv(await file.text());
    table = parsed.map((values, index) => ({ excelRow: index + 1, values }));
  } else {
    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await file.arrayBuffer());
    const sheet = workbook.worksheets[0];
    table = [];
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const values = [];
      for (let column = 1; column <= row.cellCount; column += 1) values.push(cellValue(row.getCell(column)));
      table.push({ excelRow: rowNumber, values });
    });
  }
  const header = (table.shift()?.values ?? []).map(normalizeHeader);
  const index = (name) => header.indexOf(normalizeHeader(name));
  const doIndex = index("DO Number");
  const foIndex = index("FO Number");
  const truckIndex = index("Truck Number");
  const dateIndex = index("Dispatch Date");
  if ((doIndex < 0 && foIndex < 0) || truckIndex < 0 || dateIndex < 0) {
    throw new Error("The file must have FO Number (or DO Number), Truck Number and Dispatch Date columns.");
  }
  return table
    .map(({ excelRow, values }) => ({
      excel_row: excelRow,
      dc_number: doIndex >= 0 ? String(values[doIndex] ?? "").trim() : "",
      fo_number: foIndex >= 0 ? String(values[foIndex] ?? "").trim() : "",
      truck_raw: values[truckIndex] ?? "",
      date_raw: values[dateIndex] ?? "",
    }))
    .filter((row) => row.dc_number || row.fo_number || String(row.truck_raw).trim() || String(row.date_raw).trim());
}

async function saveWorkbook(workbook, fileName) {
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

const todayIso = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};

export default function VdcTruckDispatchUploadDrawer({ companyId, onClose, onSaved }) {
  const [edits, setEdits] = useState({});
  const [posting, setPosting] = useState(false);
  const [reading, setReading] = useState(false);
  const [notice, setNotice] = useState("");
  const [uploadReport, setUploadReport] = useState(null);
  const [postFailures, setPostFailures] = useState([]);
  const fileInputRef = useRef(null);
  const query = useQuery({
    queryKey: ["procurement", "vdc-truck-dispatch", companyId],
    queryFn: () => listVdcTruckDispatchPending(companyId),
    enabled: Boolean(companyId),
  });
  const sourceRows = useMemo(() => Array.isArray(query.data?.items) ? query.data.items : [], [query.data]);
  const rows = useMemo(() => sourceRows.map((row) => ({
    ...row,
    truck_number: edits[row.dc_id]?.truck_number ?? row.truck_number ?? "",
    dispatch_date: edits[row.dc_id]?.dispatch_date ?? row.dispatch_date ?? "",
  })), [edits, sourceRows]);
  const reviewRows = useMemo(
    () => prioritizeUploadReviewRows(rows, (row) => !String(row.truck_number || "").trim() || !String(row.dispatch_date || "").trim()),
    [rows]
  );
  const dcNumberById = useMemo(() => new Map(sourceRows.map((row) => [row.dc_id, row.dc_number])), [sourceRows]);

  function setField(row, field, value) {
    // An FO is one physical dispatch event: an edit must follow every SKU/DO
    // row carrying that FO, not just the cell the user happened to change.
    const sameEvent = sourceRows.filter((candidate) => row.fo_number
      ? candidate.fo_number === row.fo_number
      : candidate.dc_id === row.dc_id);
    setEdits((current) => {
      const next = { ...current };
      for (const candidate of sameEvent) {
        next[candidate.dc_id] = { ...(next[candidate.dc_id] ?? {}), [field]: value };
      }
      return next;
    });
  }

  async function downloadTemplate() {
    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Truck Dispatch");
    sheet.addRow(TEMPLATE_HEADERS);
    for (const row of rows) {
      sheet.addRow([row.dc_number, row.fo_number ?? "", row.so_number ?? "", row.ship_to ?? "", row.sku ?? "", row.storage_location ?? "", row.lr_date ?? "", row.truck_number ?? "", row.dispatch_date ?? ""]);
    }
    sheet.getRow(1).font = { bold: true };
    sheet.columns.forEach((column) => { column.width = 20; });
    [8, 9].forEach((column) => { sheet.getRow(1).getCell(column).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } }; });
    await saveWorkbook(workbook, `vdc_truck_dispatch_pending_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  async function uploadFilledTemplate(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setReading(true); setNotice(""); setUploadReport(null); setPostFailures([]);
    try {
      const uploaded = await readUploadRows(file);
      const today = todayIso();
      const report = [];
      const candidates = [];
      for (const row of uploaded) {
        const key = row.fo_number ? `FO:${keyOf(row.fo_number)}` : row.dc_number ? `DO:${keyOf(row.dc_number)}` : "";
        const truck = cleanTruck(row.truck_raw);
        const rawDate = row.date_raw instanceof Date || typeof row.date_raw === "number" ? row.date_raw : String(row.date_raw ?? "").trim();
        const date = rawDate === "" ? "" : toIsoDate(rawDate);
        const base = { ...row, key, truck_number: truck, dispatch_date: date, label: row.fo_number || row.dc_number || "—" };
        if (!key) { report.push({ ...base, result: "NO_KEY", reason: "Give the FO Number (or the DO Number)." }); continue; }
        if (!truck && !date) continue; // nothing to load for this row
        const problems = [];
        if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) problems.push(`Dispatch Date "${String(row.date_raw)}" is not a date`);
        else if (date && date > today) problems.push("Dispatch Date is in the future");
        if (truck && truck.length < 4) problems.push("Truck Number must have at least 4 characters");
        if (problems.length) { report.push({ ...base, result: "INVALID", reason: problems.join("; ") }); continue; }
        candidates.push(base);
      }

      // Repeated FO / DO rows: identical copies are ignored; differing copies
      // block that key entirely (the user must decide which one is right).
      const byKey = new Map();
      for (const row of candidates) byKey.set(row.key, [...(byKey.get(row.key) ?? []), row]);
      const accepted = [];
      for (const group of byKey.values()) {
        const signatures = new Set(group.map((row) => `${row.truck_number}|${row.dispatch_date}`));
        if (signatures.size > 1) {
          for (const row of group) report.push({ ...row, result: "CONFLICT", reason: `Repeated with different Truck / Dispatch Date in Excel rows ${group.map((entry) => entry.excel_row).join(", ")} — keep one row.` });
          continue;
        }
        accepted.push(group[0]);
        for (const row of group.slice(1)) report.push({ ...row, result: "DUPLICATE", reason: `Same as Excel row ${group[0].excel_row}; ignored.` });
      }

      // Match against the pending (invoiced, not yet dispatched) DD rows.
      const pendingByFo = new Map();
      const pendingByDo = new Map();
      for (const row of sourceRows) {
        if (row.fo_number) pendingByFo.set(keyOf(row.fo_number), [...(pendingByFo.get(keyOf(row.fo_number)) ?? []), row]);
        pendingByDo.set(keyOf(row.dc_number), [...(pendingByDo.get(keyOf(row.dc_number)) ?? []), row]);
      }
      const nextEdits = {};
      const unmatched = [];
      let loadedKeys = 0;
      for (const row of accepted) {
        const matches = row.key.startsWith("FO:") ? pendingByFo.get(row.key.slice(3)) : pendingByDo.get(row.key.slice(3));
        if (!matches?.length) { unmatched.push(row); continue; }
        const beforeLr = matches.find((match) => row.dispatch_date && match.lr_date && row.dispatch_date < String(match.lr_date).slice(0, 10));
        if (beforeLr) { report.push({ ...row, result: "INVALID", reason: `Dispatch Date ${row.dispatch_date} is before LR Date ${beforeLr.lr_date}` }); continue; }
        loadedKeys += 1;
        for (const match of matches) {
          nextEdits[match.dc_id] = {
            ...(row.truck_number ? { truck_number: row.truck_number } : {}),
            ...(row.dispatch_date ? { dispatch_date: row.dispatch_date } : {}),
          };
        }
        if (!row.truck_number || !row.dispatch_date) {
          report.push({ ...row, result: "INCOMPLETE", reason: `${row.truck_number ? "Dispatch Date" : "Truck Number"} is missing — loaded, but this FO stays pending (invoice only) until both are given.` });
        }
      }

      // Explain every unmatched FO / DO instead of silently dropping it.
      if (unmatched.length) {
        const foNumbers = unmatched.filter((row) => row.key.startsWith("FO:")).map((row) => row.fo_number);
        const dcNumbers = unmatched.filter((row) => row.key.startsWith("DO:")).map((row) => row.dc_number);
        const check = await checkVdcTruckDispatchUpload(companyId, foNumbers, dcNumbers);
        const docsByKey = new Map();
        for (const entry of check?.fo_results ?? []) docsByKey.set(`FO:${keyOf(entry.fo_number)}`, entry.delivery_orders ?? []);
        for (const entry of check?.do_results ?? []) docsByKey.set(`DO:${keyOf(entry.dc_number)}`, entry.delivery_orders ?? []);
        for (const row of unmatched) {
          const docs = (docsByKey.get(row.key) ?? []).filter((doc) => doc.status !== "CANCELLED" || (docsByKey.get(row.key) ?? []).every((other) => other.status === "CANCELLED"));
          const dd = docs.filter((doc) => doc.dd_flag);
          const label = (list) => list.map((doc) => `DO ${doc.dc_number}`).join(", ");
          if (!docs.length) report.push({ ...row, result: "NOT_FOUND", reason: "No Delivery Order found for this number in this company." });
          else if (docs.every((doc) => doc.status === "CANCELLED")) report.push({ ...row, result: "CANCELLED", reason: `${label(docs)} is cancelled.` });
          else if (!dd.length) report.push({ ...row, result: "NOT_DD", reason: `${label(docs)} is not a DD delivery order; Truck & Dispatch upload is only for DD.` });
          else if (dd.some((doc) => doc.status === "DISPATCHED")) {
            const dispatched = dd.filter((doc) => doc.status === "DISPATCHED");
            report.push({ ...row, result: "ALREADY_DISPATCHED", reason: `${dispatched.map((doc) => `DO ${doc.dc_number} dispatched on ${doc.dispatch_date || "—"}${doc.truck_number ? ` (${doc.truck_number})` : ""}`).join(", ")} — the posted Dispatch Date is not changed.` });
          } else if (dd.some((doc) => doc.status === "CREATED")) report.push({ ...row, result: "NOT_INVOICED", reason: `${label(dd)}: invoice not made yet — post it in SO02 Bulk Posting first (or correct Truck / Dispatch Date there).` });
          else report.push({ ...row, result: "NOT_FOUND", reason: `${label(docs)} is not waiting for Truck & Dispatch.` });
        }
      }

      setEdits((current) => {
        const next = { ...current };
        for (const [dcId, patch] of Object.entries(nextEdits)) next[dcId] = { ...(next[dcId] ?? {}), ...patch };
        return next;
      });
      report.sort((left, right) => left.excel_row - right.excel_row);
      setUploadReport({ fileName: file.name, loadedKeys, rows: report });
      setNotice(loadedKeys
        ? `Loaded Truck / Dispatch Date for ${loadedKeys} FO / DO. Review, then Post PGI.`
        : "Nothing from this file could be loaded — see the reasons below.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "TRUCK_DISPATCH_TEMPLATE_UPLOAD_FAILED");
    } finally {
      setReading(false);
    }
  }

  async function exportNotLoaded() {
    if (!uploadReport?.rows.length) return;
    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Not loaded");
    sheet.addRow(["Excel Row", "DO Number", "FO Number", "Truck Number", "Dispatch Date", "Result", "Reason"]);
    for (const row of uploadReport.rows) {
      sheet.addRow([row.excel_row, row.dc_number, row.fo_number, row.truck_number, row.dispatch_date || String(row.date_raw ?? ""), RESULT_LABEL[row.result] ?? row.result, row.reason]);
    }
    sheet.getRow(1).font = { bold: true };
    sheet.columns.forEach((column) => { column.width = 22; });
    sheet.getColumn(7).width = 90;
    await saveWorkbook(workbook, `vdc_truck_dispatch_not_loaded_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  async function post() {
    const byDcId = new Map();
    for (const row of rows) {
      if (String(row.truck_number || "").trim() && String(row.dispatch_date || "").trim()) {
        byDcId.set(row.dc_id, { dc_id: row.dc_id, truck_number: row.truck_number, dispatch_date: row.dispatch_date });
      }
    }
    if (!byDcId.size) { setNotice("Enter both Truck Number and Dispatch Date for at least one pending FO before posting."); return; }
    setPosting(true); setNotice(""); setPostFailures([]);
    const payload = [...byDcId.values()];
    const outcomes = [];
    try {
      // Small batches keep each request short; one batch failing does not
      // lose the result of the batches already posted.
      for (let index = 0; index < payload.length; index += POST_CHUNK_SIZE) {
        const result = await postVdcTruckDispatch(payload.slice(index, index + POST_CHUNK_SIZE));
        outcomes.push(...(Array.isArray(result?.results) ? result.results : []));
        setNotice(`Posting… ${Math.min(index + POST_CHUNK_SIZE, payload.length)} of ${payload.length}`);
      }
    } catch (error) {
      setNotice(`${outcomes.filter((row) => row.ok).length} posted before an error: ${error instanceof Error ? error.message : "VDC_UPLOAD_POST_FAILED"}. Refresh and post the rest again.`);
      setPosting(false);
      await query.refetch(); onSaved?.();
      return;
    }
    const failed = outcomes.filter((row) => !row.ok);
    setPostFailures(failed.map((row) => ({ ...row, dc_number: dcNumberById.get(row.dc_id) || row.dc_id })));
    setNotice(failed.length ? `${outcomes.length - failed.length} posted; ${failed.length} remain pending — see the reasons below.` : `${outcomes.length} DD delivery order(s) posted.`);
    setPosting(false);
    await query.refetch(); onSaved?.();
  }

  const reportCounts = useMemo(() => {
    const counts = {};
    for (const row of uploadReport?.rows ?? []) counts[row.result] = (counts[row.result] ?? 0) + 1;
    return counts;
  }, [uploadReport]);

  return <DrawerBase visible title="Truck and Dispatch Date Upload — DD" onEscape={onClose} onClose={onClose} width="min(1480px, calc(100vw - 24px))"
    actions={<div className="flex gap-2"><button type="button" onClick={() => void downloadTemplate()} disabled={!rows.length} className="border border-slate-300 bg-white px-3 py-2 text-xs font-semibold disabled:opacity-50">Download Prefilled Template</button><button type="button" onClick={() => fileInputRef.current?.click()} disabled={reading || !companyId} className="border border-slate-300 bg-white px-3 py-2 text-xs font-semibold disabled:opacity-50">{reading ? "Reading…" : "Upload Filled Template"}</button><input ref={fileInputRef} type="file" accept=".xlsx,.csv,text/csv" className="hidden" onChange={(event) => void uploadFilledTemplate(event)} /><button type="button" onClick={() => void post()} disabled={posting || !rows.length} className="border border-sky-700 bg-sky-100 px-3 py-2 text-xs font-semibold text-sky-950 disabled:opacity-50">{posting ? "Posting…" : "Post PGI"}</button><button type="button" onClick={onClose} className="border border-slate-300 bg-white px-3 py-2 text-xs font-semibold">Close</button></div>}>
    <div className="grid gap-3">
      <p className="text-xs text-slate-600">Only DD delivery orders whose invoice is made and PGI is still pending appear here. A DO without both Truck Number and Dispatch Date stays pending (invoice only). A value entered for one FO row is applied to every row of that FO. An FO already dispatched keeps its posted Dispatch Date. Dates can be Excel dates, DD-MM-YYYY, DD/MM/YYYY or YYYY-MM-DD.</p>
      {query.error ? <p className="border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-800">{query.error instanceof Error ? query.error.message : "VDC_UPLOAD_PENDING_FAILED"}</p> : null}
      {notice ? <p className={`border px-3 py-2 text-xs font-semibold ${/remain pending|FAILED|could not|error|must have/i.test(notice) ? "border-amber-300 bg-amber-50 text-amber-900" : "border-emerald-300 bg-emerald-50 text-emerald-800"}`}>{notice}</p> : null}
      {uploadReport?.rows.length ? (
        <div className="grid gap-2 border border-amber-300 bg-amber-50 px-3 py-2 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-semibold text-slate-800">Rows from {uploadReport.fileName} not loaded / needing attention:</span>
            {Object.entries(reportCounts).map(([result, count]) => <span key={result} className={RESULT_TONE[result] ?? "font-semibold text-rose-700"}>{count} {RESULT_LABEL[result] ?? result}</span>)}
            <button type="button" onClick={() => void exportNotLoaded()} className="border border-emerald-600 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-900">Export Excel</button>
            <button type="button" onClick={() => setUploadReport(null)} className="border border-slate-300 bg-white px-2 py-0.5 text-xs font-semibold">Hide</button>
          </div>
          <ErpDenseGrid rows={uploadReport.rows} rowKey={(row) => `${row.excel_row}-${row.result}`}
            columns={[
              { key: "excel_row", label: "Excel Row", width: "80px" },
              { key: "label", label: "FO / DO Number", width: "150px" },
              { key: "truck_number", label: "Truck", width: "120px", render: (row) => row.truck_number || "—" },
              { key: "dispatch_date", label: "Dispatch Date", width: "120px", render: (row) => row.dispatch_date || String(row.date_raw ?? "") || "—" },
              { key: "result", label: "Result", width: "170px", render: (row) => <span className={RESULT_TONE[row.result] ?? "font-semibold text-rose-700"}>{RESULT_LABEL[row.result] ?? row.result}</span> },
              { key: "reason", label: "Reason", width: "640px" },
            ]} />
        </div>
      ) : null}
      {postFailures.length ? (
        <div className="grid gap-1 border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          <span className="font-semibold">Not posted (still pending):</span>
          {postFailures.map((row) => <span key={row.dc_id}>DO {row.dc_number}: {row.message || row.code}</span>)}
        </div>
      ) : null}
      <ErpDenseGrid cellNavigate rows={reviewRows} rowKey={(row) => `${row.dc_id}-${row.storage_location_id}-${row.sku}`} emptyMessage={query.isLoading ? "Loading pending DD rows…" : "No pending DD Invoice-only rows."}
        columns={[
          { key: "dc_number", label: "DO Number", width: "120px", render: (row) => row.dc_number || "—" },
          { key: "fo_number", label: "FO Number", width: "145px", render: (row) => row.fo_number || "—" },
          { key: "ship_to", label: "Ship-To Address", width: "220px", render: (row) => row.ship_to || "—" },
          { key: "sku", label: "SKU", width: "190px", render: (row) => row.sku || "—" },
          { key: "storage_location", label: "Storage Location", width: "165px", render: (row) => row.storage_location || "—" },
          { key: "lr_date", label: "LR Date", width: "115px", render: (row) => row.lr_date || "—" },
          { key: "truck_number", label: "Truck Number", width: "160px", render: (row) => <input aria-label={`Truck Number ${row.dc_number}`} value={row.truck_number} onChange={(event) => setField(row, "truck_number", event.target.value)} className="h-7 w-full border border-slate-300 bg-white px-2 text-xs" /> },
          { key: "dispatch_date", label: "Dispatch Date", width: "160px", render: (row) => <input aria-label={`Dispatch Date ${row.dc_number}`} type="date" value={row.dispatch_date} onChange={(event) => setField(row, "dispatch_date", event.target.value)} className="h-7 w-full border border-slate-300 bg-white px-2 text-xs" /> },
        ]} />
    </div>
  </DrawerBase>;
}
