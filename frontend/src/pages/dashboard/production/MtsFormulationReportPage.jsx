/*
 * File-Path: frontend/src/pages/dashboard/production/MtsFormulationReportPage.jsx
 * Purpose: PR27 "MTS Formulation Report" -- two-page report (IN03 style): Page 1 filters, Page 2 output grid.
 *          For every VERIFIED MTS production: the SFG made and each RM / INT it used (Process PO block), then per
 *          Packing PO the SKU made and each PM it used (Packing block). Every line shows the Formulation material next
 *          to the Actual material, dosage, formulation qty, actual qty and variance. "Used For" is one code: SFG code
 *          for RM / INT, SKU code for PM.
 * Authority: Frontend
 *
 * Company is session-scoped (TransactionCompanySelector); the Prodshade / SKU pickers are scoped to that company.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ErpColumnVisibilityDrawer from "../../../components/ErpColumnVisibilityDrawer.jsx";
import { layoutDrawerProps, useColumnLayouts } from "../../../shared/columnLayouts/useColumnLayouts.js";
import { pushToast } from "../../../store/uiToast.js";
import MultiValueFilterField from "../../../components/inputs/MultiValueFilterField.jsx";
import TransactionCompanySelector from "../../../components/inputs/TransactionCompanySelector.jsx";
import { buildTransactionCompanyList, resolveDefaultTransactionCompanyId } from "../../../components/inputs/transactionCompanyRuntime.js";
import ErpDenseGrid from "../../../components/data/ErpDenseGrid.jsx";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import { useMenu } from "../../../context/useMenu.js";
import { MASTER_PICKER_FETCH_LIMIT, useMaterialOptionsQuery } from "../../../hooks/queries/useOmMasterQueries.js";
import { useScreenBackInterceptor } from "../../../hooks/useScreenBackInterceptor.js";
import { getMtsFormulationReport } from "./prodApi.js";

const DATE_INPUT_CLASS = "h-10 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500";
const DEFAULT_RANGE_DAYS = 30;
// Output rows (the SFG / SKU a block makes) are tinted, like the FG header rows of a bill of material.
const OUTPUT_ROW_FILL_ARGB = "FFE7EEF7";

const dash = (value) => (value == null || value === "" ? "—" : value);

function istDate(offsetDays = 0) {
  return new Date(Date.now() + offsetDays * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}
function formatDay(iso) {
  if (!iso) return "—";
  const date = new Date(`${iso}T00:00:00`);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" });
}
// Pieces (NOS) are whole numbers; everything else is weight, shown to 3 places.
const placesFor = (row) => (row.uom === "NOS" ? 0 : 3);
const formatNumber = (value, places) => (value == null ? "—" : Number(value).toLocaleString("en-IN", { minimumFractionDigits: places, maximumFractionDigits: places }));
const formatVariance = (row) => {
  if (row.variance == null) return "—";
  return `${row.variance > 0 ? "+" : ""}${formatNumber(row.variance, placesFor(row))}`;
};
const usedForText = (row) => (row.used_for_code ? `${row.used_for_kind} ${row.used_for_code}` : "—");

const text = (key, label, width, extra = {}) => ({
  key, label, width, render: (r) => dash(r[key]), filterValue: (r) => dash(r[key]), value: (r) => r[key] ?? "", ...extra,
});
const number = (key, label, width, places, extra = {}) => ({
  key, label, width, align: "right", numFmt: places === 0 ? "#,##0" : "#,##0.000",
  render: (r) => (r[key] == null ? "—" : formatNumber(r[key], places ?? placesFor(r))),
  filterValue: (r) => (r[key] == null ? "—" : String(r[key])),
  value: (r) => (r[key] == null ? "" : Number(r[key])),
  ...extra,
});

// One definition feeds the grid, the Columns picker and the Excel. `value` = the raw Excel cell.
const COLUMN_DEFINITIONS = [
  { key: "production_date", label: "Production Date", width: "120px", render: (r) => formatDay(r.production_date), filterValue: (r) => formatDay(r.production_date), value: (r) => formatDay(r.production_date) },
  text("po_kind", "PO Type", "90px"),
  text("po_number", "PO Number", "120px"),
  text("stroke_number", "Stroke", "80px", { align: "right" }),
  text("from_batch", "From Batch", "120px"),
  text("to_batch", "To Batch", "120px"),
  number("batch_count", "Batch Count", "100px", 0),
  text("line_type", "Type", "70px"),
  {
    key: "used_for", label: "Used For (SFG / SKU Code)", width: "190px",
    render: (r) => (r.used_for_code
      ? <span><span className="mr-1.5 text-[10px] font-semibold tracking-wider text-slate-500">{r.used_for_kind}</span>{r.used_for_code}</span>
      : "—"),
    filterValue: usedForText, value: usedForText,
  },
  text("formulation_material", "Formulation Material", "240px"),
  {
    key: "actual_material", label: "Actual Material", width: "270px",
    render: (r) => (r.substituted
      ? <span>{dash(r.actual_material)} <span className="ml-1 bg-amber-100 px-1.5 text-[10px] font-semibold uppercase tracking-wider text-amber-900">Substituted</span></span>
      : dash(r.actual_material)),
    filterValue: (r) => dash(r.actual_material), value: (r) => r.actual_material ?? "",
  },
  text("actual_external_code", "Actual Ext. Code", "130px"),
  number("dosage_pct", "Dosage %", "90px", 2),
  number("formulation_qty", "Formulation Qty", "130px"),
  number("actual_qty", "Actual Qty", "120px"),
  {
    key: "variance", label: "Variance", width: "110px", align: "right", numFmt: "#,##0.000",
    render: (r) => (
      <span className={r.variance == null || r.variance === 0 ? "text-slate-500" : r.variance < 0 ? "text-rose-700" : "text-emerald-700"}>{formatVariance(r)}</span>
    ),
    filterValue: formatVariance, value: (r) => (r.variance == null ? "" : Number(r.variance)),
  },
  text("uom", "UoM", "70px"),
];
const PICKER_COLUMNS = COLUMN_DEFINITIONS.map((column) => ({ ...column, defaultHidden: false }));

function rowSearchText(row) {
  return COLUMN_DEFINITIONS.map((column) => String(column.filterValue(row) ?? "")).join(" ").toLowerCase();
}
const isOutputRow = (row) => row?.line_type === "SFG" || row?.line_type === "FG";

export default function MtsFormulationReportPage() {
  const { runtimeContext } = useMenu();

  // Page 1 (Filters) and Page 2 (Output Grid) are separate full-page views, like IN03 -- never both at once.
  const [page, setPage] = useState(1);
  const [companyId, setCompanyId] = useState("");
  const [dateFrom, setDateFrom] = useState(() => istDate(-DEFAULT_RANGE_DAYS));
  const [dateTo, setDateTo] = useState(() => istDate(0));
  const [prodshadeValues, setProdshadeValues] = useState([]);
  const [skuValues, setSkuValues] = useState([]);
  const [submittedParams, setSubmittedParams] = useState(null);
  const [allColumnSearch, setAllColumnSearch] = useState("");
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  // Rows left after the grid's own column filters (funnel in each header) -- what the Excel exports.
  const [gridRows, setGridRows] = useState([]);

  useEffect(() => {
    const defaultCompanyId = resolveDefaultTransactionCompanyId(runtimeContext);
    if (defaultCompanyId && !companyId) setCompanyId(defaultCompanyId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtimeContext]);
  // The selector shows this fallback before `companyId` state catches up -- anything reading the company must use it too.
  const effectiveCompanyId = companyId || resolveDefaultTransactionCompanyId(runtimeContext);

  // Prodshade (SFG) and SKU (FG) pickers: scoped to the selected company (material_master itself is global).
  const prodshadesQuery = useMaterialOptionsQuery(
    { status: "ACTIVE", material_type: "SFG", limit: MASTER_PICKER_FETCH_LIMIT, company_id: effectiveCompanyId },
    { enabled: Boolean(effectiveCompanyId) },
  );
  const skusQuery = useMaterialOptionsQuery(
    { status: "ACTIVE", material_type: "FG", limit: MASTER_PICKER_FETCH_LIMIT, company_id: effectiveCompanyId },
    { enabled: Boolean(effectiveCompanyId) },
  );
  const toOptions = (materials) => (materials ?? []).map((material) => ({
    value: material.id,
    label: [material.material_name, material.document_name, material.external_code].filter(Boolean).join(" — ") || "—",
  }));
  const prodshadeOptions = useMemo(() => toOptions(prodshadesQuery.materials), [prodshadesQuery.materials]);
  const skuOptions = useMemo(() => toOptions(skusQuery.materials), [skusQuery.materials]);
  const loadErrorOf = (query) => (!effectiveCompanyId
    ? "Company not resolved yet — select Company above."
    : query.isError ? `${query.error?.code ?? ""} ${query.error?.message ?? "Unknown error"}`.trim() : "");

  const reportQuery = useQuery({
    queryKey: ["production", "mts-formulation-report", submittedParams],
    enabled: submittedParams != null,
    queryFn: () => getMtsFormulationReport(submittedParams),
  });
  const loading = reportQuery.isFetching;
  const error = reportQuery.error?.message ?? "";
  const allRows = useMemo(() => (Array.isArray(reportQuery.data?.items) ? reportQuery.data.items : []), [reportQuery.data]);

  const displayedRows = useMemo(() => {
    const term = allColumnSearch.trim().toLowerCase();
    return term ? allRows.filter((row) => rowSearchText(row).includes(term)) : allRows;
  }, [allRows, allColumnSearch]);
  const productionCount = useMemo(() => new Set(allRows.filter((row) => row.po_kind === "Process").map((row) => row.po_number)).size, [allRows]);

  const layoutMessage = useCallback((message, tone) => pushToast({ message, tone }), []);
  const layout = useColumnLayouts("MTS_FORMULATION_REPORT", PICKER_COLUMNS, layoutMessage);
  const gridColumns = layout.columns;

  const buildParams = useCallback(() => ({
    company_id: effectiveCompanyId,
    date_from: dateFrom,
    date_to: dateTo,
    // MultiValueFilterField holds [{ value, label }] entries: send the ids (joining the objects gave "[object Object]").
    prodshade_ids: prodshadeValues.map((entry) => entry.value).join(","),
    sku_ids: skuValues.map((entry) => entry.value).join(","),
  }), [effectiveCompanyId, dateFrom, dateTo, prodshadeValues, skuValues]);

  const handleSearch = useCallback(() => {
    if (!effectiveCompanyId || !dateFrom || !dateTo) return;
    const next = buildParams();
    setAllColumnSearch("");
    setExportError("");
    // Same criteria as the last run = same query key, so re-fetch instead of silently serving the cache.
    if (JSON.stringify(next) === JSON.stringify(submittedParams)) void reportQuery.refetch();
    else setSubmittedParams(next);
    setPage(2);
  }, [effectiveCompanyId, dateFrom, dateTo, buildParams, submittedParams, reportQuery]);

  // Exports exactly the rows on screen (criteria + search + column filters) in the visible columns, with the
  // report context and the export date-time above the header.
  async function handleExportExcel() {
    if (gridRows.length === 0) return;
    setExporting(true);
    setExportError("");
    try {
      const { downloadColoredExcelFile } = await import("../../../shared/downloadColoredExcelFile.js");
      const now = new Date();
      const exportStamp = now.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
      const fileStamp = now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
      const criteria = submittedParams ?? {};
      const company = buildTransactionCompanyList(runtimeContext).find((entry) => String(entry.id) === String(criteria.company_id));
      const companyCode = String(company?.company_code || "company").replace(/[^A-Za-z0-9_-]+/g, "_");
      const selected = (ids) => (ids ? `${ids.split(",").length} selected` : "All");
      await downloadColoredExcelFile({
        fileName: `mts_formulation_report_${companyCode}_exported_${fileStamp}.xlsx`,
        sheetName: "MTS Formulation",
        columns: gridColumns,
        rows: gridRows,
        preambleRows: [
          ["Report", "MTS Formulation Report (PR27)"],
          ["Company", company ? [company.company_code, company.company_name].filter(Boolean).join(" — ") : "-"],
          ["Production Date", `${criteria.date_from || "…"} to ${criteria.date_to || "…"}`],
          ["Prodshade", selected(criteria.prodshade_ids)],
          ["SKU", selected(criteria.sku_ids)],
          ...(allColumnSearch.trim() ? [["Search", allColumnSearch.trim()]] : []),
          ...(gridRows.length !== displayedRows.length ? [["Column Filters", "Applied (only the filtered rows are exported)"]] : []),
          ["Rows", gridRows.length],
          ["Export Date", `${exportStamp} IST`],
        ],
        getCellValue: (row, column) => (typeof column.value === "function" ? column.value(row) : (row?.[column.key] ?? "")),
        getRowFillArgb: (row) => (isOutputRow(row) ? OUTPUT_ROW_FILL_ARGB : null),
      });
    } catch (failure) {
      setExportError(failure instanceof Error ? failure.message : "MTS_FORMULATION_EXPORT_FAILED");
    } finally {
      setExporting(false);
    }
  }

  // Esc / shell Back from the output grid returns to the filter page instead of leaving the screen.
  useScreenBackInterceptor(() => {
    if (page !== 2) return false;
    setPage(1);
    return true;
  });

  // SAP-style Execute shortcut (F8), same as IN03.
  useEffect(() => {
    function handleExecuteShortcut(event) {
      if (event.key !== "F8" || loading) return;
      event.preventDefault();
      handleSearch();
    }
    window.addEventListener("keydown", handleExecuteShortcut);
    return () => window.removeEventListener("keydown", handleExecuteShortcut);
  }, [loading, handleSearch]);

  const searchAction = {
    key: "search",
    label: loading ? "Searching..." : page === 1 ? "Search" : "Search Again",
    tone: "primary",
    hint: "F8",
    onClick: handleSearch,
    disabled: loading || !effectiveCompanyId || !dateFrom || !dateTo,
  };

  return (
    <ErpScreenScaffold
      eyebrow="Production Reports"
      title="MTS Formulation Report"
      notices={[
        ...(error ? [{ key: "mts-formulation-error", tone: "error", message: error }] : []),
        ...(exportError ? [{ key: "mts-formulation-export-error", tone: "error", message: exportError }] : []),
      ]}
      actions={
        page === 1
          ? [searchAction]
          : [
              { key: "back", label: "Back to Filters", hint: "Esc", onClick: () => setPage(1) },
              { key: "columns", label: "Columns", onClick: () => setColumnsOpen(true) },
              {
                key: "export",
                label: exporting ? "Exporting..." : "Export Excel",
                onClick: () => void handleExportExcel(),
                disabled: exporting || gridRows.length === 0,
              },
              searchAction,
            ]
      }
    >
      {page === 1 ? (
        <div className="grid gap-4">
          <ErpSectionCard eyebrow="Page 1" title="Filters">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <TransactionCompanySelector runtimeContext={runtimeContext} value={companyId} onChange={setCompanyId} label="Company" />
              <label className="grid gap-1 text-[11px] font-medium text-slate-600">
                Production Date from
                <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={DATE_INPUT_CLASS} />
              </label>
              <label className="grid gap-1 text-[11px] font-medium text-slate-600">
                Production Date to
                <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={DATE_INPUT_CLASS} />
              </label>
              <MultiValueFilterField
                label="Prodshade"
                placeholder="All prodshades"
                value={prodshadeValues}
                onChange={setProdshadeValues}
                options={prodshadeOptions}
                loadError={loadErrorOf(prodshadesQuery)}
              />
              <MultiValueFilterField
                label="SKU"
                placeholder="All SKUs"
                value={skuValues}
                onChange={setSkuValues}
                options={skuOptions}
                loadError={loadErrorOf(skusQuery)}
              />
            </div>
            <p className="mt-3 text-xs text-slate-500">Verified MTS productions only.</p>
          </ErpSectionCard>
        </div>
      ) : (
        <div className="grid gap-4">
          <ErpSectionCard eyebrow="Page 2" title="Formulation Output Grid">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <label className="min-w-[260px] flex-1 text-xs font-semibold uppercase tracking-[0.1em] text-slate-600">
                Search all columns
                <input
                  type="search"
                  value={allColumnSearch}
                  onChange={(event) => setAllColumnSearch(event.target.value)}
                  placeholder="PO number, batch, material, code, stroke..."
                  className="mt-1 h-9 w-full rounded border border-slate-300 bg-white px-3 text-sm font-normal normal-case tracking-normal text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                />
              </label>
              <span className="pb-2 text-sm text-slate-500">
                {loading ? "Loading..." : `${gridRows.length} of ${allRows.length} rows · ${productionCount} productions`}
              </span>
            </div>
            <ErpDenseGrid
              // Excel-style: arrow-key cell navigation, range select + Ctrl+C, per-column AutoFilter (funnel in each header).
              rangeSelect
              columnFilter
              virtualize
              maxHeight="calc(100vh - 380px)"
              onFilteredRowsChange={setGridRows}
              columns={gridColumns}
              rows={displayedRows}
              rowKey={(row) => row.key}
              getRowProps={(row) => (isOutputRow(row) ? { className: "bg-sky-50 font-semibold" } : {})}
              emptyMessage={
                loading
                  ? "Loading..."
                  : error
                    ? "The report could not be loaded — see the error above."
                    : allColumnSearch.trim()
                      ? "No row matches this search."
                      : "No verified MTS production for these filters."
              }
            />
            <p className="mt-2 text-xs text-slate-500">Process PO: SFG, then the RM it used. Packing PO: SKU, then the PM it used.</p>
          </ErpSectionCard>
        </div>
      )}

      <ErpColumnVisibilityDrawer visible={columnsOpen} {...layoutDrawerProps(layout)} onClose={() => setColumnsOpen(false)} />
    </ErpScreenScaffold>
  );
}
