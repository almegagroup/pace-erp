/*
 * File-ID: 27.FE-PR24
 * File-Path: frontend/src/pages/dashboard/production/OrderInformationSystemPage.jsx
 * Gate: 27
 * Phase: 27
 * Domain: PRODUCTION
 * Purpose: PR24 Order Information System — SAP COOIS-equivalent selection screen + full
 *          transaction ledger report. See feasibility doc §122. Standalone page, not PR13.
 *          Page 1 (Filters) and Page 2 (Output Grid) are separate full-page views, never both
 *          visible at once — same pattern as IN02 StockLedgerReportPage.jsx.
 * Authority: Frontend
 */

import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import ErpDenseGrid from "../../../components/data/ErpDenseGrid.jsx";
import { useMenu } from "../../../context/useMenu.js";
import { useErpScreenHotkeys } from "../../../hooks/useErpScreenHotkeys.js";
import { useScreenBackInterceptor } from "../../../hooks/useScreenBackInterceptor.js";
import { buildTransactionCompanyList } from "../../../components/inputs/transactionCompanyRuntime.js";
import { getBatchCountsReport, getOrderInformationReport, listStrokeMasters } from "./prodApi.js";
import { listMachines } from "../om/omApi.js";

const PROCESS_ORDER_TYPES = ["MTO", "HPS", "MTS", "INT", "MTEST"];
const PACKING_ORDER_TYPES = ["PMTO", "PHPS", "PMTS", "PTEST"];
const SEGMENTS = ["ADMIX", "HPS", "IWC", "POWDER", "INT"];
const PROCESS_STATUSES = ["STANDARD", "QA_APPROVED", "QA_REJECTED", "BATCH_STARTED", "FINAL", "VERIFIED", "REVERSED", "CANCELLED"];
const PACKING_STATUSES = ["STANDARD", "FINAL", "VERIFIED", "REVERSED", "CANCELLED"];

const DIR_COLORS = { OUT: "bg-rose-50 text-rose-700", IN: "bg-emerald-50 text-emerald-700" };
const REF_BADGE_COLORS = {
  PROC_PO: "bg-sky-50 text-sky-700",
  PACK_PO: "bg-violet-50 text-violet-700",
  PI: "bg-amber-50 text-amber-700",
};

// Matches IN14 (Stock History) exactly — positive green, negative red, zero "--".
// Font ARGB values feed the coloured Excel export so it mirrors the on-screen grid.
const POSITIVE_FONT_ARGB = "FF047857";
const NEGATIVE_FONT_ARGB = "FFBE123C";
// Each new group starts at its Process PO's own SFG-101 row (tier 1) — banding that
// row is what lets a long, mixed-date-range list read as a sequence of distinct
// groups instead of one undifferentiated blob.
const GROUP_START_ROW_FILL_ARGB = "FFE0F2FE"; // sky-100, matches the on-screen band

