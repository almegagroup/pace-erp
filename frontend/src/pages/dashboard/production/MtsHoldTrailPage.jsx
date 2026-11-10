/*
 * File-Path: frontend/src/pages/dashboard/production/MtsHoldTrailPage.jsx
 * Purpose: IN15 "MTS FG Hold & Block Trail" -- two-page report (IN03 style): Page 1 filters, Page 2 output grid.
 *          Every MTS FG quantity put into Quality Inspection / Blocked at Verify, and what happened to it afterwards
 *          (IN13 status changes), with who / when / why. Spec: docs/superpowers/specs/2026-11-10-mts-hold-block-trail-design.md
 * Authority: Frontend
 *
 * Company is session-scoped (TransactionCompanySelector); the SKU picker is scoped to that company. No column is fixed.
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
import { getMtsHoldTrail } from "./prodApi.js";

const STATUS_OPTIONS = [
  { value: "QUALITY_INSPECTION", label: "Quality Inspection" },
  { value: "BLOCKED", label: "Blocked" },
];
const STOCK_LABEL = { UNRESTRICTED: "Unrestricted", QUALITY_INSPECTION: "Quality Inspection", BLOCKED: "Blocked" };
const EVENT_LABEL = { HOLD: "Hold (Verify)", STATUS_CHANGE: "Status change (IN13)" };
const DATE_INPUT_CLASS = "h-10 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500";
const DEFAULT_RANGE_DAYS = 30;

const dash = (value) => (value == null || value === "" ? "—" : value);
const stockLabel = (value) => STOCK_LABEL[value] ?? dash(value);
const formatQty = (value) => (value == null ? "—" : Number(value).toLocaleString("en-IN", { maximumFractionDigits: 3 }));

function istDate(offsetDays = 0) {
  return new Date(Date.now() + offsetDays * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}
function formatDay(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "2-digit", year: "numeric" });
}
function formatWhen(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}

// One definition feeds the grid, the Columns picker and the Excel. `value` = the raw Excel cell.
const text = (key, label, width, extra = {}) => ({
  key, label, width, render: (r) => dash(r[key]), filterValue: (r) => dash(r[key]), value: (r) => r[key] ?? "", ...extra,
});
const COLUMN_DEFINITIONS = [
  { key: "event_at", label: "Event Date-time", width: "150px", render: (r) => formatWhen(r.event_at), filterValue: (r) => formatWhen(r.event_at), value: (r) => formatWhen(r.event_at) },
  { key: "event_type", label: "Event", width: "150px", render: (r) => EVENT_LABEL[r.event_type] ?? dash(r.event_type), filterValue: (r) => EVENT_LABEL[r.event_type] ?? "—", value: (r) => EVENT_LABEL[r.event_type] ?? "" },
  text("company_code", "Company", "90px"),
  text("sku", "SKU", "260px"),
  text("process_order_number", "Process PO", "110px"),
  text("packing_order_number", "Packing PO", "110px"),
  text("batch_number", "Batch", "130px"),
  { key: "from_stock_type", label: "From", width: "140px", render: (r) => stockLabel(r.from_stock_type), filterValue: (r) => stockLabel(r.from_stock_type), value: (r) => stockLabel(r.from_stock_type) },
  { key: "to_stock_type", label: "To", width: "140px", render: (r) => stockLabel(r.to_stock_type), filterValue: (r) => stockLabel(r.to_stock_type), value: (r) => stockLabel(r.to_stock_type) },
  {
    key: "bags", label: "Bags", width: "80px", align: "right", numFmt: "#,##0.###",
    render: (r) => (r.bags == null ? "—" : formatQty(r.bags)), filterValue: (r) => (r.bags == null ? "—" : String(r.bags)), value: (r) => (r.bags == null ? "" : Number(r.bags)),
  },
  {
    key: "qty_kg", label: "Qty (KG)", width: "100px", align: "right", numFmt: "#,##0.###",
    render: (r) => formatQty(r.qty_kg), filterValue: (r) => String(r.qty_kg ?? "—"), value: (r) => Number(r.qty_kg ?? 0),
  },
  text("by", "By", "170px"),
  text("approved_by", "Approved By", "170px"),
  text("reason", "Reason / Remarks", "280px"),
  text("document_number", "Document", "120px"),
  text("state", "State", "170px"),
];
const PICKER_COLUMNS = COLUMN_DEFINITIONS.map((column) => ({ ...column, defaultHidden: false }));

function rowSearchText(row) {
  return COLUMN_DEFINITIONS.map((column) => String(column.value(row) ?? "")).join(" ").toLowerCase();
}

export default function MtsHoldTrailPage() {
  const { runtimeContext } = useMenu();

  // Page 1 (Filters) and Page 2 (Output Grid) are separate full-page views, like IN03 -- never both at once.
  const [page, setPage] = useState(1);
  const [companyId, setCompanyId] = useState("");
  const [dateFrom, setDateFrom] = useState(() => istDate(-DEFAULT_RANGE_DAYS));
  const [dateTo, setDateTo] = useState(() => istDate(0));
  const [materialValues, setMaterialValues] = useState([]);
  const [statuses, setStatuses] = useState([]);
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

  // SKU picker: finished goods only, scoped to the selected company (material_master itself is global).
  const materialsQuery = useMaterialOptionsQuery(
    { status: "ACTIVE", material_type: "FG", limit: MASTER_PICKER_FETCH_LIMIT, company_id: effectiveCompanyId },
    { enabled: Boolean(effectiveCompanyId) },
  );
  const materialOptions = useMemo(
    () => (materialsQuery.materials ?? []).map((material) => ({
      value: material.id,
      label: [material.material_name, material.document_name, material.external_code].filter(Boolean).join(" — ") || "—",
    })),
    [materialsQuery.materials],
  );

  const reportQuery = useQuery({
    queryKey: ["production", "mts-hold-trail", submittedParams],
    enabled: submittedParams != null,
    queryFn: () => getMtsHoldTrail(submittedParams),
  });
  const loading = reportQuery.isFetching;
  const error = reportQuery.error?.message ?? "";
  const allRows = useMemo(() => (Array.isArray(reportQuery.data?.items) ? reportQuery.data.items : []), [reportQuery.data]);
  const summaryRows = useMemo(() => (Array.isArray(reportQuery.data?.summary) ? reportQuery.data.summary : []), [reportQuery.data]);

  const displayedRows = useMemo(() => {
    const term = allColumnSearch.trim().toLowerCase();
    return term ? allRows.filter((row) => rowSearchText(row).includes(term)) : allRows;
  }, [allRows, allColumnSearch]);

  const layoutMessage = useCallback((message, tone) => pushToast({ message, tone }), []);
  const layout = useColumnLayouts("MTS_HOLD_TRAIL", PICKER_COLUMNS, layoutMessage);
  const gridColumns = layout.columns;

  const buildParams = useCallback(() => ({
    company_id: effectiveCompanyId,
    date_from: dateFrom,
    date_to: dateTo,
    // MultiValueFilterField holds [{ value, label }] entries: send the ids (joining the objects gave "[object Object]").
    material_ids: materialValues.map((entry) => entry.value).join(","),
    statuses: statuses.join(","),
  }), [effectiveCompanyId, dateFrom, dateTo, materialValues, statuses]);

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

  function toggleStatus(value) {
    setStatuses((current) => (current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value]));
  }

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
      await downloadColoredExcelFile({
        fileName: `mts_hold_block_trail_${companyCode}_exported_${fileStamp}.xlsx`,
        sheetName: "MTS Hold & Block Trail",
        columns: gridColumns,
        rows: gridRows,
        preambleRows: [
          ["Report", "MTS FG Hold & Block Trail (IN15)"],
          ["Company", company ? [company.company_code, company.company_name].filter(Boolean).join(" — ") : "-"],
          ["Event Date", `${criteria.date_from || "…"} to ${criteria.date_to || "…"}`],
          ["SKU", criteria.material_ids ? `${criteria.material_ids.split(",").length} selected` : "All"],
          ["Status", criteria.statuses ? criteria.statuses.split(",").map(stockLabel).join(", ") : "Quality Inspection + Blocked"],
          ...summaryRows.map((row) => [`Held now (all dates) — ${row.sku}`, `QI ${formatQty(row.qi_kg)} KG, Blocked ${formatQty(row.blocked_kg)} KG, last event ${formatDay(row.last_event_at)}`]),
          ...(allColumnSearch.trim() ? [["Search", allColumnSearch.trim()]] : []),
          ...(gridRows.length !== displayedRows.length ? [["Column Filters", "Applied (only the filtered rows are exported)"]] : []),
          ["Rows", gridRows.length],
          ["Export Date", `${exportStamp} IST`],
        ],
        getCellValue: (row, column) => (typeof column.value === "function" ? column.value(row) : (row?.[column.key] ?? "")),
      });
    } catch (failure) {
      setExportError(failure instanceof Error ? failure.message : "MTS_HOLD_TRAIL_EXPORT_FAILED");
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
      eyebrow="Quality"
      title="MTS FG Hold & Block Trail"
      notices={[
        ...(error ? [{ key: "mts-hold-trail-error", tone: "error", message: error }] : []),
        ...(exportError ? [{ key: "mts-hold-trail-export-error", tone: "error", message: exportError }] : []),
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
                Event Date from
                <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={DATE_INPUT_CLASS} />
              </label>
              <label className="grid gap-1 text-[11px] font-medium text-slate-600">
                Event Date to
                <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={DATE_INPUT_CLASS} />
              </label>
              <MultiValueFilterField
                label="SKU"
                placeholder="All SKUs"
                value={materialValues}
                onChange={setMaterialValues}
                options={materialOptions}
                loadError={
                  !effectiveCompanyId
                    ? "Company not resolved yet — select Company above."
                    : materialsQuery.isError
                      ? `${materialsQuery.error?.code ?? ""} ${materialsQuery.error?.message ?? "Unknown error"}`.trim()
                      : ""
                }
              />
              <fieldset className="grid gap-1 text-[11px] font-medium text-slate-600">
                <legend className="mb-1">Status {statuses.length === 0 ? "(both)" : ""}</legend>
                <div className="flex flex-wrap items-center gap-4 text-sm text-slate-800">
                  {STATUS_OPTIONS.map((option) => (
                    <label key={option.value} className="inline-flex items-center gap-1.5">
                      <input type="checkbox" checked={statuses.includes(option.value)} onChange={() => toggleStatus(option.value)} />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
            <p className="mt-3 text-xs text-slate-500">Only MTS finished goods held in Quality Inspection or Blocked.</p>
          </ErpSectionCard>
        </div>
      ) : (
        <div className="grid gap-4">
          <ErpSectionCard eyebrow="Page 2" title="Hold & Block Trail">
            {summaryRows.length > 0 ? (
              <div className="mb-4 rounded border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-600">Held right now, per SKU (KG) — all dates</p>
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full min-w-[620px] border-collapse text-sm">
                    <thead>
                      <tr className="text-xs uppercase tracking-wide text-slate-500">
                        <th className="border-b px-3 py-1.5 text-left">Company</th>
                        <th className="border-b px-3 py-1.5 text-left">SKU</th>
                        <th className="border-b px-3 py-1.5 text-right">In Quality Inspection</th>
                        <th className="border-b px-3 py-1.5 text-right">Blocked</th>
                        <th className="border-b px-3 py-1.5 text-right">Last event</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summaryRows.map((row) => (
                        <tr key={`${row.company_code}|${row.sku}`} className="border-b border-slate-100">
                          <td className="px-3 py-1.5">{row.company_code}</td>
                          <td className="px-3 py-1.5">{row.sku}</td>
                          <td className="px-3 py-1.5 text-right font-mono">{formatQty(row.qi_kg)}</td>
                          <td className="px-3 py-1.5 text-right font-mono">{formatQty(row.blocked_kg)}</td>
                          <td className="px-3 py-1.5 text-right font-mono">{formatDay(row.last_event_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-xs text-slate-600">All dates — the Event Date filter does not apply here.</p>
              </div>
            ) : null}
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <label className="min-w-[260px] flex-1 text-xs font-semibold uppercase tracking-[0.1em] text-slate-600">
                Search all columns
                <input
                  type="search"
                  value={allColumnSearch}
                  onChange={(event) => setAllColumnSearch(event.target.value)}
                  placeholder="SKU, batch, Process PO, reason, user, document..."
                  className="mt-1 h-9 w-full rounded border border-slate-300 bg-white px-3 text-sm font-normal normal-case tracking-normal text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                />
              </label>
              <span className="pb-2 text-sm text-slate-500">{loading ? "Loading..." : `${gridRows.length} of ${allRows.length} rows`}</span>
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
              emptyMessage={
                loading
                  ? "Loading..."
                  : error
                    ? "The report could not be loaded — see the error above."
                    : allColumnSearch.trim()
                      ? "No row matches this search."
                      : "No hold or block was recorded for these filters."
              }
            />
          </ErpSectionCard>
        </div>
      )}

      <ErpColumnVisibilityDrawer visible={columnsOpen} {...layoutDrawerProps(layout)} onClose={() => setColumnsOpen(false)} />
    </ErpScreenScaffold>
  );
}
