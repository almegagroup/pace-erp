import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpMasterListTemplate from "../../../../components/templates/ErpMasterListTemplate.jsx";
import TransactionCompanySelector from "../../../../components/inputs/TransactionCompanySelector.jsx";
import QuickFilterInput from "../../../../components/inputs/QuickFilterInput.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../../components/inputs/transactionCompanyRuntime.js";
import { useMenu } from "../../../../context/useMenu.js";
import { bulkPostDeliveryOrders, listBulkPostingQueue } from "../procurementApi.js";
import { popScreen } from "../../../../navigation/screenStackEngine.js";
import { TEMPLATE_HEADERS, parseUploadedWorkbook } from "./bulkDoWorkbook.js";

const MAX_DOS_PER_POST = 100;

// The fields a Bulk DO Upload row carries, in the upload template's own
// order, so the queue can be checked against the sheet the user uploaded.
const COMPARE_FIELDS = [
  { key: "do_date", label: "DO Date", system: (row) => row.dc_date, kind: "date" },
  { key: "transporter_name", label: "Transporter", system: (row) => row.transporter, kind: "contains" },
  { key: "lr_number", label: "LR Number", system: (row) => row.lr_number },
  { key: "lr_date", label: "LR Date", system: (row) => row.lr_date, kind: "date" },
  { key: "pack_qty", label: "Pack Qty", system: (row) => row.pack_qty, kind: "number" },
  { key: "storage_location_code", label: "Storage Location", system: (row) => row.storage_location_code },
  { key: "tally_invoice_number", label: "Tally Invoice Number", system: (row) => row.pre_invoice_tally_invoice_number },
  { key: "tally_invoice_date", label: "Tally Invoice Date", system: (row) => row.pre_invoice_tally_invoice_date, kind: "date" },
  { key: "inbound_number", label: "Inbound Number", system: (row) => row.pre_invoice_inbound_number },
  { key: "truck_number", label: "Truck Number", system: (row) => row.vehicle_number },
  { key: "dispatch_date", label: "Dispatch Date", system: (row) => row.dispatch_date, kind: "date" },
];

const norm = (value) => String(value ?? "").replace(/\s+/g, " ").trim().toUpperCase();
const keyOf = (source, sku) => `${norm(source)}::${norm(sku)}`;

function sameValue(field, excelValue, systemValue) {
  if (field.kind === "number") return Math.abs((Number(excelValue) || 0) - (Number(systemValue) || 0)) < 0.0001;
  if (field.kind === "date") return String(excelValue ?? "").slice(0, 10) === String(systemValue ?? "").slice(0, 10);
  if (field.kind === "contains") {
    const excel = norm(excelValue);
    return excel === "" ? norm(systemValue) === "" : norm(systemValue).includes(excel);
  }
  return norm(excelValue) === norm(systemValue);
}

// Every uploaded row is matched to the queue by FO/SO Number + SKU code;
// every queue line no sheet row claims is reported too.
function compareWithQueue(excelRows, queueRows) {
  const queueByKey = new Map();
  for (const row of queueRows) {
    for (const source of [row.fo_number, row.so_number]) {
      if (source && row.sku_code) queueByKey.set(keyOf(source, row.sku_code), row);
    }
  }
  const claimed = new Set();
  const results = excelRows.map((excel) => {
    const match = queueByKey.get(keyOf(excel.fo_or_so_number, excel.sku));
    if (!match) {
      return { result_key: `x-${excel.excel_row}`, status: "NOT_IN_QUEUE", excel_row: excel.excel_row, fo_or_so_number: excel.fo_or_so_number, sku: excel.sku, pack_qty: excel.pack_qty, tally_invoice_number: excel.tally_invoice_number, differences: "Not in the Bulk Posting queue — already posted, cancelled, never created, or FO/SKU typed differently" };
    }
    claimed.add(`${match.id}-${match.line_number}`);
    const differences = COMPARE_FIELDS
      .filter((field) => !sameValue(field, excel[field.key], field.system(match)))
      .map((field) => `${field.label}: Excel "${excel[field.key] ?? ""}" / System "${field.system(match) ?? ""}"`);
    return {
      result_key: `x-${excel.excel_row}`, status: differences.length ? "DIFFERENT" : "MATCHED", excel_row: excel.excel_row,
      fo_or_so_number: excel.fo_or_so_number, sku: excel.sku, pack_qty: excel.pack_qty, tally_invoice_number: excel.tally_invoice_number,
      dc_id: match.id, dc_number: match.dc_number, document_name: match.document_name, differences: differences.join(" | "),
    };
  });
  for (const row of queueRows) {
    if (claimed.has(`${row.id}-${row.line_number}`)) continue;
    results.push({
      result_key: `q-${row.id}-${row.line_number}`, status: "ONLY_IN_SYSTEM", excel_row: null, fo_or_so_number: row.fo_number || row.so_number,
      sku: row.sku_code, pack_qty: row.pack_qty, tally_invoice_number: row.pre_invoice_tally_invoice_number,
      dc_id: row.id, dc_number: row.dc_number, document_name: row.document_name, differences: "In the queue but not in this Excel",
    });
  }
  return results;
}