function formatSignedQuantity(value) {
  if (value == null) return { text: "--", className: "text-slate-300", fontArgb: null };
  const amount = Number(value);
  if (!Number.isFinite(amount) || Math.abs(amount) < 0.000001) {
    return { text: "0.000", className: "text-slate-400", fontArgb: null };
  }
  const text = Math.abs(amount).toLocaleString(undefined, { minimumFractionDigits: 3 });
  return amount > 0
    ? { text, className: "text-emerald-700 font-medium", fontArgb: POSITIVE_FONT_ARGB }
    : { text: `-${text}`, className: "text-rose-700 font-medium", fontArgb: NEGATIVE_FONT_ARGB };
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
function daysAgoIso(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

const emptyFilters = () => ({
  poNumber: "",
  tab: "PROCESS",
  companyIds: [],
  orderType: "",
  batchNumber: "",
  machineId: "",
  segmentCode: "",
  strokeMasterId: "",
  statuses: [],
  hasDeviationOnly: false,
  showLinkedPacking: true,
  dateFrom: daysAgoIso(7),
  dateTo: todayIso(),
});

const GRID_COLUMNS = [
  { key: "company_code", label: "Co.", width: "70px", render: (r) => <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">{r.company_code || "--"}</span> },
  { key: "posting_date", label: "Posting Date", width: "100px" },
  { key: "material_name", label: "Material", render: (r) => r.material_name || "--" },
  { key: "external_code", label: "External Code", render: (r) => r.external_code || "--" },
  { key: "material_type", label: "Item Type", width: "80px", render: (r) => r.material_type || "--" },
  { key: "stroke_number", label: "Stroke", width: "80px", render: (r) => (r.stroke_number == null ? "--" : String(r.stroke_number)) },
  { key: "movement_type_code", label: "Movement", width: "80px" },
  {
    key: "direction",
    label: "Dir",
    width: "56px",
    align: "center",
    render: (r) => <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${DIR_COLORS[r.direction] ?? ""}`}>{r.direction}</span>,
  },
  {
    key: "quantity",
    label: "Posted Qty",
    align: "right",
    width: "100px",
    render: (r) => {
      const { text, className } = formatSignedQuantity(r.quantity);
      return <span className={className}>{text}</span>;
    },
    copyValue: (r) => formatSignedQuantity(r.quantity).text,
    excelColor: (r) => {
      const { fontArgb } = formatSignedQuantity(r.quantity);
      return fontArgb ? { fontArgb } : null;
    },
    excelValue: (r) => Number(r.quantity ?? 0),
    numFmt: "0.000;-0.000",
  },
  // Only ever populated on the Packing PO's own FG-101 row (tier 3) — every other
  // row's num_packs/fill_qty_per_pack come back null from the backend and render blank.
  { key: "num_packs", label: "Num Packs", align: "right", width: "90px", render: (r) => (r.num_packs == null ? "" : Number(r.num_packs).toLocaleString()) },
  { key: "fill_qty_per_pack", label: "Per Pack", align: "right", width: "90px", render: (r) => (r.fill_qty_per_pack == null ? "" : Number(r.fill_qty_per_pack).toLocaleString(undefined, { maximumFractionDigits: 3 })) },
  { key: "batch_number", label: "Batch #", width: "100px", render: (r) => r.batch_number || "--" },
  {
    key: "reference_document_number",
    label: "Ref. Document",
    render: (r) => (
      <span className="inline-flex items-center gap-1.5">
        {r.reference_document_type ? (
          <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${REF_BADGE_COLORS[r.reference_document_type] ?? "bg-slate-100 text-slate-600"}`}>
            {r.reference_document_type.replace("_", " ")}
          </span>
        ) : null}
        <span className="font-mono text-[11px]">{r.reference_document_number || "--"}</span>
      </span>
    ),
  },
  {
    key: "standard_qty",
    label: "Standard Qty",
    align: "right",
    width: "100px",
    render: (r) => {
      const { text, className } = formatSignedQuantity(r.standard_qty);
      return <span className={className}>{text}</span>;
    },
    copyValue: (r) => formatSignedQuantity(r.standard_qty).text,
    excelColor: (r) => {
      const { fontArgb } = formatSignedQuantity(r.standard_qty);
      return fontArgb ? { fontArgb } : null;
    },
    excelValue: (r) => Number(r.standard_qty ?? 0),
    numFmt: "0.000;-0.000",
  },
  { key: "dosage_pct", label: "Dosage %", align: "right", width: "90px", render: (r) => (r.dosage_pct == null ? <span className="text-slate-300">--</span> : `${Number(r.dosage_pct).toLocaleString(undefined, { maximumFractionDigits: 4 })}%`) },
  {
    key: "apl_qty",
    label: "APL Qty",
    align: "right",
    width: "100px",
    render: (r) => {
      const { text, className } = formatSignedQuantity(r.apl_qty);
      return <span className={className}>{text}</span>;
    },
    copyValue: (r) => formatSignedQuantity(r.apl_qty).text,
    excelColor: (r) => {
      const { fontArgb } = formatSignedQuantity(r.apl_qty);
      return fontArgb ? { fontArgb } : null;
    },
    excelValue: (r) => Number(r.apl_qty ?? 0),
    numFmt: "0.000;-0.000",
  },
  {
    key: "variance_qty",
    label: "Variance",
    align: "right",
    width: "100px",
    render: (r) => {
      const { text, className } = formatSignedQuantity(r.variance_qty);
      return <span className={className}>{text}</span>;
    },
    copyValue: (r) => formatSignedQuantity(r.variance_qty).text,
    excelColor: (r) => {
      const { fontArgb } = formatSignedQuantity(r.variance_qty);
      return fontArgb ? { fontArgb } : null;
    },
    excelValue: (r) => Number(r.variance_qty ?? 0),
    numFmt: "0.000;-0.000",
  },
];

