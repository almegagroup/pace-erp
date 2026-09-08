/*
 * File-Path: frontend/src/pages/dashboard/procurement/accounts/RecoDataPage.jsx
 * Domain: PROCUREMENT / Accounts
 * Purpose: AC10 -- RECO DATA report. First real consumer of the
 *          Stock-vs-AP-Reco two-layer model (§104) -- Standard / Actual /
 *          AP Approved for every posted dispatch in a Tally Invoice Date
 *          range, plus PARTIAL_REVERSAL (PR19) rows and RPS "Shape 2"
 *          passthrough rows in the same grid, distinguished by row
 *          background only (never appended text -- numeric cells must stay
 *          pure numbers for Excel export, §135.6). Page 1 (Filters) / Page 2
 *          (Output Grid) / Page 3 (Reco Summary Data, reached via the
 *          "Summary" button) -- same shell as SO04/IN02/PR24/AC09.
 *          Full design: feasibility doc Section 135.
 * Authority: Frontend
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import MultiValueFilterField from "../../../../components/inputs/MultiValueFilterField.jsx";
import TransactionCompanySelector from "../../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../../components/inputs/transactionCompanyRuntime.js";
import ErpScreenScaffold, { ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { useErpScreenHotkeys } from "../../../../hooks/useErpScreenHotkeys.js";
import { useScreenBackInterceptor } from "../../../../hooks/useScreenBackInterceptor.js";
import { MASTER_PICKER_FETCH_LIMIT, useMaterialOptionsQuery } from "../../../../hooks/queries/useOmMasterQueries.js";
import { getRecoData } from "../procurementApi.js";

const TYPE_OPTIONS = ["RM", "PM", "INT", "SFG", "FG"];
const FG_TYPE_OPTIONS = ["MTO", "HPS", "MTS", "MTEST"];
const DISPATCH_TYPE_OPTIONS = ["DEPENDENT_DIRECT", "DEPENDENT_DEPOT", "INDEPENDENT_PARTY", "INDEPENDENT_PARTY_ASIAN_BILLED", "DEPENDENT_NO_INBOUND", "STO"];
const DISPATCH_CATEGORY_OPTIONS = ["RPS", "SRPS", "FRPS", "FSRPS"];
const MAX_RANGE_DAYS = 366;

const TYPE_BADGE = {
  FG: { label: "FG", className: "bg-sky-600 text-white" },
  RM: { label: "RM", className: "bg-emerald-50 text-emerald-700" },
  PM: { label: "PM", className: "bg-fuchsia-50 text-fuchsia-700" },
  INT: { label: "INT", className: "bg-blue-50 text-blue-700" },
  SFG: { label: "SFG", className: "bg-amber-50 text-amber-700" },
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
function daysAgoIso(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}
function dateSpanTooWide(dateFrom, dateTo) {
  if (!dateFrom || !dateTo) return false;
  const from = new Date(`${dateFrom}T00:00:00.000Z`);
  const to = new Date(`${dateTo}T00:00:00.000Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return false;
  return Math.floor((to.getTime() - from.getTime()) / 86400000) > MAX_RANGE_DAYS;
}
function dateRangeInvalid(dateFrom, dateTo) {
  if (!dateFrom || !dateTo) return false;
  return new Date(`${dateTo}T00:00:00.000Z`) < new Date(`${dateFrom}T00:00:00.000Z`);
}
function fmtQty(value, decimals = 3) {
  if (value === null || value === undefined || value === "") return "—";
  const amount = Number(value);
  return Number.isFinite(amount) ? amount.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : "—";
}
function fmtPct(value) {
  if (value === null || value === undefined || value === "") return "—";
  const amount = Number(value);
  return Number.isFinite(amount) ? `${amount.toFixed(2)}%` : "—";
}
// Excel-safety rule (§135.6): a numeric cell's render() may carry color, but
// its exported value must always stay a pure number -- never text appended
// to a quantity. excelValue()/copyValue() below are the enforcement point.
const numericExcelValue = (field) => (row) => (row[field] === null || row[field] === undefined ? "" : Number(row[field]));

function TypeBadge({ rowType }) {
  const info = TYPE_BADGE[rowType] ?? { label: rowType ?? "—", className: "bg-slate-100 text-slate-600" };
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${info.className}`}>{info.label}</span>;
}

function VarianceCell({ value }) {
  if (value === null || value === undefined) return <span className="text-slate-300">—</span>;
  const amount = Number(value);
  const tone = amount === 0 ? "text-slate-600" : amount > 0 ? "text-amber-700" : "text-rose-700";
  return <span className={`font-semibold ${tone}`}>{fmtQty(amount)}</span>;
}

const GRID_COLUMNS = [
  { key: "company_code", label: "Company Code", width: "100px", render: (r) => r.company_code || "—" },
  { key: "month_year", label: "Month-Year", width: "90px" },
  { key: "tally_invoice_number", label: "Tally Invoice #", width: "130px", render: (r) => r.tally_invoice_number || "—" },
  { key: "tally_invoice_date", label: "Tally Inv. Date", width: "110px", render: (r) => r.tally_invoice_date || "—" },
  { key: "pace_doc_number", label: "PACE Doc #", width: "120px", render: (r) => r.pace_doc_number || "—" },
  { key: "inbound_number", label: "IBN", width: "110px", render: (r) => r.inbound_number || "—" },
  { key: "dispatch_category", label: "Dispatch Cat.", width: "90px", render: (r) => r.dispatch_category || "—" },
  { key: "fo_number", label: "FO #", width: "110px", render: (r) => r.fo_number || "—" },
  { key: "so_stroke", label: "SO Stroke", width: "80px", render: (r) => r.so_stroke || "—" },
  { key: "actual_stroke", label: "Actual Dispatch Stroke", width: "100px", render: (r) => r.actual_stroke || "—" },
  { key: "process_order_number", label: "Process PO #", width: "110px", render: (r) => r.process_order_number || "—" },
  { key: "batch_number", label: "Batch #", width: "100px", render: (r) => r.batch_number || "—" },
  { key: "packing_order_number", label: "Packing PO #", width: "110px", render: (r) => r.packing_order_number || "—" },
  { key: "po_type", label: "PO Type", width: "75px", render: (r) => r.po_type || "—" },
  { key: "type_badge", label: "Type", width: "70px", render: (r) => <TypeBadge rowType={r.type_badge} />, copyValue: (r) => r.type_badge },
  { key: "pace_code", label: "PACE Code", width: "110px", render: (r) => r.pace_code || "—" },
  { key: "item_name", label: "Item Name", width: "200px", render: (r) => r.item_name || "—" },
  { key: "external_code", label: "External Code", width: "130px", render: (r) => r.external_code || "—" },
  { key: "costing_group", label: "Costing Group", width: "130px", render: (r) => r.costing_group || "—" },
  { key: "dosage_pct", label: "Dosage %", align: "right", width: "80px", render: (r) => fmtPct(r.dosage_pct), excelValue: numericExcelValue("dosage_pct") },
  { key: "invoice_total_qty_kg", label: "Invoice Total Qty (kg)", align: "right", width: "130px", render: (r) => fmtQty(r.invoice_total_qty_kg), excelValue: numericExcelValue("invoice_total_qty_kg") },
  { key: "invoice_total_pack_qty", label: "Invoice Total Pack Qty", align: "right", width: "130px", render: (r) => fmtQty(r.invoice_total_pack_qty, 0), excelValue: numericExcelValue("invoice_total_pack_qty") },
  { key: "dispatch_qty_kg", label: "Dispatch Qty (kg)", align: "right", width: "120px", render: (r) => fmtQty(r.dispatch_qty_kg), excelValue: numericExcelValue("dispatch_qty_kg") },
  { key: "pack_qty", label: "Pack Qty", align: "right", width: "85px", render: (r) => fmtQty(r.pack_qty, 0), excelValue: numericExcelValue("pack_qty") },
  { key: "standard_qty", label: "Standard Qty (kg)", align: "right", width: "120px", render: (r) => fmtQty(r.standard_qty), excelValue: numericExcelValue("standard_qty") },
  { key: "actual_qty", label: "Actual Qty (kg)", align: "right", width: "115px", render: (r) => fmtQty(r.actual_qty), excelValue: numericExcelValue("actual_qty") },
  { key: "ap_approved_qty", label: "AP Approved Qty (kg)", align: "right", width: "130px", render: (r) => fmtQty(r.ap_approved_qty), excelValue: numericExcelValue("ap_approved_qty") },
  { key: "variance", label: "Variance (Actual - AP)", align: "right", width: "130px", render: (r) => <VarianceCell value={r.variance} />, excelValue: numericExcelValue("variance") },
  { key: "so_number", label: "SO/STO #", width: "110px", render: (r) => r.so_number || "—" },
];

const emptyFilters = () => ({
  dateFrom: daysAgoIso(30),
  dateTo: todayIso(),
  types: [],
  fgTypes: [],
  dispatchTypes: [],
  dispatchCategories: [],
  materialValues: [],
});

function rowBackground(row) {
  if (row.section === "PARTIAL_REVERSAL") return "bg-amber-50/80";
  if (row.is_corrected) return "bg-amber-50/80";
  if (row.section === "RPS") return "bg-violet-50/70";
  return "";
}

function bucketOf(row) {
  if (row.section === "PARTIAL_REVERSAL") return "PREV";
  if (row.section === "RPS") return "RPS";
  if ((row.po_type || "").toUpperCase() === "MTEST") return "MTEST";
  return "STANDARD";
}
const BUCKET_LABEL = { STANDARD: "Standard", MTEST: "MTEST", RPS: "RPS", PREV: "Partial Reversal" };

const SUMMARY_COLUMNS = [
  { key: "company_code", label: "Company Code", width: "100px", render: (r) => r.company_code || "—" },
  { key: "bucket", label: "Bucket", width: "110px", render: (r) => BUCKET_LABEL[r.bucket] || r.bucket },
  { key: "item_key", label: "Costing Group / Item Name", width: "220px", render: (r) => r.item_key || "—" },
  { key: "external_code", label: "External Code", width: "130px", render: (r) => r.external_code || "—" },
  { key: "total_dispatch_qty", label: "Total Dispatch Qty (kg)", align: "right", width: "140px", render: (r) => fmtQty(r.total_dispatch_qty), excelValue: numericExcelValue("total_dispatch_qty") },
  { key: "total_standard_qty", label: "Total Standard Qty (kg)", align: "right", width: "140px", render: (r) => fmtQty(r.total_standard_qty), excelValue: numericExcelValue("total_standard_qty") },
  { key: "total_actual_qty", label: "Total Actual Qty (kg)", align: "right", width: "130px", render: (r) => fmtQty(r.total_actual_qty), excelValue: numericExcelValue("total_actual_qty") },
  { key: "total_ap_approved_qty", label: "Total AP Approved Qty (kg)", align: "right", width: "150px", render: (r) => fmtQty(r.total_ap_approved_qty), excelValue: numericExcelValue("total_ap_approved_qty") },
  { key: "net_variance", label: "Net Variance", align: "right", width: "110px", render: (r) => <VarianceCell value={r.net_variance} />, excelValue: numericExcelValue("net_variance") },
];

export default function RecoDataPage() {
  const { runtimeContext } = useMenu();
  const [companyId, setCompanyId] = useState("");
  useEffect(() => {
    const defaultCompanyId = resolveDefaultTransactionCompanyId(runtimeContext);
    if (defaultCompanyId && !companyId) setCompanyId(defaultCompanyId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtimeContext]);
  const effectiveCompanyId = companyId || resolveDefaultTransactionCompanyId(runtimeContext);

  const [filters, setFilters] = useState(emptyFilters);
  const [submittedParams, setSubmittedParams] = useState(null);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1); // 1 = filters, 2 = grid, 3 = summary

  const materialsQuery = useMaterialOptionsQuery(
    { status: "ACTIVE", limit: MASTER_PICKER_FETCH_LIMIT, company_id: effectiveCompanyId },
    { enabled: Boolean(effectiveCompanyId) },
  );
  const materialOptions = useMemo(
    () => (materialsQuery.materials ?? []).map((material) => ({
      value: material.id,
      label: `${material.pace_code ?? "—"} — ${material.document_name || material.material_name || "—"}`,
    })),
    [materialsQuery.materials],
  );

  const reportQ = useQuery({
    queryKey: ["reco-data", submittedParams],
    queryFn: () => getRecoData(submittedParams),
    enabled: Boolean(submittedParams),
    select: (data) => (Array.isArray(data) ? data : data?.data ?? []),
  });
  const allRows = useMemo(() => reportQ.data ?? [], [reportQ.data]);
  const rows = useMemo(() => {
    const materialFilter = new Set((filters.materialValues ?? []).map((v) => v.value));
    const typeFilter = new Set(filters.types);
    const fgTypeFilter = new Set(filters.fgTypes);
    const dispatchTypeFilter = new Set(filters.dispatchTypes);
    const dispatchCategoryFilter = new Set(filters.dispatchCategories);
    if (materialFilter.size === 0 && typeFilter.size === 0 && fgTypeFilter.size === 0
      && dispatchTypeFilter.size === 0 && dispatchCategoryFilter.size === 0) return allRows;
    return allRows.filter((row) => {
      if (materialFilter.size > 0 && !materialFilter.has(row.material_id)) return false;
      if (typeFilter.size > 0 && !typeFilter.has(row.type_badge)) return false;
      if (fgTypeFilter.size > 0 && !fgTypeFilter.has((row.po_type || "").toUpperCase())) return false;
      if (dispatchCategoryFilter.size > 0 && !dispatchCategoryFilter.has((row.dispatch_category || "").toUpperCase())) return false;
      if (dispatchTypeFilter.size > 0) return false; // dispatch_reco has no dispatch_type column today; reserved for a future extension.
      return true;
    });
  }, [allRows, filters.materialValues, filters.types, filters.fgTypes, filters.dispatchTypes, filters.dispatchCategories]);

  const [globalSearch, setGlobalSearch] = useState("");
  function getColumnFilterText(column, row) {
    if (typeof column.copyValue === "function") return String(column.copyValue(row) ?? "");
    const raw = row?.[column.key];
    return raw == null ? "" : String(raw);
  }
  const globalSearchOptions = useMemo(() => {
    const values = new Set();
    outer: for (const row of rows) {
      for (const column of GRID_COLUMNS) {
        const text = getColumnFilterText(column, row);
        if (text) values.add(text);
        if (values.size >= 500) break outer;
      }
    }
    return [...values].sort();
  }, [rows]);
  const hasActiveSearch = globalSearch.trim().length > 0;
  const filteredRows = useMemo(() => {
    const needle = globalSearch.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => GRID_COLUMNS.some((column) => getColumnFilterText(column, row).toLowerCase().includes(needle)));
  }, [rows, globalSearch]);

  // Page 3 -- Reco Summary Data. Grouped by (Company, Bucket, Item), summed
  // off the SAME already-netted Page 2 result set -- no separate backend
  // aggregation endpoint (§135.7).
  const [summaryMaterialType, setSummaryMaterialType] = useState("");
  const [summarySearch, setSummarySearch] = useState("");
  const summaryRows = useMemo(() => {
    const groups = new Map();
    for (const row of rows) {
      if (summaryMaterialType && row.type_badge !== summaryMaterialType) continue;
      const bucket = bucketOf(row);
      const itemKey = row.costing_group || row.item_name || "—";
      const key = `${row.company_code}|${bucket}|${itemKey}`;
      const group = groups.get(key) ?? {
        key, company_code: row.company_code, bucket, item_key: itemKey, external_code: row.external_code,
        total_dispatch_qty: 0, total_standard_qty: 0, total_actual_qty: 0, total_ap_approved_qty: 0,
      };
      group.total_dispatch_qty += Number(row.dispatch_qty_kg ?? 0);
      group.total_standard_qty += Number(row.standard_qty ?? 0);
      group.total_actual_qty += Number(row.actual_qty ?? 0);
      group.total_ap_approved_qty += Number(row.ap_approved_qty ?? 0);
      groups.set(key, group);
    }
    return [...groups.values()]
      .map((g) => ({ ...g, net_variance: g.total_actual_qty - g.total_ap_approved_qty }))
      .sort((a, b) => a.company_code.localeCompare(b.company_code) || a.bucket.localeCompare(b.bucket) || a.item_key.localeCompare(b.item_key));
  }, [rows, summaryMaterialType]);
  const filteredSummaryRows = useMemo(() => {
    const needle = summarySearch.trim().toLowerCase();
    if (!needle) return summaryRows;
    return summaryRows.filter((row) => SUMMARY_COLUMNS.some((column) => {
      const text = typeof column.copyValue === "function" ? String(column.copyValue(row) ?? "") : String(row?.[column.key] ?? "");
      return text.toLowerCase().includes(needle);
    }));
  }, [summaryRows, summarySearch]);

  function updateFilter(key, value) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }
  function toggleMulti(key, value) {
    setFilters((prev) => ({
      ...prev,
      [key]: prev[key].includes(value) ? prev[key].filter((v) => v !== value) : [...prev[key], value],
    }));
  }
  function handleReset() {
    setFilters(emptyFilters());
    setSubmittedParams(null);
    setError("");
    setGlobalSearch("");
    setSummarySearch("");
    setSummaryMaterialType("");
    setPage(1);
  }
  function handleExecute() {
    setError("");
    setGlobalSearch("");
    if (!effectiveCompanyId) { setError("Select a company first."); return; }
    if (!filters.dateFrom || !filters.dateTo) { setError("A Tally Invoice Date range is required."); return; }
    if (dateRangeInvalid(filters.dateFrom, filters.dateTo)) { setError("Date To cannot be before Date From."); return; }
    if (dateSpanTooWide(filters.dateFrom, filters.dateTo)) { setError(`Date range cannot exceed ${MAX_RANGE_DAYS} days.`); return; }
    const nextParams = { company_id: effectiveCompanyId, date_from: filters.dateFrom, date_to: filters.dateTo };
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
    if (filteredRows.length === 0) return;
    setExporting(true);
    try {
      const { downloadColoredExcelFile } = await import("../../../../shared/downloadColoredExcelFile.js");
      await downloadColoredExcelFile({
        fileName: `reco_data_${filters.dateFrom}_${filters.dateTo}.xlsx`,
        sheetName: "Reco Data",
        columns: GRID_COLUMNS,
        rows: filteredRows,
        getCellValue: (row, column) =>
          typeof column.excelValue === "function" ? column.excelValue(row)
            : typeof column.copyValue === "function" ? column.copyValue(row) : (row?.[column.key] ?? ""),
      });
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "RECO_DATA_EXPORT_FAILED");
    } finally {
      setExporting(false);
    }
  }
  async function handleExportSummary() {
    if (filteredSummaryRows.length === 0) return;
    setExporting(true);
    try {
      const { downloadColoredExcelFile } = await import("../../../../shared/downloadColoredExcelFile.js");
      await downloadColoredExcelFile({
        fileName: `reco_summary_data_${filters.dateFrom}_${filters.dateTo}.xlsx`,
        sheetName: "Reco Summary Data",
        columns: SUMMARY_COLUMNS,
        rows: filteredSummaryRows,
        getCellValue: (row, column) =>
          typeof column.excelValue === "function" ? column.excelValue(row)
            : typeof column.copyValue === "function" ? column.copyValue(row) : (row?.[column.key] ?? ""),
      });
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "RECO_SUMMARY_DATA_EXPORT_FAILED");
    } finally {
      setExporting(false);
    }
  }

  useScreenBackInterceptor(() => {
    if (page === 1) return false;
    if (page === 3) { setPage(2); return true; }
    setPage(1);
    return true;
  });
  useErpScreenHotkeys({
    focusPrimary: { perform: () => handleExecute() },
    refresh: { disabled: page === 1, perform: () => void reportQ.refetch() },
  });

  const activeError = error || (reportQ.error instanceof Error ? reportQ.error.message : "");

  if (page === 3) {
    return (
      <ErpScreenScaffold
        eyebrow="Accounts"
        title="Reco Summary Data"
        notices={activeError ? [{ key: "reco-summary-error", tone: "error", message: activeError }] : []}
        actions={[
          { key: "back", label: "Back to Reco Data", hint: "Esc", onClick: () => setPage(2) },
          { key: "export", label: exporting ? "Exporting..." : "Export Excel", onClick: () => void handleExportSummary(), disabled: exporting || filteredSummaryRows.length === 0 },
        ]}
      >
        <div className="grid gap-4">
          <ErpSectionCard eyebrow="Page 3" title={`Reco Summary Data (${filters.dateFrom} to ${filters.dateTo})`}>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <select
                value={summaryMaterialType}
                onChange={(e) => setSummaryMaterialType(e.target.value)}
                className="h-8 rounded border border-slate-300 bg-white px-2 text-sm text-slate-700"
              >
                <option value="">All Material Types</option>
                {TYPE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
              <input
                list="reco-summary-search-options"
                value={summarySearch}
                onChange={(e) => setSummarySearch(e.target.value)}
                placeholder="Search across every column..."
                className="h-8 w-full max-w-md rounded border border-slate-300 bg-white px-2.5 text-sm text-slate-800 outline-none focus:border-sky-500"
              />
              <span className="text-xs text-slate-500">{filteredSummaryRows.length} line{filteredSummaryRows.length === 1 ? "" : "s"}</span>
            </div>
            <ErpDenseGrid
              columns={SUMMARY_COLUMNS}
              rows={filteredSummaryRows}
              rowKey={(row) => row.key}
              virtualize
              rangeSelect
              maxHeight="calc(100vh - 260px)"
              getRowProps={(row) => ({ className: row.bucket === "STANDARD" ? "" : "bg-slate-50" })}
              emptyMessage={reportQ.isLoading ? "Loading..." : "No rows in this range."}
            />
          </ErpSectionCard>
        </div>
      </ErpScreenScaffold>
    );
  }

  return (
    <ErpScreenScaffold
      eyebrow="Accounts"
      title="Reco Data"
      notices={activeError ? [{ key: "reco-data-error", tone: "error", message: activeError }] : []}
      actions={
        page === 1
          ? [
              { key: "reset", label: "Reset", onClick: handleReset },
              { key: "execute", label: "Execute", tone: "primary", onClick: handleExecute },
            ]
          : [
              { key: "back", label: "Back to Filters", hint: "Esc", onClick: () => setPage(1) },
              { key: "export", label: exporting ? "Exporting..." : "Export Excel", onClick: () => void handleExport(), disabled: exporting || filteredRows.length === 0 },
              { key: "summary", label: "Summary", onClick: () => setPage(3), disabled: filteredRows.length === 0 },
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
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
                <TransactionCompanySelector runtimeContext={runtimeContext} value={companyId} onChange={setCompanyId} label="Company" />
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-500">Tally Invoice Date <span className="text-rose-500">*</span></label>
                  <div className="flex items-center gap-1.5">
                    <input type="date" className="rounded border border-slate-300 px-2 py-1 text-sm" value={filters.dateFrom} onChange={(e) => updateFilter("dateFrom", e.target.value)} />
                    <span className="text-slate-400">-</span>
                    <input type="date" className="rounded border border-slate-300 px-2 py-1 text-sm" value={filters.dateTo} onChange={(e) => updateFilter("dateTo", e.target.value)} />
                  </div>
                </div>
                <MultiValueFilterField
                  label="Material"
                  placeholder="All materials"
                  value={filters.materialValues}
                  onChange={(value) => updateFilter("materialValues", value)}
                  options={materialOptions}
                  loadError={materialsQuery.error instanceof Error ? materialsQuery.error.message : ""}
                  disabled={!effectiveCompanyId}
                />
              </div>

              <div>
                <p className="mb-1.5 text-xs text-slate-500">Type:</p>
                <div className="flex flex-wrap gap-1.5">
                  {TYPE_OPTIONS.map((option) => (
                    <button key={option} type="button" onClick={() => toggleMulti("types", option)}
                      className={`rounded-full border px-2.5 py-1 text-xs font-medium ${filters.types.includes(option) ? "border-sky-500 bg-sky-50 text-sky-700" : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"}`}>
                      {option}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-1.5 text-xs text-slate-500">FG Type:</p>
                <div className="flex flex-wrap gap-1.5">
                  {FG_TYPE_OPTIONS.map((option) => (
                    <button key={option} type="button" onClick={() => toggleMulti("fgTypes", option)}
                      className={`rounded-full border px-2.5 py-1 text-xs font-medium ${filters.fgTypes.includes(option) ? "border-sky-500 bg-sky-50 text-sky-700" : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"}`}>
                      {option}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-1.5 text-xs text-slate-500">Dispatch Type:</p>
                <div className="flex flex-wrap gap-1.5">
                  {DISPATCH_TYPE_OPTIONS.map((option) => (
                    <button key={option} type="button" onClick={() => toggleMulti("dispatchTypes", option)}
                      className={`rounded-full border px-2.5 py-1 text-xs font-medium ${filters.dispatchTypes.includes(option) ? "border-sky-500 bg-sky-50 text-sky-700" : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"}`}>
                      {option.replace(/_/g, " ")}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-1.5 text-xs text-slate-500">Dispatch Category:</p>
                <div className="flex flex-wrap gap-1.5">
                  {DISPATCH_CATEGORY_OPTIONS.map((option) => (
                    <button key={option} type="button" onClick={() => toggleMulti("dispatchCategories", option)}
                      className={`rounded-full border px-2.5 py-1 text-xs font-medium ${filters.dispatchCategories.includes(option) ? "border-sky-500 bg-sky-50 text-sky-700" : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"}`}>
                      {option}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-end border-t border-dashed border-slate-200 pt-3">
                <button type="button" onClick={handleExecute} className="rounded bg-sky-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-sky-700">
                  Execute
                </button>
              </div>
            </div>
          </ErpSectionCard>
        </div>
      ) : (
        <div className="grid gap-4">
          <ErpSectionCard eyebrow="Page 2" title={`Reco Data (${filters.dateFrom} to ${filters.dateTo})`}>
            <div className="mb-2 flex items-center justify-between">
              <button type="button" onClick={() => setPage(1)} className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
                Back to Filters
              </button>
              <span className="text-xs text-slate-500">
                {reportQ.isLoading ? "Loading..." : `${filteredRows.length} row${filteredRows.length === 1 ? "" : "s"}`}
              </span>
            </div>
            <div className="mb-2 flex items-center gap-2">
              <input
                list="reco-data-search-options"
                value={globalSearch}
                onChange={(e) => setGlobalSearch(e.target.value)}
                placeholder="Search across every column..."
                className="h-8 w-full max-w-md rounded border border-slate-300 bg-white px-2.5 text-sm text-slate-800 outline-none focus:border-sky-500"
              />
              <datalist id="reco-data-search-options">
                {globalSearchOptions.map((option) => <option key={option} value={option} />)}
              </datalist>
              {hasActiveSearch ? (
                <button type="button" onClick={() => setGlobalSearch("")} className="h-8 rounded border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-100">
                  Clear
                </button>
              ) : null}
            </div>
            <ErpDenseGrid
              columns={GRID_COLUMNS}
              rows={filteredRows}
              rowKey={(row, index) => `${row.invoice_id || row.pace_doc_number || "row"}-${row.material_id}-${row.section}-${index}`}
              virtualize
              rangeSelect
              maxHeight="calc(100vh - 260px)"
              getRowProps={(row) => ({ className: rowBackground(row) })}
              emptyMessage={
                reportQ.isLoading
                  ? "Loading..."
                  : hasActiveSearch
                    ? "No rows match this search."
                    : "No dispatches in this range."
              }
            />
          </ErpSectionCard>
        </div>
      )}
    </ErpScreenScaffold>
  );
}