const CHECK_LABEL = {
  TALLY_INVOICE_REUSED: "Tally Invoice used twice",
  TALLY_INVOICE_MISSING: "Tally Invoice blank",
  LR_REUSED: "LR used twice",
  IBN_REUSED: "IBN used twice",
  INVOICE_DATE_NOT_DO_DATE: "Invoice Date ≠ DO Date",
  LR_BEFORE_DO: "LR before DO",
  DISPATCH_BEFORE_LR: "Dispatch before LR",
  TRUCK_TWO_TRANSPORTERS: "Truck under 2 transporters",
  INVOICE_PREFIX_UNUSUAL: "Unusual invoice series",
  INVOICE_OUT_OF_ORDER: "Invoice no. out of date order",
  QTY_UNUSUAL: "Unusual Pack Qty",
};

const STATUS_LABEL = { MATCHED: "Matched", DIFFERENT: "Different", NOT_IN_QUEUE: "Not in queue", ONLY_IN_SYSTEM: "Only in system" };
const STATUS_TONE = { MATCHED: "text-emerald-800", DIFFERENT: "font-semibold text-rose-700", NOT_IN_QUEUE: "font-semibold text-amber-700", ONLY_IN_SYSTEM: "font-semibold text-amber-700" };

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

// Queue exported in the Bulk DO Upload template's own columns first, so it
// can be laid next to the original sheet; system-only details follow.
async function exportQueue(rows) {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Bulk Posting Queue");
  sheet.addRow([...TEMPLATE_HEADERS, "DO Number", "SO Number", "Document Name", "Base Qty", "SO02 Action", "Rate", "Value", "Bill To", "Ship To", "Checks"]);
  for (const row of rows) {
    sheet.addRow([
      row.fo_number || row.so_number, row.dc_date, row.transporter, row.lr_number, row.lr_date, row.sku_code,
      Number(row.pack_qty ?? 0), row.storage_location_code, row.pre_invoice_tally_invoice_number, row.pre_invoice_tally_invoice_date,
      row.pre_invoice_inbound_number, row.vehicle_number, row.dispatch_date,
      row.dc_number, row.so_number, row.document_name, Number(row.base_qty ?? 0), row.posting_action, Number(row.rate ?? 0), Number(row.value ?? 0), row.bill_to, row.ship_to,
      (row.checks ?? []).map((check) => check.message).join(" | "),
    ]);
  }
  sheet.getRow(1).font = { bold: true };
  sheet.columns.forEach((column) => { column.width = 20; });
  await saveWorkbook(workbook, `so02_bulk_posting_queue_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

async function exportComparison(results) {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Excel vs System");
  sheet.addRow(["Result", "Excel Row No.", "FO/SO Number", "SKU", "Pack Qty", "Tally Invoice Number", "DO Number", "Document Name", "Differences"]);
  for (const row of results) {
    sheet.addRow([STATUS_LABEL[row.status], row.excel_row ?? "", row.fo_or_so_number, row.sku, Number(row.pack_qty ?? 0), row.tally_invoice_number, row.dc_number ?? "", row.document_name ?? "", row.differences]);
  }
  sheet.getRow(1).font = { bold: true };
  sheet.columns.forEach((column) => { column.width = 20; });
  sheet.getColumn(9).width = 90;
  await saveWorkbook(workbook, `so02_bulk_posting_check_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export default function SO02BulkPostingPage() {
  const { runtimeContext } = useMenu();
  const [companyId, setCompanyId] = useState("");
  const [selected, setSelected] = useState(() => new Set());
  const [posting, setPosting] = useState(false);
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [comparison, setComparison] = useState(null);
  const [checkFilter, setCheckFilter] = useState("");
  const [showAllComparison, setShowAllComparison] = useState(false);
  const compareInputRef = useRef(null);
  const effectiveCompanyId = companyId || resolveDefaultTransactionCompanyId(runtimeContext);
  const query = useQuery({ queryKey: ["so02-bulk-posting", effectiveCompanyId], queryFn: () => listBulkPostingQueue(effectiveCompanyId), enabled: Boolean(effectiveCompanyId) });
  const rows = useMemo(() => Array.isArray(query.data?.items) ? query.data.items : [], [query.data]);
  // Suspicious-data checks come per DO from the server; a DO is "flagged"
  // when any check fired for it.
  const checkSummary = useMemo(() => {
    const byCode = new Map();
    const flaggedDoIds = new Set();
    const seen = new Set();
    for (const row of rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      for (const check of row.checks ?? []) {
        flaggedDoIds.add(row.id);
        byCode.set(check.code, (byCode.get(check.code) ?? new Set()).add(row.id));
      }
    }
    const cleanDoIds = [...seen].filter((id) => !flaggedDoIds.has(id));
    return { byCode, flaggedDoIds, cleanDoIds };
  }, [rows]);
  const visibleRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const byCheck = checkFilter
      ? rows.filter((row) => (checkFilter === "ANY" ? checkSummary.flaggedDoIds.has(row.id) : (checkSummary.byCode.get(checkFilter)?.has(row.id))))
      : rows;
    if (!needle) return byCheck;
    return byCheck.filter((row) => [row.dc_number, row.fo_number, row.so_number, row.external_so_number, row.sku_code, row.document_name, row.pre_invoice_tally_invoice_number, row.pre_invoice_inbound_number, row.lr_number, row.vehicle_number, row.transporter]
      .some((value) => String(value ?? "").toLowerCase().includes(needle)));
  }, [rows, search, checkFilter, checkSummary]);
  const allIds = [...new Set(visibleRows.filter((row) => row.postable !== false).map((row) => row.id).filter(Boolean))];
  const totalDoCount = new Set(rows.map((row) => row.id)).size;
  const displayNumber = (value) => (value === null || value === undefined || value === "" ? "—" : Number(value).toLocaleString("en-IN", { maximumFractionDigits: 2 }));
  function toggle(id) { setSelected((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; }); }

  const comparisonSummary = useMemo(() => {
    if (!comparison) return null;
    const counts = { MATCHED: 0, DIFFERENT: 0, NOT_IN_QUEUE: 0, ONLY_IN_SYSTEM: 0 };
    for (const row of comparison.results) counts[row.status] += 1;
    // A DO is clean only when every one of its lines matched the sheet.
    const badDoIds = new Set(comparison.results.filter((row) => row.status !== "MATCHED" && row.dc_id).map((row) => row.dc_id));
    const cleanDoIds = [...new Set(comparison.results.filter((row) => row.status === "MATCHED" && !badDoIds.has(row.dc_id)).map((row) => row.dc_id))];
    return { counts, cleanDoIds };
  }, [comparison]);

  async function handleCompareFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const excelRows = await parseUploadedWorkbook(file);
      setComparison({ fileName: file.name, results: compareWithQueue(excelRows, rows) });
      setShowAllComparison(false);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "BULK_POST_COMPARE_FAILED");
    }
  }

  async function post() {
    if (!selected.size) return;
    // Server posts DOs one by one and accepts at most 100 per request.
    if (selected.size > MAX_DOS_PER_POST) { setNotice(`Select at most ${MAX_DOS_PER_POST} delivery orders per Bulk Post (${selected.size} selected).`); return; }
    setPosting(true); setNotice("");
    try {
      const result = await bulkPostDeliveryOrders([...selected]);
      const outcomes = Array.isArray(result?.results) ? result.results : [];
      const failed = outcomes.filter((row) => row.ok === false);
      // Name each failed DO and its reason, so the user knows what to fix.
      const dcNumberById = new Map(rows.map((row) => [row.id, row.dc_number]));
      const failedText = failed.slice(0, 10).map((row) => `${dcNumberById.get(row.dc_id) || row.dc_id}: ${row.message || row.code}`).join(" | ");
      setNotice(failed.length
        ? `${outcomes.length - failed.length} posted; ${failed.length} remain in the queue. ${failedText}${failed.length > 10 ? ` …and ${failed.length - 10} more` : ""}`
        : `Posted ${outcomes.length || selected.size} delivery order(s).`);
      setSelected(new Set()); setComparison(null); await query.refetch();
    }
    catch (error) { setNotice(error instanceof Error ? error.message : "BULK_POST_FAILED"); }
    finally { setPosting(false); }
  }

  const comparisonRows = comparison ? (showAllComparison ? comparison.results : comparison.results.filter((row) => row.status !== "MATCHED")) : [];

  return <ErpMasterListTemplate
    eyebrow="Procurement / SO02"
    title="Bulk Posting — PGI & Invoice"
    actions={[
      { key: "back", label: "SO02 Queue", tone: "neutral", onClick: () => popScreen() },
      { key: "refresh", label: "Refresh", tone: "neutral", onClick: () => query.refetch(), disabled: query.isFetching },
      { key: "compare", label: "Check with Upload Excel", tone: "neutral", onClick: () => compareInputRef.current?.click(), disabled: rows.length === 0 },
      { key: "export", label: "Export Excel", tone: "neutral", onClick: () => void exportQueue(visibleRows), disabled: visibleRows.length === 0 },
      { key: "post", label: posting ? "Posting..." : `Bulk Post (${selected.size})`, tone: "primary", onClick: post, disabled: posting || selected.size === 0 },
    ]}
    notices={notice ? [{ key: "bulk-posting-notice", tone: notice.includes("FAILED") || notice.includes("remain in the queue") || notice.includes("at most") ? "warning" : "success", message: notice }] : []}
    filterSection={{
      eyebrow: "Company", title: "Bulk-DO Upload records only",
      children: (
        <div className="grid gap-3 md:grid-cols-2">
          <TransactionCompanySelector runtimeContext={runtimeContext} value={companyId} onChange={(value) => { setCompanyId(value); setSelected(new Set()); setComparison(null); }} label="Company" />
          <QuickFilterInput label="Search" value={search} onChange={setSearch} placeholder="DO, FO, SO, SKU, Document Name, Tally Invoice, IBN, LR, Truck, Transporter..." />
          <input ref={compareInputRef} type="file" accept=".xlsx" className="hidden" onChange={(event) => void handleCompareFile(event)} />
        </div>
      ),
    }}
    listSection={{
      eyebrow: "Bulk PGI queue",
      title: `${totalDoCount} delivery order${totalDoCount === 1 ? "" : "s"}${search.trim() ? ` · ${new Set(visibleRows.map((row) => row.id)).size} shown` : ""}`,
      children: (
        <div className="grid gap-3">
          {rows.length ? (
            <div className="flex flex-wrap items-center gap-2 border border-amber-300 bg-amber-50 px-3 py-2 text-xs">
              <span className="font-semibold text-amber-900">Data checks:</span>
              <button type="button" onClick={() => setCheckFilter("")} className={`border px-2 py-0.5 font-semibold ${checkFilter === "" ? "border-slate-700 bg-slate-800 text-white" : "border-slate-300 bg-white text-slate-700"}`}>All DOs ({totalDoCount})</button>
              <button type="button" onClick={() => setCheckFilter("ANY")} className={`border px-2 py-0.5 font-semibold ${checkFilter === "ANY" ? "border-rose-700 bg-rose-700 text-white" : "border-rose-300 bg-white text-rose-800"}`}>Flagged ({checkSummary.flaggedDoIds.size})</button>
              {[...checkSummary.byCode.entries()].map(([code, ids]) => (
                <button key={code} type="button" onClick={() => setCheckFilter(code)} className={`border px-2 py-0.5 font-semibold ${checkFilter === code ? "border-rose-700 bg-rose-700 text-white" : "border-rose-300 bg-white text-rose-800"}`}>{CHECK_LABEL[code] ?? code} ({ids.size})</button>
              ))}
              <button type="button" disabled={checkSummary.cleanDoIds.length === 0} onClick={() => setSelected(new Set(checkSummary.cleanDoIds.slice(0, MAX_DOS_PER_POST)))} className="border border-sky-700 bg-sky-100 px-2 py-0.5 font-semibold text-sky-950 disabled:opacity-50">Select DOs with no flags ({Math.min(checkSummary.cleanDoIds.length, MAX_DOS_PER_POST)} of {checkSummary.cleanDoIds.length})</button>
            </div>
          ) : null}
          {comparison ? (
            <div className="grid gap-2 border border-slate-300 bg-slate-50 px-3 py-2 text-xs">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-semibold text-slate-800">Checked against {comparison.fileName}:</span>
                <span className="text-emerald-800">{comparisonSummary.counts.MATCHED} matched</span>
                <span className="font-semibold text-rose-700">{comparisonSummary.counts.DIFFERENT} different</span>
                <span className="font-semibold text-amber-700">{comparisonSummary.counts.NOT_IN_QUEUE} Excel rows not in queue</span>
                <span className="font-semibold text-amber-700">{comparisonSummary.counts.ONLY_IN_SYSTEM} queue lines not in Excel</span>
                <button type="button" onClick={() => setShowAllComparison((current) => !current)} className="border border-slate-400 bg-white px-2 py-0.5 font-semibold text-slate-700">{showAllComparison ? "Show problems only" : "Show all rows"}</button>
                <button type="button" onClick={() => void exportComparison(comparison.results)} className="border border-emerald-600 bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-900">Export check result</button>
                <button type="button" disabled={comparisonSummary.cleanDoIds.length === 0} onClick={() => setSelected(new Set(comparisonSummary.cleanDoIds.slice(0, MAX_DOS_PER_POST)))} className="border border-sky-700 bg-sky-100 px-2 py-0.5 font-semibold text-sky-950 disabled:opacity-50">Select fully matched DOs ({Math.min(comparisonSummary.cleanDoIds.length, MAX_DOS_PER_POST)} of {comparisonSummary.cleanDoIds.length})</button>
                <button type="button" onClick={() => setComparison(null)} className="border border-slate-300 bg-white px-2 py-0.5 text-slate-600">Close</button>
              </div>
              <ErpDenseGrid
                cellNavigate
                maxHeight="320px"
                rows={comparisonRows}
                rowKey={(row) => row.result_key}
                emptyMessage="Every Excel row matches the queue exactly."
                columns={[
                  { key: "status", label: "Result", width: "110px", render: (row) => <span className={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</span> },
                  { key: "excel_row", label: "Excel Row", width: "80px", align: "right", render: (row) => row.excel_row ?? "—" },
                  { key: "fo_or_so_number", label: "FO/SO Number", width: "120px" },
                  { key: "sku", label: "SKU", width: "120px", render: (row) => row.sku || "—" },
                  { key: "dc_number", label: "DO Number", width: "120px", render: (row) => row.dc_number || "—" },
                  { key: "document_name", label: "Document Name", width: "200px", render: (row) => row.document_name || "—" },
                  { key: "differences", label: "Differences", width: "620px", render: (row) => row.differences || "—" },
                ]}
              />
            </div>
          ) : null}
          <ErpDenseGrid cellNavigate rows={visibleRows} rowKey={(row) => `${row.id}-${row.line_number}`} emptyMessage={query.isLoading ? "Loading Bulk Posting queue..." : "No Bulk DO Upload records are pending."}
            columns={[
              { key: "select", label: <input aria-label="Select all" type="checkbox" checked={allIds.length > 0 && allIds.every((id) => selected.has(id))} onChange={(event) => setSelected(event.target.checked ? new Set(allIds) : new Set())} />, width: "52px", render: (row) => <input aria-label={`Select ${row.dc_number}`} type="checkbox" disabled={row.postable === false} checked={selected.has(row.id)} onChange={() => toggle(row.id)} /> },
              { key: "dc_number", label: "DO Number", width: "120px", render: (row) => row.dc_number || "—" },
              { key: "checks", label: "Checks", width: "320px", render: (row) => (row.checks?.length
                ? <span className="font-semibold text-rose-700">{row.checks.map((check) => check.message).join(" | ")}</span>
                : <span className="text-emerald-800">OK</span>) },
              { key: "dc_date", label: "DO Date", width: "100px", render: (row) => row.dc_date || "—" },
              { key: "posting_action", label: "SO02 Action", width: "130px", render: (row) => row.posting_action || "—" },
              { key: "fo_number", label: "FO Number", width: "120px", render: (row) => row.fo_number || "—" },
              { key: "sku_code", label: "SKU", width: "120px", render: (row) => row.sku_code || "—" },
              { key: "document_name", label: "Document Name", width: "220px", render: (row) => row.document_name || row.sku || "—" },
              { key: "pack_qty", label: "Pack Qty", width: "90px", align: "right", render: (row) => displayNumber(row.pack_qty) },
              { key: "base_qty", label: "Base Qty", width: "90px", align: "right", render: (row) => displayNumber(row.base_qty) },
              { key: "storage_location_code", label: "Storage Location", width: "110px", render: (row) => row.storage_location_code || "—" },
              { key: "pre_invoice_tally_invoice_number", label: "Tally Invoice Number", width: "160px", render: (row) => row.pre_invoice_tally_invoice_number || "—" },
              { key: "pre_invoice_tally_invoice_date", label: "Tally Invoice Date", width: "130px", render: (row) => row.pre_invoice_tally_invoice_date || "—" },
              { key: "pre_invoice_inbound_number", label: "Inbound Number", width: "130px", render: (row) => row.pre_invoice_inbound_number || "—" },
              { key: "transporter", label: "Transporter", width: "170px", render: (row) => row.transporter || "—" },
              { key: "lr_number", label: "LR Number", width: "120px", render: (row) => row.lr_number || "—" },
              { key: "lr_date", label: "LR Date", width: "100px", render: (row) => row.lr_date || "—" },
              { key: "vehicle_number", label: "Truck Number", width: "120px", render: (row) => row.vehicle_number || "—" },
              { key: "dispatch_date", label: "Dispatch Date", width: "110px", render: (row) => row.dispatch_date || "—" },
              { key: "dd_flag", label: "DD Flag", width: "70px", render: (row) => row.dd_flag ? "YES" : "NO" },
              { key: "so_number", label: "SO Number", width: "120px", render: (row) => row.so_number || "—" },
              { key: "external_so_number", label: "External SO Number", width: "140px", render: (row) => row.external_so_number || "—" },
              { key: "company_code", label: "Company Code", width: "100px", render: (row) => row.company_code || "—" },
              { key: "vendor_code", label: "Vendor Code", width: "150px", render: (row) => row.vendor_code || "—" },
              { key: "rate", label: "Rate", width: "100px", align: "right", render: (row) => displayNumber(row.rate) },
              { key: "gst_split", label: "GST Split", width: "110px", render: (row) => row.gst_split ? `${row.gst_split}${row.gst_rate ? ` (${row.gst_rate}%)` : ""}` : "—" },
              { key: "value", label: "Value", width: "110px", align: "right", render: (row) => displayNumber(row.value) },
              { key: "round_off", label: "Round Off", width: "90px", align: "right", render: (row) => displayNumber(row.round_off) },
              { key: "parent_company", label: "Parent Company", width: "160px", render: (row) => row.parent_company || "—" },
              { key: "bill_to", label: "Bill To", width: "180px", render: (row) => row.bill_to || "—" },
              { key: "ship_to", label: "Ship To", width: "180px", render: (row) => row.ship_to || "—" },
            ]}
          />
        </div>
      ),
    }}
  />;
}