// "Batch Counts" sub-report (business owner, 2026-09-03) — per SFG per Stroke, how
// many batches were made in a date range. Separate full-page view from the main
// movement ledger above, reached via its own button + Date Range modal.
const BATCH_COUNTS_COLUMNS = [
  { key: "company_code", label: "Co.", width: "70px", render: (r) => <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">{r.company_code || "--"}</span> },
  { key: "stroke_number", label: "Stroke", width: "90px", render: (r) => (r.stroke_number == null ? "--" : String(r.stroke_number)) },
  { key: "material_name", label: "SFG Material", render: (r) => r.material_name || "--" },
  { key: "external_code", label: "External Code", render: (r) => r.external_code || "--" },
  { key: "material_type", label: "Item Type", width: "80px", render: (r) => r.material_type || "--" },
  { key: "batch_count", label: "Batch Count", width: "100px", align: "right", render: (r) => Number(r.batch_count ?? 0).toLocaleString() },
  { key: "till_date_count", label: "Till Date", width: "100px", align: "right", render: (r) => Number(r.till_date_count ?? 0).toLocaleString() },
];

function BatchCountsModal({ dateFrom, dateTo, error, onChange, onSubmit, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-full max-w-sm rounded border border-slate-200 bg-white p-4 shadow-lg">
        <h3 className="mb-3 text-sm font-semibold text-slate-800">Batch Counts — select date range</h3>
        {error ? <p className="mb-2 text-xs font-medium text-rose-600">{error}</p> : null}
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">Date From</label>
            <input type="date" className="rounded border border-slate-300 px-2 py-1 text-sm" value={dateFrom} onChange={(e) => onChange("dateFrom", e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">Date To</label>
            <input type="date" className="rounded border border-slate-300 px-2 py-1 text-sm" value={dateTo} onChange={(e) => onChange("dateTo", e.target.value)} />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
          <button type="button" onClick={onSubmit} className="rounded bg-sky-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-sky-700">View Report</button>
        </div>
      </div>
    </div>
  );
}

export default function OrderInformationSystemPage() {
  const { runtimeContext } = useMenu();
  const companies = useMemo(() => buildTransactionCompanyList(runtimeContext), [runtimeContext]);

  const [filters, setFilters] = useState(emptyFilters);
  const [submittedParams, setSubmittedParams] = useState(null);
  const [error, setError] = useState("");
  // Page 1 (Filters), Page 2 (Output Grid) and "BATCH_COUNTS" (the Batch Counts
  // sub-report) are separate full-page views — never more than one visible at
  // once, same as IN02/IN03.
  const [page, setPage] = useState(1);

  // Batch Counts sub-report — its own tiny modal (Date Range only) + full-page grid,
  // reached from Page 1 without disturbing the main filters above.
  const [batchCountsModalOpen, setBatchCountsModalOpen] = useState(false);
  const [batchCountsRange, setBatchCountsRange] = useState({ dateFrom: daysAgoIso(30), dateTo: todayIso() });
  const [batchCountsParams, setBatchCountsParams] = useState(null);
  const [batchCountsError, setBatchCountsError] = useState("");

  const singleCompanyId = filters.companyIds.length === 1 ? filters.companyIds[0] : companies[0]?.id;

  const machinesQ = useQuery({
    queryKey: ["ois-machines", singleCompanyId],
    queryFn: () => listMachines({ company_id: singleCompanyId, active: true }),
    enabled: filters.tab === "PROCESS" && Boolean(singleCompanyId),
    select: (data) => (Array.isArray(data) ? data : data?.data ?? []),
  });
  const strokesQ = useQuery({
    queryKey: ["ois-strokes", singleCompanyId],
    queryFn: () => listStrokeMasters({ company_id: singleCompanyId, status: "APPROVED", per_page: 100 }),
    enabled: filters.tab === "PROCESS" && Boolean(singleCompanyId),
    select: (data) => (Array.isArray(data) ? data : data?.data ?? []),
  });

  const reportQ = useQuery({
    queryKey: ["order-information-system", submittedParams],
    queryFn: () => getOrderInformationReport(submittedParams),
    enabled: Boolean(submittedParams),
    select: (data) => (Array.isArray(data) ? data : data?.data ?? []),
  });
  const rows = reportQ.data ?? [];

  const batchCountsQ = useQuery({
    queryKey: ["ois-batch-counts", batchCountsParams],
    queryFn: () => getBatchCountsReport(batchCountsParams),
    enabled: Boolean(batchCountsParams),
    select: (data) => (Array.isArray(data) ? data : data?.data ?? []),
  });
  const batchCountsRows = batchCountsQ.data ?? [];

  function handleOpenBatchCountsModal() {
    setBatchCountsError("");
    setBatchCountsModalOpen(true);
  }
  function handleSubmitBatchCounts() {
    if (!batchCountsRange.dateFrom || !batchCountsRange.dateTo) {
      setBatchCountsError("Both dates are required.");
      return;
    }
    if (new Date(batchCountsRange.dateTo) < new Date(batchCountsRange.dateFrom)) {
      setBatchCountsError("Date To cannot be before Date From.");
      return;
    }
    setBatchCountsError("");
    setBatchCountsModalOpen(false);
    setBatchCountsParams({ date_from: batchCountsRange.dateFrom, date_to: batchCountsRange.dateTo });
    setPage("BATCH_COUNTS");
  }

  function updateFilter(key, value) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  function toggleStatus(status) {
    setFilters((prev) => ({
      ...prev,
      statuses: prev.statuses.includes(status)
        ? prev.statuses.filter((s) => s !== status)
        : [...prev.statuses, status],
    }));
  }

  function handleReset() {
    setFilters(emptyFilters());
    setSubmittedParams(null);
    setError("");
    setPage(1);
  }

  function handleExecute() {
    setError("");
    if (!filters.poNumber) {
      if (!filters.dateFrom || !filters.dateTo) {
        setError("Posting Date range is required unless a PO Number is given.");
        return;
      }
      if (new Date(filters.dateTo) < new Date(filters.dateFrom)) {
        setError("Date To cannot be before Date From.");
        return;
      }
    }
    const nextParams = {
      po_number: filters.poNumber || undefined,
      tab: filters.tab,
      company_ids: filters.companyIds.length > 0 ? filters.companyIds.join(",") : undefined,
      order_type: filters.orderType || undefined,
      batch_number: filters.batchNumber || undefined,
      machine_id: filters.tab === "PROCESS" ? filters.machineId || undefined : undefined,
      segment_code: filters.segmentCode || undefined,
      stroke_master_id: filters.tab === "PROCESS" ? filters.strokeMasterId || undefined : undefined,
      statuses: filters.statuses.length > 0 ? filters.statuses.join(",") : undefined,
      has_unapproved_deviation: filters.hasDeviationOnly ? "true" : undefined,
      show_linked_packing: filters.tab === "PROCESS" && filters.showLinkedPacking ? "true" : undefined,
      date_from: filters.poNumber ? undefined : filters.dateFrom,
      date_to: filters.poNumber ? undefined : filters.dateTo,
    };
    if (submittedParams && JSON.stringify(submittedParams) === JSON.stringify(nextParams)) {
      void reportQ.refetch();
      setPage(2);
      return;
    }
    setSubmittedParams(nextParams);
    setPage(2);
  }

  const [exporting, setExporting] = useState(false);
  async function handleExport() {
    if (rows.length === 0) return;
    setExporting(true);
    try {
      // Dynamic import — exceljs only ever loads once Export is actually clicked,
      // matching IN14 (Stock History)'s own coloured-export pattern.
      const { downloadColoredExcelFile } = await import("../../../shared/downloadColoredExcelFile.js");
      await downloadColoredExcelFile({
        fileName: `order_information_system_${filters.dateFrom || "from"}_${filters.dateTo || "to"}.xlsx`,
        sheetName: "Order Information System",
        columns: GRID_COLUMNS,
        rows,
        getCellValue: (row, column) =>
          typeof column.excelValue === "function" ? column.excelValue(row)
            : typeof column.copyValue === "function" ? column.copyValue(row) : (row?.[column.key] ?? ""),
        getCellColor: (row, column) =>
          typeof column.excelColor === "function" ? column.excelColor(row) : null,
        getRowFillArgb: (row) => (row.is_group_start ? GROUP_START_ROW_FILL_ARGB : null),
      });
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "ORDER_INFORMATION_EXPORT_FAILED");
    } finally {
      setExporting(false);
    }
  }

  // Esc / shell Back returns to the filter page instead of leaving the screen entirely.
  useScreenBackInterceptor(() => {
    if (page === 1) return false;
    setPage(1);
    return true;
  });

  useErpScreenHotkeys({
    focusPrimary: { perform: () => handleExecute() },
    refresh: {
      disabled: page === 1,
      perform: () => (page === "BATCH_COUNTS" ? void batchCountsQ.refetch() : void reportQ.refetch()),
    },
  });

  const statusOptions = filters.tab === "PROCESS" ? PROCESS_STATUSES : PACKING_STATUSES;
  const orderTypeOptions = filters.tab === "PROCESS" ? PROCESS_ORDER_TYPES : PACKING_ORDER_TYPES;
  const activeError = page === "BATCH_COUNTS"
    ? batchCountsError || (batchCountsQ.error instanceof Error ? batchCountsQ.error.message : "")
    : error || (reportQ.error instanceof Error ? reportQ.error.message : "");

  return (
    <ErpScreenScaffold
      eyebrow="Production Reports"
      title="Order Information System"
      notices={activeError ? [{ key: "ois-error", tone: "error", message: activeError }] : []}
      actions={
        page === 1
          ? [
              { key: "batch-counts", label: "Batch Counts", onClick: handleOpenBatchCountsModal },
              { key: "reset", label: "Reset", onClick: handleReset },
              { key: "execute", label: "Execute", tone: "primary", onClick: handleExecute },
            ]
          : page === "BATCH_COUNTS"
          ? [
              { key: "back", label: "Back to Filters", hint: "Esc", onClick: () => setPage(1) },
              { key: "change-range", label: "Change Date Range", onClick: handleOpenBatchCountsModal },
            ]
          : [
              { key: "back", label: "Back to Filters", hint: "Esc", onClick: () => setPage(1) },
              { key: "export", label: exporting ? "Exporting..." : "Export Excel", onClick: () => void handleExport(), disabled: exporting || rows.length === 0 },
              {
                key: "execute",
                label: reportQ.isFetching ? "Executing..." : "Execute Again",
                tone: "primary",
                onClick: handleExecute,
                disabled: reportQ.isFetching,
              },
            ]
      }
    >
      {page === 1 ? (
      <div className="grid gap-4">
        <ErpSectionCard eyebrow="Page 1" title="Selection Screen">
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex min-w-[260px] flex-col gap-1">
                <label className="text-xs text-slate-500">PO Number <span className="text-slate-400">(jumps straight to one order's full history — bypasses date range)</span></label>
                <input
                  className="rounded border border-slate-300 px-2 py-1 font-mono text-sm"
                  placeholder="e.g. 9300000063 or 9400000037"
                  value={filters.poNumber}
                  onChange={(e) => updateFilter("poNumber", e.target.value.trim())}
                />
              </div>
            </div>

            <div className="flex gap-0 border-b border-slate-200">
              {["PROCESS", "PACKING"].map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setFilters((prev) => ({ ...prev, tab, orderType: "", machineId: "", strokeMasterId: "" }))}
                  className={`px-4 py-2 text-sm font-medium border-b-2 ${filters.tab === tab ? "border-sky-600 text-sky-700" : "border-transparent text-slate-500 hover:text-slate-700"}`}
                >
                  {tab === "PROCESS" ? "Process Orders" : "Packing Orders"}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-500">Company</label>
                <select
                  className="rounded border border-slate-300 px-2 py-1 text-sm"
                  value={filters.companyIds[0] ?? ""}
                  onChange={(e) => updateFilter("companyIds", e.target.value ? [e.target.value] : [])}
                >
                  <option value="">All my companies ({companies.length})</option>
                  {companies.map((c) => (
                    <option key={c.id ?? c.company_id} value={c.id ?? c.company_id}>{c.company_code} — {c.company_name}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-500">Order Type</label>
                <select className="rounded border border-slate-300 px-2 py-1 text-sm" value={filters.orderType} onChange={(e) => updateFilter("orderType", e.target.value)}>
                  <option value="">All</option>
                  {orderTypeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-500">Batch Number</label>
                <input className="rounded border border-slate-300 px-2 py-1 text-sm" placeholder="e.g. EV02640" value={filters.batchNumber} onChange={(e) => updateFilter("batchNumber", e.target.value.trim())} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-500">Segment</label>
                <select className="rounded border border-slate-300 px-2 py-1 text-sm" value={filters.segmentCode} onChange={(e) => updateFilter("segmentCode", e.target.value)}>
                  <option value="">All</option>
                  {SEGMENTS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              {filters.tab === "PROCESS" && (
                <>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-slate-500">Machine</label>
                    <select className="rounded border border-slate-300 px-2 py-1 text-sm" value={filters.machineId} onChange={(e) => updateFilter("machineId", e.target.value)} disabled={!singleCompanyId}>
                      <option value="">All</option>
                      {(machinesQ.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.machine_code || m.machine_name || m.id}</option>)}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-slate-500">Stroke Number</label>
                    <select className="rounded border border-slate-300 px-2 py-1 text-sm" value={filters.strokeMasterId} onChange={(e) => updateFilter("strokeMasterId", e.target.value)} disabled={!singleCompanyId}>
                      <option value="">All</option>
                      {(strokesQ.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.stroke_number ?? s.id}</option>)}
                    </select>
                  </div>
                </>
              )}
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-500">Posting Date {!filters.poNumber && <span className="text-rose-500">*</span>}</label>
                <div className="flex items-center gap-1.5">
                  <input type="date" className="rounded border border-slate-300 px-2 py-1 text-sm" value={filters.dateFrom} onChange={(e) => updateFilter("dateFrom", e.target.value)} disabled={Boolean(filters.poNumber)} />
                  <span className="text-slate-400">-</span>
                  <input type="date" className="rounded border border-slate-300 px-2 py-1 text-sm" value={filters.dateTo} onChange={(e) => updateFilter("dateTo", e.target.value)} disabled={Boolean(filters.poNumber)} />
                </div>
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-xs text-slate-500">Status:</p>
              <div className="flex flex-wrap gap-1.5">
                {statusOptions.map((status) => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => toggleStatus(status)}
                    className={`rounded-full border px-2.5 py-1 text-xs font-medium ${filters.statuses.includes(status) ? "border-sky-500 bg-sky-50 text-sky-700" : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"}`}
                  >
                    {status.replace(/_/g, " ")}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-5">
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" checked={filters.hasDeviationOnly} onChange={(e) => updateFilter("hasDeviationOnly", e.target.checked)} />
                Has unapproved deviation only
              </label>
              {filters.tab === "PROCESS" && (
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <input type="checkbox" checked={filters.showLinkedPacking} onChange={(e) => updateFilter("showLinkedPacking", e.target.checked)} />
                  <span><b>Show Linked Packing Lines</b> — also pull each order's downstream Packing PO movements (FG/SFG/PM)</span>
                </label>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-dashed border-slate-200 pt-3">
              <span className="text-xs text-slate-400">Open to everyone — access is company-scoped only, never rank or department-gated.</span>
              <button type="button" onClick={handleExecute} className="rounded bg-sky-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-sky-700">
                Execute
              </button>
            </div>
          </div>
        </ErpSectionCard>
      </div>
      ) : page === "BATCH_COUNTS" ? (
      <div className="grid gap-4">
        <ErpSectionCard eyebrow="Batch Counts" title={`Batches made per SFG per Stroke (${batchCountsParams?.date_from ?? ""} to ${batchCountsParams?.date_to ?? ""})`}>
          <div className="mb-2 flex items-center justify-between">
            <button type="button" onClick={() => setPage(1)} className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
              Back to Filters
            </button>
            <span className="text-xs text-slate-500">
              {batchCountsQ.isLoading ? "Loading..." : `${batchCountsRows.length} SFG/Stroke combination${batchCountsRows.length === 1 ? "" : "s"}`}
            </span>
          </div>
          <ErpDenseGrid
            columns={BATCH_COUNTS_COLUMNS}
            rows={batchCountsRows}
            rowKey={(row) => `${row.company_id}::${row.stroke_master_id ?? ""}::${row.material_id}`}
            virtualize
            rangeSelect
            maxHeight="calc(100vh - 260px)"
            emptyMessage={batchCountsQ.isLoading ? "Loading..." : "No batches were started in this date range."}
          />
        </ErpSectionCard>
      </div>
      ) : (
      <div className="grid gap-4">
        <ErpSectionCard eyebrow="Page 2" title="Order Transaction Report">
          <div className="mb-2 flex items-center justify-between">
            <button type="button" onClick={() => setPage(1)} className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
              Back to Filters
            </button>
            <span className="text-xs text-slate-500">
              {reportQ.isLoading ? "Loading..." : `${rows.length} movement${rows.length === 1 ? "" : "s"}`}
            </span>
          </div>
          <div className="mb-2 text-xs text-slate-500">
            Click and drag (or Shift+Click / Shift+Arrow) to select a range, then Ctrl+C to copy — same as Excel. The
            shaded row at the top of each block marks where that order's group begins.
          </div>
          <ErpDenseGrid
            columns={GRID_COLUMNS}
            rows={rows}
            rowKey={(row) => row.id}
            virtualize
            rangeSelect
            // Bands the Process PO's own SFG-101 row (tier 1) so a long, mixed-date-range
            // list visually reads as a sequence of distinct order-groups. sky-100, not
            // sky-50 -- sky-50 is nearly imperceptible against white in a dense grid (same
            // lesson IN14 already learned for its Total row, see TOTAL_ROW_FILL_ARGB there).
            // Also matches the Excel export's fill color exactly now (see GROUP_START_ROW_FILL_ARGB).
            getRowProps={(row) => (row.is_group_start ? { className: "bg-sky-100" } : {})}
            maxHeight="calc(100vh - 260px)"
            emptyMessage={reportQ.isLoading ? "Loading..." : "No movements match this criteria."}
          />
        </ErpSectionCard>
      </div>
      )}
      {batchCountsModalOpen ? (
        <BatchCountsModal
          dateFrom={batchCountsRange.dateFrom}
          dateTo={batchCountsRange.dateTo}
          error={batchCountsError}
          onChange={(key, value) => setBatchCountsRange((prev) => ({ ...prev, [key]: value }))}
          onSubmit={handleSubmitBatchCounts}
          onClose={() => setBatchCountsModalOpen(false)}
        />
      ) : null}
    </ErpScreenScaffold>
  );
}
