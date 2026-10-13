/*
 * SO02 Bulk Posting — Invoice + PGI for Bulk-DO-Upload DOs.
 *
 * Review flow (business owner, 2026-10-13): the page shows everything the
 * SO03 upload created; the user exports it ("Export for Review"), checks it
 * against Tally, corrects the sheet, uploads it back ("Upload Corrections"),
 * sees exactly what will change, applies, and only then posts.
 */
import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpMasterListTemplate from "../../../../components/templates/ErpMasterListTemplate.jsx";
import TransactionCompanySelector from "../../../../components/inputs/TransactionCompanySelector.jsx";
import QuickFilterInput from "../../../../components/inputs/QuickFilterInput.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../../components/inputs/transactionCompanyRuntime.js";
import { useMenu } from "../../../../context/useMenu.js";
import { bulkPostDeliveryOrders, bulkPostingCorrections, listBulkPostingQueue } from "../procurementApi.js";
import { popScreen } from "../../../../navigation/screenStackEngine.js";
import { REVIEW_HEADERS, REVIEW_SHEET_NAME, parseReviewWorkbook } from "./bulkDoWorkbook.js";

const MAX_DOS_PER_POST = 100;

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

const CORRECTION_LABEL = {
  WILL_UPDATE: "Will update",
  UPDATED: "Updated",
  UNCHANGED: "No change",
  NEEDS_REUPLOAD: "Cancel & re-upload",
  ERROR: "Error",
  NOT_FOUND: "DO not found",
  NOT_EDITABLE: "Not editable",
};
const CORRECTION_TONE = {
  WILL_UPDATE: "font-semibold text-sky-800",
  UPDATED: "font-semibold text-emerald-800",
  UNCHANGED: "text-slate-500",
  NEEDS_REUPLOAD: "font-semibold text-amber-700",
  ERROR: "font-semibold text-rose-700",
  NOT_FOUND: "font-semibold text-rose-700",
  NOT_EDITABLE: "font-semibold text-amber-700",
};
const CORRECTION_ORDER = ["ERROR", "NOT_FOUND", "NEEDS_REUPLOAD", "NOT_EDITABLE", "WILL_UPDATE", "UPDATED", "UNCHANGED"];

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

