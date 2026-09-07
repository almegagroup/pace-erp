/*
 * File-Path: frontend/src/pages/dashboard/procurement/accounts/BatchCostingReportPage.jsx
 * Domain: PROCUREMENT / Accounts
 * Purpose: AC09 -- Batch Costing Report. For every dispatched MTO/HPS item in
 *          the date range where the SO's declared Stroke doesn't match the
 *          Stroke it was actually produced from (same population SO04's own
 *          "Stroke Mismatch only" checkbox flags), explode AC07's own
 *          dosage-weighted RM/INT/PM/Conversion calculation into a flat,
 *          PR24-style ledger -- Page 1 (Filters) / Page 2 (Output Grid),
 *          same shell as SO04/IN02/PR24. Every row carries the full dispatch
 *          identity (Company through Actual Stroke) so nothing is lost on
 *          Excel export. RM/INT/Conversion/PM lines each show Cost ₹/kg for
 *          BOTH the SO Stroke and the Dispatched Stroke side by side -- SO
 *          Stroke blanks whenever that declared stroke was never actually
 *          created in Stroke Master. Ends in two summary rows per batch:
 *          Costing Rate for FG (per kg) and (per Pack).
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
import { getBatchCostingReport } from "../procurementApi.js";

const DISPATCH_TYPE_OPTIONS = ["DEPENDENT_DIRECT", "DEPENDENT_DEPOT", "INDEPENDENT_PARTY", "INDEPENDENT_PARTY_ASIAN_BILLED", "DEPENDENT_NO_INBOUND", "STO"];
const DISPATCH_CATEGORY_OPTIONS = ["RPS", "SRPS", "FRPS", "FSRPS"];
const MAX_RANGE_DAYS = 366;

const TYPE_BADGE = {
  SKU: { label: "FG", className: "bg-sky-600 text-white" },
  RM: { label: "RM", className: "bg-emerald-50 text-emerald-700" },
  INT: { label: "INT", className: "bg-blue-50 text-blue-700" },
  CONV: { label: "CONV", className: "border border-dashed border-slate-300 text-slate-500" },
  PM: { label: "PM", className: "bg-fuchsia-50 text-fuchsia-700" },
  FG_RATE_KG: { label: "FG RATE", className: "bg-sky-800 text-white" },
  FG_RATE_PACK: { label: "FG RATE", className: "bg-sky-800 text-white" },
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
function fmtRate(value, decimals = 4) {
  if (value === null || value === undefined || value === "") return "—";
  const amount = Number(value);
  return Number.isFinite(amount) ? amount.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : "—";
}
function fmtPct(value) {
  if (value === null || value === undefined || value === "") return "—";
  const amount = Number(value);
  return Number.isFinite(amount) ? `${amount.toFixed(2)}%` : "—";
}

function TypeBadge({ rowType }) {
  const info = TYPE_BADGE[rowType] ?? { label: rowType ?? "—", className: "bg-slate-100 text-slate-600" };
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${info.className}`}>{info.label}</span>;
}

function CostCell({ row, field }) {
  const value = row[field];
  if (value === null || value === undefined) {
    if (field === "cost_so_stroke" && row.so_stroke_missing && (row.row_type === "FG_RATE_KG" || row.row_type === "FG_RATE_PACK")) {
      return <span className="text-rose-400 text-[11px] italic">— Stroke not in Master</span>;
    }
    return <span className="text-slate-300">—</span>;
  }
  const decimals = row.row_type === "FG_RATE_PACK" ? 2 : 4;
  return <span>{fmtRate(value, decimals)}</span>;
}

const GRID_COLUMNS = [
  { key: "company_code", label: "Company Code", width: "100px", render: (r) => r.company_code || "—" },
  { key: "month_year", label: "Month-Year", width: "90px" },
  { key: "invoice_number", label: "PACE Invoice #", width: "120px", render: (r) => r.invoice_number || "—" },
  { key: "tally_invoice_number", label: "Tally Invoice #", width: "130px" },
  { key: "tally_invoice_date", label: "Tally Inv. Date", width: "110px" },
  { key: "inbound_number", label: "IBN", width: "110px", render: (r) => r.inbound_number || "—" },
  { key: "fo_number", label: "FO #", width: "110px", render: (r) => r.fo_number || "—" },
  { key: "external_so_number", label: "External SO #", width: "120px", render: (r) => r.external_so_number || "—" },
  { key: "dispatch_type", label: "Dispatch Type", width: "150px", render: (r) => r.dispatch_type || "—" },
  { key: "dispatch_category", label: "Dispatch Cat.", width: "90px", render: (r) => r.dispatch_category || "—" },
  { key: "row_type", label: "Type", width: "70px", render: (r) => <TypeBadge rowType={r.row_type} />, copyValue: (r) => r.row_type },
  { key: "fg_type", label: "FG Type", width: "75px" },
  { key: "item", label: "Item", width: "220px" },
  { key: "document_name", label: "Document Name", width: "180px", render: (r) => r.document_name || "—" },
  { key: "external_code", label: "External Code", width: "130px", render: (r) => r.external_code || "—" },
  { key: "item_category", label: "Item Category", width: "130px", render: (r) => r.item_category || "—" },
  { key: "batch_number", label: "Batch #", width: "100px" },
  { key: "packing_po_number", label: "Packing PO #", width: "110px", render: (r) => r.packing_po_number || "—" },
  { key: "so_stroke_number", label: "SO Stroke", width: "80px" },
  { key: "actual_stroke_number", label: "Actual Stroke", width: "90px" },
  { key: "costing_group", label: "Costing Group", width: "120px", render: (r) => r.costing_group || "—" },
  { key: "costing_source", label: "Costing Source", width: "170px", render: (r) => r.costing_source || "—" },
  { key: "rate", label: "Rate ₹", align: "right", width: "100px", render: (r) => fmtRate(r.rate), excelValue: (r) => (r.rate == null ? "" : Number(r.rate)) },
  { key: "wastage_other_pct", label: "Wastage/OTHR", align: "right", width: "100px", render: (r) => (r.wastage_other_pct == null ? "—" : `${Number(r.wastage_other_pct).toFixed(2)}%`) },
  { key: "basis", label: "Basis", width: "90px", render: (r) => r.basis || "—" },
  {
    key: "dosage_or_qty", label: "Dosage % / Qty per Pack", align: "right", width: "150px",
    render: (r) => (r.row_type === "PM" ? fmtRate(r.dosage_or_qty, 3) : r.row_type === "RM" || r.row_type === "INT" ? fmtPct(r.dosage_or_qty) : "—"),
  },
  { key: "cost_so_stroke", label: "Cost ₹/kg — SO Stroke", align: "right", width: "150px", render: (r) => <CostCell row={r} field="cost_so_stroke" />, copyValue: (r) => (r.cost_so_stroke == null ? "" : r.cost_so_stroke) },
  { key: "cost_dispatched_stroke", label: "Cost ₹/kg — Dispatched Stroke", align: "right", width: "170px", render: (r) => <CostCell row={r} field="cost_dispatched_stroke" />, copyValue: (r) => (r.cost_dispatched_stroke == null ? "" : r.cost_dispatched_stroke) },
];

const emptyFilters = () => ({
  dateFrom: daysAgoIso(30),
  dateTo: todayIso(),
  dispatchTypes: [],
  dispatchCategories: [],
  materialValues: [],
});

const ROW_TYPE_BAND = {
  SKU: "bg-sky-50/70 font-semibold",
  CONV: "bg-slate-50 italic",
  FG_RATE_KG: "bg-slate-50 font-bold border-t-2 border-slate-300",
  FG_RATE_PACK: "bg-slate-50 font-bold",
};

export default function BatchCostingReportPage() {
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
  const [page, setPage] = useState(1);

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
    queryKey: ["batch-costing-report", submittedParams],
    queryFn: () => getBatchCostingReport(submittedParams),
    enabled: Boolean(submittedParams),
    select: (data) => (Array.isArray(data) ? data : data?.data ?? []),
  });
  const allRows = useMemo(() => reportQ.data ?? [], [reportQ.data]);
  const rows = useMemo(() => {
    const materialFilter = new Set((filters.materialValues ?? []).map((v) => v.value));
    const dispatchTypeFilter = new Set(filters.dispatchTypes);
    const dispatchCategoryFilter = new Set(filters.dispatchCategories);
    if (materialFilter.size === 0 && dispatchTypeFilter.size === 0 && dispatchCategoryFilter.size === 0) return allRows;
    const keepGroups = new Set();
    for (const row of allRows) {
      if (row.row_type !== "SKU") continue;
      if (dispatchTypeFilter.size > 0 && !dispatchTypeFilter.has(row.dispatch_type)) continue;
      if (dispatchCategoryFilter.size > 0 && !dispatchCategoryFilter.has(row.dispatch_category)) continue;
      keepGroups.add(row.group_key);
    }
    return allRows.filter((row) => keepGroups.has(row.group_key));
  }, [allRows, filters.materialValues, filters.dispatchTypes, filters.dispatchCategories]);

  const [globalSearch, setGlobalSearch] = useState("");
  function getColumnFilterText(column, row) {
    if (typeof column.copyValue === "function") return String(column.copyValue(row) ?? "");
    const raw = row?.[column.key];
    return raw == null ? "" : String(raw);
  }
  // Same all-column autosuggest as SO04/PR24 -- every distinct value across
  // every column (up to 500) feeds the search box's <datalist>.
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

  const batchCount = useMemo(() => new Set(rows.filter((r) => r.row_type === "SKU").map((r) => r.group_key)).size, [rows]);

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
        fileName: `batch_costing_report_${filters.dateFrom}_${filters.dateTo}.xlsx`,
        sheetName: "Batch Costing Report",
        columns: GRID_COLUMNS,
        rows: filteredRows,
        getCellValue: (row, column) =>
          typeof column.excelValue === "function" ? column.excelValue(row)
            : typeof column.copyValue === "function" ? column.copyValue(row) : (row?.[column.key] ?? ""),
      });
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "BATCH_COSTING_REPORT_EXPORT_FAILED");
    } finally {
      setExporting(false);
    }
  }

  useScreenBackInterceptor(() => {
    if (page === 1) return false;
    setPage(1);
    return true;
  });
  useErpScreenHotkeys({
    focusPrimary: { perform: () => handleExecute() },
    refresh: { disabled: page === 1, perform: () => void reportQ.refetch() },
  });

  const activeError = error || (reportQ.error instanceof Error ? reportQ.error.message : "");

  return (
    <ErpScreenScaffold
      eyebrow="Accounts"
      title="Batch Costing Report"
      notices={activeError ? [{ key: "batch-costing-report-error", tone: "error", message: activeError }] : []}
      actions={
        page === 1
          ? [
              { key: "reset", label: "Reset", onClick: handleReset },
              { key: "execute", label: "Execute", tone: "primary", onClick: handleExecute },
            ]
          : [
              { key: "back", label: "Back to Filters", hint: "Esc", onClick: () => setPage(1) },
              { key: "export", label: exporting ? "Exporting..." : "Export Excel", onClick: () => void handleExport(), disabled: exporting || filteredRows.length === 0 },
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

              <div className="flex items-center justify-between border-t border-dashed border-slate-200 pt-3">
                <span className="text-xs text-slate-400">MTO/HPS dispatches only, where SO Stroke ≠ Dispatched Stroke.</span>
                <button type="button" onClick={handleExecute} className="rounded bg-sky-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-sky-700">
                  Execute
                </button>
              </div>
            </div>
          </ErpSectionCard>
        </div>
      ) : (
        <div className="grid gap-4">
          <ErpSectionCard eyebrow="Page 2" title={`Batch Costing Report (${filters.dateFrom} to ${filters.dateTo})`}>
            <div className="mb-2 flex items-center justify-between">
              <button type="button" onClick={() => setPage(1)} className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
                Back to Filters
              </button>
              <span className="text-xs text-slate-500">
                {reportQ.isLoading ? "Loading..." : `${batchCount} mismatched batch${batchCount === 1 ? "" : "es"} · ${filteredRows.length} row${filteredRows.length === 1 ? "" : "s"}`}
              </span>
            </div>
            <div className="mb-2 flex items-center gap-2">
              <input
                list="batch-costing-report-search-options"
                value={globalSearch}
                onChange={(e) => setGlobalSearch(e.target.value)}
                placeholder="Search across every column..."
                className="h-8 w-full max-w-md rounded border border-slate-300 bg-white px-2.5 text-sm text-slate-800 outline-none focus:border-sky-500"
              />
              <datalist id="batch-costing-report-search-options">
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
              rowKey={(row) => row.row_key}
              virtualize
              rangeSelect
              maxHeight="calc(100vh - 260px)"
              getRowProps={(row) => ({ className: ROW_TYPE_BAND[row.row_type] ?? "" })}
              emptyMessage={
                reportQ.isLoading
                  ? "Loading..."
                  : hasActiveSearch
                    ? "No rows match this search."
                    : "No Stroke-mismatched dispatches in this range."
              }
            />
          </ErpSectionCard>
        </div>
      )}
    </ErpScreenScaffold>
  );
}
