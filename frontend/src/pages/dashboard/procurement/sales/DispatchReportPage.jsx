/*
 * File-Path: frontend/src/pages/dashboard/procurement/sales/DispatchReportPage.jsx
 * Domain: PROCUREMENT / Sales
 * Purpose: SO04 -- item-wise Dispatch Report (Tally reconciliation view). One
 *          row per posted invoice + material; a mandatory Tally Invoice Date
 *          range drives the query, same Page 1 (Filters) / Page 2 (Output
 *          Grid) split as IN02/PR24. Business owner ask (2026-09-05): the
 *          list must read in Tally Invoice Date order -- getDispatchReportHandler
 *          already sorts server-side by tally_invoice_date, then
 *          tally_invoice_number, then item; this page renders rows in that
 *          exact order and never re-sorts them client-side.
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
import { getDispatchReport } from "../procurementApi.js";

const TYPE_OPTIONS = ["RM", "PM", "INT", "SFG", "FG"];
const FG_TYPE_OPTIONS = ["MTO", "HPS", "MTS", "MTEST"];
const DISPATCH_TYPE_OPTIONS = ["DEPENDENT_DIRECT", "DEPENDENT_DEPOT", "INDEPENDENT_PARTY", "INDEPENDENT_PARTY_ASIAN_BILLED", "DEPENDENT_NO_INBOUND", "STO"];
const DISPATCH_CATEGORY_OPTIONS = ["RPS", "SRPS", "FRPS", "FSRPS"];
const MAX_RANGE_DAYS = 366;

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
function daysAgoIso(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function formatQty(value) {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount.toLocaleString(undefined, { maximumFractionDigits: 3 }) : "—";
}
function formatMoney(value) {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";
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

// A declared SO Stroke that doesn't match this SKU's own valid MTO/HPS
// applicability (getDispatchReportHandler's buildStrokeValidation) renders
// in red so a Tally-reconciliation reviewer spots a mismatched stroke entry
// without opening the source SO.
function StrokeCell({ entries }) {
  if (!Array.isArray(entries) || entries.length === 0) return "—";
  return (
    <span className="whitespace-pre-line">
      {entries.map((entry, index) => (
        <span key={`${entry.value}-${index}`} className={entry.invalid ? "text-rose-600 font-semibold" : undefined}>
          {index > 0 ? "\n" : ""}
          {entry.value}
          {entry.invalid ? " ⚠" : ""}
        </span>
      ))}
    </span>
  );
}

// The grid's own StrokeCell renders the ⚠ marker via JSX, so Excel export
// (which reads copyValue/excelValue, never the rendered element) silently
// dropped it -- an invalid stroke looked identical to a valid one in the
// exported file. Business owner ask (2026-09-05): keep the same "⚠" marker
// text in the export.
function strokeExportValue(row) {
  if (!Array.isArray(row.so_stroke_entries)) return "";
  return row.so_stroke_entries.map((entry) => `${entry.value}${entry.invalid ? " ⚠" : ""}`).join(", ");
}

function getColumnFilterText(column, row) {
  if (typeof column.copyValue === "function") return String(column.copyValue(row) ?? "");
  const raw = row?.[column.key];
  return raw == null ? "" : String(raw);
}

const GRID_COLUMNS = [
  { key: "month_year", label: "Month-Year", width: "90px" },
  { key: "invoice_number", label: "PACE Invoice #", width: "130px", render: (r) => r.invoice_number || "—" },
  { key: "tally_invoice_date", label: "Tally Invoice Date", width: "120px" },
  { key: "tally_invoice_number", label: "Tally Invoice #", width: "130px" },
  { key: "inbound_number", label: "IBN", width: "110px", render: (r) => r.inbound_number || "—" },
  { key: "type", label: "Type", width: "70px" },
  { key: "fg_type", label: "FG Type", width: "80px", render: (r) => r.fg_type || "—" },
  { key: "dispatch_type", label: "Dispatch Type", width: "170px", render: (r) => r.dispatch_type || "—" },
  { key: "dispatch_category", label: "Category", width: "80px", render: (r) => r.dispatch_category || "—" },
  { key: "external_so_number", label: "External SO #", width: "130px", render: (r) => r.external_so_number || "—" },
  { key: "fo_number", label: "FO #", width: "110px", render: (r) => r.fo_number || "—" },
  { key: "item", label: "Item", width: "220px" },
  { key: "document_name", label: "Document Name", width: "200px", render: (r) => r.document_name || "—" },
  { key: "external_code", label: "External Code", width: "130px", render: (r) => r.external_code || "—" },
  { key: "item_category", label: "Item Category", width: "120px", render: (r) => r.item_category || "—" },
  { key: "batch_number", label: "Batch #", width: "110px", render: (r) => r.batch_number || "—" },
  { key: "packing_po_number", label: "Packing PO #", width: "120px", render: (r) => r.packing_po_number || "—" },
  {
    key: "so_stroke", label: "SO Stroke", width: "110px",
    render: (r) => <StrokeCell entries={r.so_stroke_entries} />,
    copyValue: strokeExportValue,
  },
  { key: "actual_stroke", label: "Actual Stroke", width: "100px", render: (r) => r.actual_stroke || "—" },
  { key: "pack_qty", label: "Pack Qty", align: "right", width: "90px", render: (r) => formatQty(r.pack_qty), excelValue: (r) => Number(r.pack_qty ?? 0), numFmt: "0.000" },
  { key: "pack_uom", label: "Pack UOM", width: "80px", render: (r) => r.pack_uom || "—" },
  { key: "base_qty", label: "Base Qty", align: "right", width: "100px", render: (r) => formatQty(r.base_qty), excelValue: (r) => Number(r.base_qty ?? 0), numFmt: "0.000" },
  { key: "base_uom", label: "Base UOM", width: "80px", render: (r) => r.base_uom || "—" },
  { key: "taxable", label: "Taxable", align: "right", width: "100px", render: (r) => formatMoney(r.taxable), excelValue: (r) => Number(r.taxable ?? 0), numFmt: "0.00" },
  { key: "cgst", label: "CGST", align: "right", width: "90px", render: (r) => formatMoney(r.cgst), excelValue: (r) => Number(r.cgst ?? 0), numFmt: "0.00" },
  { key: "sgst", label: "SGST", align: "right", width: "90px", render: (r) => formatMoney(r.sgst), excelValue: (r) => Number(r.sgst ?? 0), numFmt: "0.00" },
  { key: "igst", label: "IGST", align: "right", width: "90px", render: (r) => formatMoney(r.igst), excelValue: (r) => Number(r.igst ?? 0), numFmt: "0.00" },
  { key: "dispatch_value", label: "Dispatch Value", align: "right", width: "120px", render: (r) => formatMoney(r.dispatch_value), excelValue: (r) => Number(r.dispatch_value ?? 0), numFmt: "0.00" },
  { key: "parent_company_name", label: "Parent Company", width: "170px", render: (r) => r.parent_company_name || "—" },
  { key: "bill_to_party_name", label: "Bill-To Party", width: "200px", render: (r) => r.bill_to_party_name || "—" },
  { key: "ship_to_party_name", label: "Ship-To Party", width: "200px", render: (r) => r.ship_to_party_name || "—" },
  { key: "ship_to_site_town", label: "Ship-To Site / Town", width: "180px", render: (r) => r.ship_to_site_town || "—" },
  // Business owner ask (2026-09-05) -- the dispatching DO's own header data.
  // Driver Name + Contact Number are combined into one column; every other
  // transporter/vehicle/LR field gets its own column. Transporter Code and
  // Transporter Name are separate columns too (same-day follow-up ask).
  { key: "transporter_code", label: "Transporter Code", width: "130px", render: (r) => r.transporter_code || "—" },
  { key: "transporter_name", label: "Transporter Name", width: "170px", render: (r) => r.transporter_name || "—" },
  { key: "vehicle_number", label: "Vehicle Number", width: "120px", render: (r) => r.vehicle_number || "—" },
  { key: "lr_number", label: "LR Number", width: "110px", render: (r) => r.lr_number || "—" },
  { key: "lr_date", label: "LR Date", width: "100px", render: (r) => r.lr_date || "—" },
  { key: "gross_weight", label: "Gross Weight", align: "right", width: "100px", render: (r) => formatQty(r.gross_weight), excelValue: (r) => Number(r.gross_weight ?? 0), numFmt: "0.000" },
  { key: "net_weight", label: "Net Weight", align: "right", width: "100px", render: (r) => formatQty(r.net_weight), excelValue: (r) => Number(r.net_weight ?? 0), numFmt: "0.000" },
  { key: "driver_display", label: "Driver (Contact)", width: "160px", render: (r) => r.driver_display || "—" },
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

export default function DispatchReportPage() {
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
  // Page 1 (Filters) and Page 2 (Output Grid) are separate full-page views,
  // never both visible at once -- same pattern as IN02/PR24.
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
    queryKey: ["dispatch-report", submittedParams],
    queryFn: () => getDispatchReport(submittedParams),
    enabled: Boolean(submittedParams),
    select: (data) => (Array.isArray(data) ? data : data?.data ?? []),
  });
  // Server-side order is authoritative (tally_invoice_date -> tally_invoice_number
  // -> item, see dispatch_report.handlers.ts's final .sort()) -- never re-sort
  // this array on the frontend.
  const rows = useMemo(() => reportQ.data ?? [], [reportQ.data]);

  const [globalSearch, setGlobalSearch] = useState("");
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
    if (!effectiveCompanyId) {
      setError("Select a company first.");
      return;
    }
    if (!filters.dateFrom || !filters.dateTo) {
      setError("A Tally Invoice Date range is required.");
      return;
    }
    if (dateRangeInvalid(filters.dateFrom, filters.dateTo)) {
      setError("Date To cannot be before Date From.");
      return;
    }
    if (dateSpanTooWide(filters.dateFrom, filters.dateTo)) {
      setError(`Date range cannot exceed ${MAX_RANGE_DAYS} days.`);
      return;
    }
    const nextParams = {
      company_id: effectiveCompanyId,
      date_from: filters.dateFrom,
      date_to: filters.dateTo,
      types: filters.types.length > 0 ? filters.types.join(",") : undefined,
      fg_types: filters.fgTypes.length > 0 ? filters.fgTypes.join(",") : undefined,
      dispatch_types: filters.dispatchTypes.length > 0 ? filters.dispatchTypes.join(",") : undefined,
      dispatch_categories: filters.dispatchCategories.length > 0 ? filters.dispatchCategories.join(",") : undefined,
      material_ids: filters.materialValues.length > 0 ? filters.materialValues.map((v) => v.value).join(",") : undefined,
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
    if (filteredRows.length === 0) return;
    setExporting(true);
    try {
      const { downloadColoredExcelFile } = await import("../../../../shared/downloadColoredExcelFile.js");
      await downloadColoredExcelFile({
        fileName: `dispatch_report_${filters.dateFrom}_${filters.dateTo}.xlsx`,
        sheetName: "Dispatch Report",
        columns: GRID_COLUMNS,
        // Exports whatever the search box currently shows, matching ordinary
        // spreadsheet expectations ("export what I see") -- same as PR24.
        rows: filteredRows,
        getCellValue: (row, column) =>
          typeof column.excelValue === "function" ? column.excelValue(row)
            : typeof column.copyValue === "function" ? column.copyValue(row) : (row?.[column.key] ?? ""),
      });
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "DISPATCH_REPORT_EXPORT_FAILED");
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
      eyebrow="Sales Reports"
      title="Dispatch Report"
      notices={activeError ? [{ key: "dispatch-report-error", tone: "error", message: activeError }] : []}
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

              <div className="flex items-center justify-between border-t border-dashed border-slate-200 pt-3">
                <span className="text-xs text-slate-400">Item-wise dispatch, ordered by Tally Invoice Date.</span>
                <button type="button" onClick={handleExecute} className="rounded bg-sky-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-sky-700">
                  Execute
                </button>
              </div>
            </div>
          </ErpSectionCard>
        </div>
      ) : (
        <div className="grid gap-4">
          <ErpSectionCard eyebrow="Page 2" title={`Dispatch Report (${filters.dateFrom} to ${filters.dateTo})`}>
            <div className="mb-2 flex items-center justify-between">
              <button type="button" onClick={() => setPage(1)} className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
                Back to Filters
              </button>
              <span className="text-xs text-slate-500">
                {reportQ.isLoading
                  ? "Loading..."
                  : hasActiveSearch
                    ? `${filteredRows.length} of ${rows.length} row${rows.length === 1 ? "" : "s"} (filtered)`
                    : `${rows.length} row${rows.length === 1 ? "" : "s"}`}
              </span>
            </div>
            <div className="mb-2 flex items-center gap-2">
              <input
                list="dispatch-report-search-options"
                value={globalSearch}
                onChange={(e) => setGlobalSearch(e.target.value)}
                placeholder="Search across every column..."
                className="h-8 w-full max-w-md rounded border border-slate-300 bg-white px-2.5 text-sm text-slate-800 outline-none focus:border-sky-500"
              />
              <datalist id="dispatch-report-search-options">
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