// One row per DO line: DO Number, the upload template's correctable columns,
// then read-only reference columns. Upload this same sheet back after edits.
async function exportReviewSheet(rows) {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(REVIEW_SHEET_NAME);
  sheet.addRow(REVIEW_HEADERS);
  for (const row of rows) {
    sheet.addRow([
      row.dc_number,
      row.fo_number || row.so_number, row.dc_date, row.transporter, row.lr_number, row.lr_date, row.sku_code,
      Number(row.pack_qty ?? 0), row.storage_location_code, row.pre_invoice_tally_invoice_number, row.pre_invoice_tally_invoice_date,
      row.pre_invoice_inbound_number, row.vehicle_number, row.dispatch_date,
      row.so_number, row.external_so_number, row.bill_to, row.bill_to_gst_number, row.ship_to, row.ship_to_address, row.ship_to_state,
      row.document_name, row.pack_uom_code, Number(row.base_qty ?? 0), Number(row.rate ?? 0), Number(row.value ?? 0), row.posting_action,
      (row.checks ?? []).map((check) => check.message).join(" | "),
    ]);
  }
  sheet.getRow(1).font = { bold: true };
  sheet.columns.forEach((column) => { column.width = 18; });
  // Correctable columns (2-14) are tinted; reference columns are not.
  for (let column = 2; column <= 14; column += 1) {
    sheet.getRow(1).getCell(column).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } };
  }
  const notes = workbook.addWorksheet("How to correct");
  [
    ["1. Check every row against Tally and your LR / truck records."],
    ["2. Correct only the yellow columns (DO Date … Dispatch Date). Keep the DO Number column exactly as exported."],
    ["3. DO Date, Transporter, LR Number/Date, Tally Invoice Number/Date, Inbound Number, Truck Number and Dispatch Date are corrected in place."],
    ["4. A change in SKU, Pack Qty, Storage Location or FO/SO is NOT corrected here: cancel that DO in SO03 and upload it again with Bulk DO Upload."],
    ["5. A blank cell never erases existing data. Save, then use \"Upload Corrections\" on the Bulk Posting page."],
    ["6. You may delete rows that need no correction — DOs and lines not in the file stay exactly as they are."],
    ["7. If a DO has several lines, write a corrected value on any one of its lines (or all of them, the same value). Two different values for one DO is an error."],
    ["8. Upload shows a preview first; nothing is saved until you click \"Apply\". Only DOs not yet posted can be corrected."],
    ["9. If everything is already correct, no upload is needed — go straight to Bulk Post."],
  ].forEach((line) => notes.addRow(line));
  notes.getColumn(1).width = 140;
  await saveWorkbook(workbook, `so02_bulk_posting_review_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export default function SO02BulkPostingPage() {
  const { runtimeContext } = useMenu();
  const [companyId, setCompanyId] = useState("");
  const [selected, setSelected] = useState(() => new Set());
  const [posting, setPosting] = useState(false);
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [checkFilter, setCheckFilter] = useState("");
  const [correction, setCorrection] = useState(null);
  const [correctionBusy, setCorrectionBusy] = useState(false);
  const correctionInputRef = useRef(null);
  const effectiveCompanyId = companyId || resolveDefaultTransactionCompanyId(runtimeContext);
  const query = useQuery({ queryKey: ["so02-bulk-posting", effectiveCompanyId], queryFn: () => listBulkPostingQueue(effectiveCompanyId), enabled: Boolean(effectiveCompanyId) });
  const rows = useMemo(() => Array.isArray(query.data?.items) ? query.data.items : [], [query.data]);

  // Suspicious-data checks come per DO from the server.
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
    return { byCode, flaggedDoIds, cleanDoIds: [...seen].filter((id) => !flaggedDoIds.has(id)) };
  }, [rows]);

  const visibleRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const byCheck = checkFilter
      ? rows.filter((row) => (checkFilter === "ANY" ? checkSummary.flaggedDoIds.has(row.id) : checkSummary.byCode.get(checkFilter)?.has(row.id)))
      : rows;
    if (!needle) return byCheck;
    return byCheck.filter((row) => [row.dc_number, row.fo_number, row.so_number, row.external_so_number, row.bill_to, row.ship_to, row.ship_to_address, row.sku_code, row.document_name, row.pre_invoice_tally_invoice_number, row.pre_invoice_inbound_number, row.lr_number, row.vehicle_number, row.transporter]
      .some((value) => String(value ?? "").toLowerCase().includes(needle)));
  }, [rows, search, checkFilter, checkSummary]);
  const allIds = [...new Set(visibleRows.filter((row) => row.postable !== false).map((row) => row.id).filter(Boolean))];
  const totalDoCount = new Set(rows.map((row) => row.id)).size;
  const displayNumber = (value) => (value === null || value === undefined || value === "" ? "—" : Number(value).toLocaleString("en-IN", { maximumFractionDigits: 2 }));
  function toggle(id) { setSelected((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; }); }

  async function handleCorrectionFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !effectiveCompanyId) return;
    setCorrectionBusy(true); setNotice("");
    try {
      const fileRows = await parseReviewWorkbook(file);
      const result = await bulkPostingCorrections(effectiveCompanyId, fileRows, false);
      setCorrection({ fileName: file.name, fileRows, results: Array.isArray(result?.results) ? result.results : [], applied: false });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "BULK_CORRECTION_FAILED");
    } finally {
      setCorrectionBusy(false);
    }
  }

  async function applyCorrections() {
    if (!correction) return;
    setCorrectionBusy(true); setNotice("");
    try {
      const result = await bulkPostingCorrections(effectiveCompanyId, correction.fileRows, true);
      const results = Array.isArray(result?.results) ? result.results : [];
      setCorrection({ ...correction, results, applied: true });
      const updated = results.filter((row) => row.status === "UPDATED").length;
      setNotice(`${updated} DO(s) corrected. Review the queue again before posting.`);
      await query.refetch();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "BULK_CORRECTION_FAILED");
    } finally {
      setCorrectionBusy(false);
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
      setSelected(new Set()); await query.refetch();
    }
    catch (error) { setNotice(error instanceof Error ? error.message : "BULK_POST_FAILED"); }
    finally { setPosting(false); }
  }

  const correctionCounts = useMemo(() => {
    const counts = {};
    for (const row of correction?.results ?? []) counts[row.status] = (counts[row.status] ?? 0) + 1;
    return counts;
  }, [correction]);
  const correctionRows = useMemo(() => [...(correction?.results ?? [])]
    .sort((a, b) => CORRECTION_ORDER.indexOf(a.status) - CORRECTION_ORDER.indexOf(b.status)), [correction]);

  return <ErpMasterListTemplate
    eyebrow="Procurement / SO02"
    title="Bulk Posting — PGI & Invoice"
    actions={[
      { key: "back", label: "SO02 Queue", tone: "neutral", onClick: () => popScreen() },
      { key: "refresh", label: "Refresh", tone: "neutral", onClick: () => query.refetch(), disabled: query.isFetching },
      { key: "export", label: "Export for Review", tone: "neutral", onClick: () => void exportReviewSheet(visibleRows), disabled: visibleRows.length === 0 },
      { key: "corrections", label: correctionBusy ? "Reading..." : "Upload Corrections", tone: "neutral", onClick: () => correctionInputRef.current?.click(), disabled: correctionBusy || rows.length === 0 },
      { key: "post", label: posting ? "Posting..." : `Bulk Post (${selected.size})`, tone: "primary", onClick: post, disabled: posting || selected.size === 0 },
    ]}
    notices={notice ? [{ key: "bulk-posting-notice", tone: /FAILED|remain in the queue|at most|not a Bulk Posting/i.test(notice) ? "warning" : "success", message: notice }] : []}
    filterSection={{
      eyebrow: "Company", title: "Bulk-DO Upload records only — review, export, correct, then post",
      children: (
        <div className="grid gap-3 md:grid-cols-2">
          <TransactionCompanySelector runtimeContext={runtimeContext} value={companyId} onChange={(value) => { setCompanyId(value); setSelected(new Set()); setCorrection(null); }} label="Company" />
          <QuickFilterInput label="Search" value={search} onChange={setSearch} placeholder="DO, FO, SO, Party, Site, SKU, Document Name, Tally Invoice, IBN, LR, Truck..." />
          <input ref={correctionInputRef} type="file" accept=".xlsx" className="hidden" onChange={(event) => void handleCorrectionFile(event)} />
        </div>
      ),
    }}
    listSection={{
      eyebrow: "Bulk PGI queue",
      title: `${totalDoCount} delivery order${totalDoCount === 1 ? "" : "s"}${visibleRows.length !== rows.length ? ` · ${new Set(visibleRows.map((row) => row.id)).size} shown` : ""}`,
      children: (
        <div className="grid gap-3">
          <div className="border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-700">
            <span className="font-semibold text-slate-800">How to check: </span>
            1. Export for Review → 2. match it with Tally → 3. if anything is wrong, fix the yellow columns (rows with no correction can be deleted) → 4. Upload Corrections, check the preview, Apply → 5. Bulk Post. If everything already matches, go straight to Bulk Post.
          </div>
          {correction ? (
            <div className="grid gap-2 border border-sky-300 bg-sky-50 px-3 py-2 text-xs">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-semibold text-slate-800">{correction.applied ? "Applied" : "Preview of"} corrections from {correction.fileName}:</span>
                {CORRECTION_ORDER.filter((status) => correctionCounts[status]).map((status) => (
                  <span key={status} className={CORRECTION_TONE[status]}>{correctionCounts[status]} {CORRECTION_LABEL[status]}</span>
                ))}
                {!correction.applied ? (
                  <button type="button" disabled={correctionBusy || !correctionCounts.WILL_UPDATE} onClick={() => void applyCorrections()} className="border border-sky-700 bg-sky-100 px-2 py-0.5 font-semibold text-sky-950 disabled:opacity-50">
                    {correctionBusy ? "Applying..." : `Apply ${correctionCounts.WILL_UPDATE ?? 0} correction(s)`}
                  </button>
                ) : null}
                <button type="button" onClick={() => setCorrection(null)} className="border border-slate-300 bg-white px-2 py-0.5 text-slate-600">Close</button>
              </div>
              <span className="text-slate-600">Only DO header details are corrected here. "Cancel &amp; re-upload" rows changed an item (SKU, Pack Qty, Storage Location or FO): cancel that DO in SO03 and upload it again.</span>
              <ErpDenseGrid
                cellNavigate
                maxHeight="320px"
                rows={correctionRows}
                rowKey={(row) => `${row.dc_number}-${(row.excel_rows ?? []).join(",")}`}
                emptyMessage="The file has no rows."
                columns={[
                  { key: "status", label: "Result", width: "130px", render: (row) => <span className={CORRECTION_TONE[row.status]}>{CORRECTION_LABEL[row.status] ?? row.status}</span> },
                  { key: "dc_number", label: "DO Number", width: "120px", render: (row) => row.dc_number || "—" },
                  { key: "fo_or_so_number", label: "FO/SO", width: "120px", render: (row) => row.fo_or_so_number || "—" },
                  { key: "excel_rows", label: "Excel Rows", width: "100px", render: (row) => (row.excel_rows ?? []).join(", ") || "—" },
                  { key: "message", label: "What changes / why", width: "760px", render: (row) => row.message || "—" },
                ]}
              />
            </div>
          ) : null}
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
          <ErpDenseGrid cellNavigate rows={visibleRows} rowKey={(row) => `${row.id}-${row.line_number}`} emptyMessage={query.isLoading ? "Loading Bulk Posting queue..." : "No Bulk DO Upload records are pending."}
            columns={[
              { key: "select", label: <input aria-label="Select all" type="checkbox" checked={allIds.length > 0 && allIds.every((id) => selected.has(id))} onChange={(event) => setSelected(event.target.checked ? new Set(allIds) : new Set())} />, width: "52px", render: (row) => <input aria-label={`Select ${row.dc_number}`} type="checkbox" disabled={row.postable === false} checked={selected.has(row.id)} onChange={() => toggle(row.id)} /> },
              { key: "dc_number", label: "DO Number", width: "120px", render: (row) => row.dc_number || "—" },
              { key: "checks", label: "Checks", width: "300px", render: (row) => (row.checks?.length
                ? <span className="font-semibold text-rose-700">{row.checks.map((check) => check.message).join(" | ")}</span>
                : <span className="text-emerald-800">OK</span>) },
              { key: "so_number", label: "SO Number", width: "120px", render: (row) => row.so_number || "—" },
              { key: "fo_number", label: "FO Number", width: "120px", render: (row) => row.fo_number || "—" },
              { key: "external_so_number", label: "External SO Number", width: "140px", render: (row) => row.external_so_number || "—" },
              { key: "bill_to", label: "Party", width: "200px", render: (row) => row.bill_to || "—" },
              { key: "bill_to_gst_number", label: "Party GST", width: "150px", render: (row) => row.bill_to_gst_number || "—" },
              { key: "ship_to", label: "Site", width: "200px", render: (row) => row.ship_to || "—" },
              { key: "ship_to_address", label: "Site Address", width: "260px", render: (row) => row.ship_to_address || "—" },
              { key: "ship_to_state", label: "Site State", width: "120px", render: (row) => row.ship_to_state || "—" },
              { key: "sku_code", label: "SKU", width: "120px", render: (row) => row.sku_code || "—" },
              { key: "document_name", label: "Document Name", width: "220px", render: (row) => row.document_name || row.sku || "—" },
              { key: "pack_qty", label: "Pack Qty", width: "90px", align: "right", render: (row) => displayNumber(row.pack_qty) },
              { key: "pack_uom_code", label: "Pack UOM", width: "80px", render: (row) => row.pack_uom_code || "—" },
              { key: "base_qty", label: "Base Qty", width: "90px", align: "right", render: (row) => displayNumber(row.base_qty) },
              { key: "storage_location_code", label: "Storage Location", width: "110px", render: (row) => row.storage_location_code || "—" },
              { key: "dc_date", label: "DO Date", width: "100px", render: (row) => row.dc_date || "—" },
              { key: "pre_invoice_tally_invoice_number", label: "Tally Invoice Number", width: "160px", render: (row) => row.pre_invoice_tally_invoice_number || "—" },
              { key: "pre_invoice_tally_invoice_date", label: "Tally Invoice Date", width: "130px", render: (row) => row.pre_invoice_tally_invoice_date || "—" },
              { key: "pre_invoice_inbound_number", label: "Inbound Number", width: "130px", render: (row) => row.pre_invoice_inbound_number || "—" },
              { key: "transporter", label: "Transporter", width: "170px", render: (row) => row.transporter || "—" },
              { key: "lr_number", label: "LR Number", width: "120px", render: (row) => row.lr_number || "—" },
              { key: "lr_date", label: "LR Date", width: "100px", render: (row) => row.lr_date || "—" },
              { key: "vehicle_number", label: "Truck Number", width: "120px", render: (row) => row.vehicle_number || "—" },
              { key: "dispatch_date", label: "Dispatch Date", width: "110px", render: (row) => row.dispatch_date || "—" },
              { key: "posting_action", label: "SO02 Action", width: "130px", render: (row) => row.posting_action || "—" },
              { key: "dd_flag", label: "DD Flag", width: "70px", render: (row) => row.dd_flag ? "YES" : "NO" },
              { key: "rate", label: "Rate", width: "100px", align: "right", render: (row) => displayNumber(row.rate) },
              { key: "gst_split", label: "GST Split", width: "110px", render: (row) => row.gst_split ? `${row.gst_split}${row.gst_rate ? ` (${row.gst_rate}%)` : ""}` : "—" },
              { key: "value", label: "Value", width: "110px", align: "right", render: (row) => displayNumber(row.value) },
              { key: "round_off", label: "Round Off", width: "90px", align: "right", render: (row) => displayNumber(row.round_off) },
              { key: "parent_company", label: "Parent Company", width: "160px", render: (row) => row.parent_company || "—" },
              { key: "vendor_code", label: "Vendor Code", width: "150px", render: (row) => row.vendor_code || "—" },
              { key: "company_code", label: "Company Code", width: "100px", render: (row) => row.company_code || "—" },
            ]}
          />
        </div>
      ),
    }}
  />;
}
