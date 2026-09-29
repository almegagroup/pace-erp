/*
 * PIDifferenceReportPage — MI20 (IN07), §119.15. Standalone, own resourceCode
 * (PROC_PI_DIFFERENCES, "everyone" per §119.5) — cross-document report, not a companion of any
 * single PID. Shows both posted AND pending differences (matches SAP MI20's review-before-post use).
 *
 * §Q6-2026-09-29 (business owner, full SAP-parity rebuild) — the backend already supported
 * multi-value Material/Storage Location filters and this page never exposed them; Document
 * Number/Batch Number were single free-text substring boxes instead of a real multi-select list.
 * Rebuilt as a 2-page IN02-style report: Page 1 (multi-value filters via MultiValueFilterField,
 * matching SAP MI20's own range/multi-select selection screen) -> Page 2 (ErpDenseGrid output,
 * virtualized + range-select for Excel-like navigation, Export Excel, saved column layouts
 * reusing the same erp_inventory.report_column_layout mechanism IN02 built first).
 */
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import ErpColumnVisibilityDrawer from "../../../../components/ErpColumnVisibilityDrawer.jsx";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import MultiValueFilterField from "../../../../components/inputs/MultiValueFilterField.jsx";
import TransactionCompanySelector from "../../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../../components/inputs/transactionCompanyRuntime.js";
import ErpScreenScaffold, {
  ErpFieldPreview,
  ErpSectionCard,
} from "../../../../components/templates/ErpScreenScaffold.jsx";
import { MASTER_PICKER_FETCH_LIMIT, useMaterialOptionsQuery, useStorageLocationOptionsQuery } from "../../../../hooks/queries/useOmMasterQueries.js";
import { useMenu } from "../../../../context/useMenu.js";
import { useErpScreenHotkeys } from "../../../../hooks/useErpScreenHotkeys.js";
import { useScreenBackInterceptor } from "../../../../hooks/useScreenBackInterceptor.js";
import { openScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import { downloadCsvFile } from "../../../../shared/downloadTabularFile.js";
import {
  createReportLayout,
  deleteReportLayout,
  listPIDifferences,
  listReportLayouts,
  searchPIBatchNumbers,
  searchPIDocumentNumbers,
  setDefaultReportLayout,
} from "../procurementApi.js";

const REPORT_CODE = "MI20";
const DIFF_TYPE_OPTIONS = ["", "GAIN", "LOSS", "ZERO"];
const STATUS_OPTIONS = ["", "OPEN", "COUNTED", "PENDING_APPROVAL", "POSTED", "CANCELLED"];

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString("en-GB");
}

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function toneForDifference(value) {
  if (value < 0) return "text-rose-700";
  if (value > 0) return "text-emerald-700";
  return "text-slate-500";
}

function joinSelectedValues(entries) {
  return (Array.isArray(entries) ? entries : []).map((entry) => entry.value).filter(Boolean).join(",");
}

function findLayout(layouts, layoutId) {
  return layouts.find((layout) => layout.id === layoutId) || null;
}

const COLUMN_DEFINITIONS = [
  { key: "pi_document_number", label: "PID #", width: "130px" },
  { key: "pi_status", label: "PID Status", width: "120px" },
  { key: "count_date", label: "Count Date", width: "110px", render: (row) => formatDate(row.count_date), copyValue: (row) => formatDate(row.count_date) },
  { key: "posting_date", label: "Posting Date", width: "110px", render: (row) => formatDate(row.posting_date), copyValue: (row) => formatDate(row.posting_date) },
  { key: "company_code", label: "Company", width: "110px", render: (row) => row.company_code ?? "—" },
  { key: "storage_location_name", label: "Location", width: "140px", render: (row) => row.storage_location_code ?? "—", copyValue: (row) => row.storage_location_code },
  { key: "material_name", label: "Material", width: "260px", render: (row) => row.material_name ?? "—" },
  { key: "material_external_code", label: "External Code", width: "150px", render: (row) => row.material_external_code ?? "—" },
  { key: "batch_number", label: "Batch", width: "100px", render: (row) => row.batch_number ?? "—" },
  // §Q1-followup-2026-09-29 — an FG row is keyed by batch_number + packing_order_id together.
  { key: "packing_order_number", label: "Packing PO", width: "120px", render: (row) => row.packing_order_number ?? "—" },
  { key: "stock_type", label: "Stock Type", width: "130px" },
  { key: "book_qty", label: "Book Qty", width: "100px" },
  { key: "physical_qty", label: "Physical Qty", width: "100px", render: (row) => row.physical_qty ?? "—" },
  {
    key: "difference_qty",
    label: "Difference",
    width: "100px",
    render: (row) => <span className={`font-semibold ${toneForDifference(Number(row.difference_qty))}`}>{Number(row.difference_qty).toFixed(4)}</span>,
    copyValue: (row) => Number(row.difference_qty).toFixed(4),
  },
  { key: "difference_pct", label: "Diff %", width: "80px", render: (row) => (row.difference_pct === null ? "—" : `${row.difference_pct}%`) },
  {
    key: "difference_value",
    label: "Difference Value",
    width: "140px",
    align: "right",
    // Matches SAP MI20's own Difference Value column. Posted rows show the rate actually used
    // at posting (a fact); pending rows show today's live WAR as a preview.
    render: (row) => (
      <span className={`font-semibold ${toneForDifference(Number(row.difference_value))}`}>
        {Number(row.difference_value ?? 0).toFixed(2)}
        {row.status_label !== "POSTED" ? <span className="ml-1 font-normal text-slate-400">(est.)</span> : null}
      </span>
    ),
    copyValue: (row) => Number(row.difference_value ?? 0).toFixed(2),
  },
  { key: "base_uom_code", label: "UoM", width: "70px" },
  { key: "movement_type", label: "Movement", width: "90px", render: (row) => row.movement_type ?? "—" },
  { key: "counted_by_display", label: "Counted By", width: "170px", render: (row) => row.counted_by_display ?? "—" },
  { key: "counted_at", label: "Counted At", width: "150px", render: (row) => formatDateTime(row.counted_at), copyValue: (row) => formatDateTime(row.counted_at) },
  {
    key: "status_label",
    label: "Status",
    width: "90px",
    render: (row) => {
      const tone = row.status_label === "POSTED"
        ? "bg-emerald-100 text-emerald-800"
        : row.status_label === "CANCELLED"
        ? "bg-slate-200 text-slate-600"
        : "bg-amber-100 text-amber-800";
      return (
        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${tone}`}>
          {row.status_label === "POSTED" ? "Posted" : row.status_label === "CANCELLED" ? "Cancelled" : "Pending"}
        </span>
      );
    },
    copyValue: (row) => row.status_label,
  },
];
const DEFAULT_VISIBLE_COLUMNS = COLUMN_DEFINITIONS.map((column) => column.key);

function normalizeVisibleColumnKeys(candidateKeys) {
  const allowedKeys = new Set(DEFAULT_VISIBLE_COLUMNS);
  const normalized = (Array.isArray(candidateKeys) ? candidateKeys : []).filter((key) => allowedKeys.has(key));
  return normalized.length > 0 ? normalized : DEFAULT_VISIBLE_COLUMNS;
}

// Business owner ask (2026-09-03) — reuses copyValue when present so a
// JSX-rendered cell still filters against plain text.
function getColumnFilterText(column, row) {
  if (typeof column.copyValue === "function") return String(column.copyValue(row) ?? "");
  const raw = row?.[column.key];
  return raw == null ? "" : String(raw);
}

export default function PIDifferenceReportPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { runtimeContext } = useMenu();
  const canSaveGlobalLayout = runtimeContext?.roleCode === "SA" || runtimeContext?.roleCode === "GA";

  const [companyId, setCompanyId] = useState("");
  const effectiveCompanyId = companyId || resolveDefaultTransactionCompanyId(runtimeContext);

  const materialsQuery = useMaterialOptionsQuery(
    { status: "ACTIVE", limit: MASTER_PICKER_FETCH_LIMIT, company_id: effectiveCompanyId },
    { enabled: Boolean(effectiveCompanyId) },
  );
  const slocQuery = useStorageLocationOptionsQuery({ is_active: true, limit: 1000 });
  const materialOptions = useMemo(
    () => (materialsQuery.materials ?? []).map((material) => ({
      value: material.id,
      label: [material.material_name, material.document_name, material.external_code].filter(Boolean).join(" — ") || "—",
    })),
    [materialsQuery.materials],
  );
  const slocOptions = useMemo(
    () => (slocQuery.storageLocations ?? []).map((sloc) => ({
      value: sloc.id,
      label: sloc.code ? `${sloc.code}${sloc.name ? ` — ${sloc.name}` : ""}` : (sloc.name || sloc.id),
    })),
    [slocQuery.storageLocations],
  );

  const searchDocumentNumbers = async (queryText) => {
    const result = await searchPIDocumentNumbers({ q: queryText || undefined, company_id: effectiveCompanyId || undefined });
    return Array.isArray(result?.data) ? result.data : [];
  };
  const searchBatchNumbers = async (queryText) => {
    const result = await searchPIBatchNumbers({ q: queryText || undefined, company_id: effectiveCompanyId || undefined });
    return Array.isArray(result?.data) ? result.data : [];
  };

  const [documentNumberValues, setDocumentNumberValues] = useState([]);
  const [materialValues, setMaterialValues] = useState([]);
  const [slocValues, setSlocValues] = useState([]);
  const [batchValues, setBatchValues] = useState([]);
  const [status, setStatus] = useState("");
  const [differenceType, setDifferenceType] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [submittedFilters, setSubmittedFilters] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [page, setPage] = useState(1);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [activeLayoutId, setActiveLayoutId] = useState("");
  const [visibleColumns, setVisibleColumns] = useState(DEFAULT_VISIBLE_COLUMNS);
  const [columnSelectionTouched, setColumnSelectionTouched] = useState(false);

  const layoutsQuery = useQuery({
    queryKey: ["procurement-report-layouts", REPORT_CODE],
    queryFn: () => listReportLayouts({ report_code: REPORT_CODE }),
    select: (result) => ({
      layouts: Array.isArray(result?.data) ? result.data : [],
      defaultLayoutId: result?.default_layout_id ?? "",
    }),
  });

  const reportQuery = useQuery({
    queryKey: ["procurement-pi-differences", submittedFilters],
    enabled: Boolean(submittedFilters),
    queryFn: () => listPIDifferences(submittedFilters),
    select: (result) => (Array.isArray(result?.items) ? result.items : []),
  });
  const rows = useMemo(() => (Array.isArray(reportQuery.data) ? reportQuery.data : []), [reportQuery.data]);
  const activeError = error || (reportQuery.error instanceof Error ? reportQuery.error.message : "");

  const layoutOptions = useMemo(
    () => (layoutsQuery.data?.layouts ?? []).map((layout) => ({
      id: layout.id,
      label: `${layout.scope === "GLOBAL" ? "Global" : "User"} — ${layout.layout_name}`,
      scope: layout.scope,
      visible_columns: layout.visible_columns,
    })),
    [layoutsQuery.data],
  );

  const gridColumns = useMemo(
    () => COLUMN_DEFINITIONS.filter((column) => {
      const activeLayout = findLayout(layoutsQuery.data?.layouts ?? [], activeLayoutId);
      const defaultLayout = findLayout(layoutsQuery.data?.layouts ?? [], layoutsQuery.data?.defaultLayoutId ?? "");
      const effectiveVisibleColumns = activeLayout
        ? normalizeVisibleColumnKeys(activeLayout.visible_columns)
        : columnSelectionTouched
          ? visibleColumns
          : normalizeVisibleColumnKeys(defaultLayout?.visible_columns ?? visibleColumns);
      return effectiveVisibleColumns.includes(column.key);
    }),
    [activeLayoutId, columnSelectionTouched, layoutsQuery.data, visibleColumns],
  );

  useErpScreenHotkeys({
    refresh: { disabled: reportQuery.isFetching, perform: () => void handleSearch() },
  });

  useScreenBackInterceptor(() => {
    if (page !== 2) return false;
    setPage(1);
    return true;
  });

  async function handleSearch() {
    setError("");
    setNotice("");
    if (!effectiveCompanyId) {
      setError("Select a company first.");
      return;
    }
    setGlobalSearch("");
    const nextParams = {
      company_id: effectiveCompanyId,
      document_numbers: joinSelectedValues(documentNumberValues) || undefined,
      material_ids: joinSelectedValues(materialValues) || undefined,
      storage_location_ids: joinSelectedValues(slocValues) || undefined,
      batch_numbers: joinSelectedValues(batchValues) || undefined,
      status: status || undefined,
      difference_type: differenceType || undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
    };
    if (submittedFilters && JSON.stringify(submittedFilters) === JSON.stringify(nextParams)) {
      await reportQuery.refetch();
      setPage(2);
      return;
    }
    setSubmittedFilters(nextParams);
    setPage(2);
  }

  function handleApplyLayout(layoutId) {
    setActiveLayoutId(layoutId);
    setColumnSelectionTouched(false);
    if (!layoutId) {
      const defaultLayout = findLayout(layoutsQuery.data?.layouts ?? [], layoutsQuery.data?.defaultLayoutId ?? "");
      setVisibleColumns(normalizeVisibleColumnKeys(defaultLayout?.visible_columns ?? DEFAULT_VISIBLE_COLUMNS));
      return;
    }
    const layout = findLayout(layoutsQuery.data?.layouts ?? [], layoutId);
    setVisibleColumns(normalizeVisibleColumnKeys(layout?.visible_columns ?? DEFAULT_VISIBLE_COLUMNS));
  }

  async function handleSaveCurrentAs() {
    const layoutName = window.prompt("Layout name");
    if (!layoutName || !layoutName.trim()) return;
    const scope = canSaveGlobalLayout && window.confirm("Save as Global layout?\nPress OK for Global, Cancel for User.")
      ? "GLOBAL"
      : "USER";
    try {
      setError("");
      setNotice("");
      await createReportLayout({ report_code: REPORT_CODE, scope, layout_name: layoutName.trim(), visible_columns: visibleColumns });
      await queryClient.invalidateQueries({ queryKey: ["procurement-report-layouts", REPORT_CODE] });
      setNotice("Layout saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "REPORT_LAYOUT_CREATE_FAILED");
    }
  }

  async function handleSetDefaultLayout() {
    if (!activeLayoutId) {
      setError("Select a saved layout first.");
      return;
    }
    try {
      setError("");
      setNotice("");
      await setDefaultReportLayout(activeLayoutId);
      await queryClient.invalidateQueries({ queryKey: ["procurement-report-layouts", REPORT_CODE] });
      setNotice("Default layout updated.");
    } catch (setDefaultError) {
      setError(setDefaultError instanceof Error ? setDefaultError.message : "REPORT_LAYOUT_DEFAULT_SET_FAILED");
    }
  }

  async function handleDeleteLayout(layoutId) {
    if (!layoutId || !window.confirm("Delete this saved layout?")) return;
    try {
      setError("");
      setNotice("");
      await deleteReportLayout(layoutId);
      setActiveLayoutId("");
      setColumnSelectionTouched(false);
      await queryClient.invalidateQueries({ queryKey: ["procurement-report-layouts", REPORT_CODE] });
      setNotice("Layout deleted.");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "REPORT_LAYOUT_DELETE_FAILED");
    }
  }

  const gainCount = rows.filter((row) => Number(row.difference_qty) > 0).length;
  const lossCount = rows.filter((row) => Number(row.difference_qty) < 0).length;
  const pendingCount = rows.filter((row) => row.status_label === "PENDING").length;

  const [globalSearch, setGlobalSearch] = useState("");
  const globalSearchOptions = useMemo(() => {
    const values = new Set();
    outer: for (const row of rows) {
      for (const column of gridColumns) {
        const text = getColumnFilterText(column, row);
        if (text) values.add(text);
        if (values.size >= 500) break outer;
      }
    }
    return [...values].sort();
  }, [rows, gridColumns]);
  const hasActiveSearch = globalSearch.trim().length > 0;
  const filteredRows = useMemo(() => {
    const needle = globalSearch.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => gridColumns.some((column) => getColumnFilterText(column, row).toLowerCase().includes(needle)));
  }, [rows, gridColumns, globalSearch]);

  function handleExport() {
    if (filteredRows.length === 0) return;
    downloadCsvFile({
      fileName: `mi20_pi_differences_${dateFrom || "from"}_${dateTo || "to"}.csv`,
      columns: gridColumns.map((column) => ({ key: column.key, label: column.label })),
      // Exports whatever the search box currently shows, matching IN02's own convention.
      rows: filteredRows,
    });
  }

  function openPidDetail(row) {
    if (!row.pi_document_id) return;
    openScreen(OPERATION_SCREENS.PROC_PI_DETAIL.screen_code, { context: { id: row.pi_document_id } });
    navigate(`/dashboard/procurement/physical-inventory/${encodeURIComponent(row.pi_document_id)}`);
  }

  return (
    <ErpScreenScaffold
      eyebrow="Procurement Inventory"
      title="Physical Inventory — Difference Report"
      notices={[
        ...(error ? [{ key: "pi-diff-error", tone: "error", message: error }] : []),
        ...(!error && activeError ? [{ key: "pi-diff-query-error", tone: "error", message: activeError }] : []),
        ...(notice ? [{ key: "pi-diff-notice", tone: "success", message: notice }] : []),
        {
          key: "pi-diff-guide",
          tone: "info",
          message: "IN07 is the MI20-style cross-document review page. Filter by any combination of company, PID number(s), material, location, batch, status, or date range.",
        },
      ]}
      actions={
        page === 1
          ? [{ key: "search", label: reportQuery.isFetching ? "Searching..." : "Search", tone: "primary", hint: "F8", onClick: () => void handleSearch() }]
          : [
              { key: "back", label: "Back To Filters", tone: "neutral", hint: "Esc", onClick: () => setPage(1) },
              { key: "columns", label: "Columns", onClick: () => setColumnsOpen(true) },
              { key: "export", label: "Export Excel", onClick: handleExport, disabled: filteredRows.length === 0 },
              { key: "refresh", label: reportQuery.isFetching ? "Searching..." : "Search Again", tone: "primary", hint: "F8", onClick: () => void handleSearch() },
            ]
      }
    >
      <div className="grid gap-4">
        <div className="grid gap-4 xl:grid-cols-4">
          <ErpFieldPreview label="Step" value="MI20 Difference Report" tone="sky" />
          <ErpFieldPreview label="Page" value={page === 1 ? "Filters" : "Output Grid"} />
          <ErpFieldPreview label="Company Scope" value={effectiveCompanyId ? "Selected" : "Required"} />
          <ErpFieldPreview label="Loaded Rows" value={`${rows.length}`} caption={`Gain ${gainCount} · Loss ${lossCount} · Pending ${pendingCount}`} />
        </div>

        {page === 1 ? (
          <ErpSectionCard eyebrow="Page 1" title="Report Filters">
            <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              IN07 / MI20 review: compare gains, losses, and still-pending post rows without opening each PID individually. Every filter below accepts multiple values.
            </div>
            <div className="mt-3 grid gap-3">
              <TransactionCompanySelector runtimeContext={runtimeContext} value={companyId} onChange={setCompanyId} label="Company" />
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                <MultiValueFilterField
                  label="PID Document Number"
                  placeholder="All PID documents"
                  value={documentNumberValues}
                  onChange={setDocumentNumberValues}
                  searchFn={searchDocumentNumbers}
                />
                <MultiValueFilterField
                  label="Material"
                  placeholder="All materials"
                  value={materialValues}
                  onChange={setMaterialValues}
                  options={materialOptions}
                  loadError={!effectiveCompanyId ? "Company not resolved yet — select Company above." : materialsQuery.isError ? `${materialsQuery.error?.code ?? ""} ${materialsQuery.error?.message ?? "Unknown error"}`.trim() : ""}
                />
                <MultiValueFilterField
                  label="Storage Location"
                  placeholder="All storage locations"
                  value={slocValues}
                  onChange={setSlocValues}
                  options={slocOptions}
                  loadError={slocQuery.isError ? `${slocQuery.error?.code ?? ""} ${slocQuery.error?.message ?? "Unknown error"}`.trim() : ""}
                />
                <MultiValueFilterField
                  label="Batch Number"
                  placeholder="All batch numbers"
                  value={batchValues}
                  onChange={setBatchValues}
                  searchFn={searchBatchNumbers}
                />
                <label className="grid gap-1 text-sm text-slate-700">
                  <span className="font-medium text-slate-800">Status</span>
                  <select value={status} onChange={(event) => setStatus(event.target.value)} className="h-9 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500">
                    {STATUS_OPTIONS.map((entry) => (<option key={entry || "ALL"} value={entry}>{entry || "ALL"}</option>))}
                  </select>
                </label>
                <label className="grid gap-1 text-sm text-slate-700">
                  <span className="font-medium text-slate-800">Difference Type</span>
                  <select value={differenceType} onChange={(event) => setDifferenceType(event.target.value)} className="h-9 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500">
                    {DIFF_TYPE_OPTIONS.map((entry) => (<option key={entry || "ALL"} value={entry}>{entry || "ALL"}</option>))}
                  </select>
                </label>
                <label className="grid gap-1 text-sm text-slate-700">
                  <span className="font-medium text-slate-800">Posting Date From</span>
                  <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="h-9 w-full border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-500" />
                </label>
                <label className="grid gap-1 text-sm text-slate-700">
                  <span className="font-medium text-slate-800">Posting Date To</span>
                  <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="h-9 w-full border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-500" />
                </label>
              </div>

              <div className="grid gap-2 md:grid-cols-3">
                <div className="rounded border border-slate-200 bg-white px-3 py-2">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Gain</div>
                  <div className="mt-1 text-base font-semibold text-emerald-700">{gainCount}</div>
                </div>
                <div className="rounded border border-slate-200 bg-white px-3 py-2">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Loss</div>
                  <div className="mt-1 text-base font-semibold text-rose-700">{lossCount}</div>
                </div>
                <div className="rounded border border-slate-200 bg-white px-3 py-2">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Pending Post</div>
                  <div className="mt-1 text-base font-semibold text-sky-700">{pendingCount}</div>
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => void handleSearch()}
                  disabled={!effectiveCompanyId || reportQuery.isFetching}
                  className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {reportQuery.isFetching ? "Searching..." : "Search"}
                </button>
              </div>
            </div>
          </ErpSectionCard>
        ) : (
          <ErpSectionCard eyebrow="Page 2" title={reportQuery.isFetching ? "Loading Differences" : `${rows.length} Difference Row${rows.length === 1 ? "" : "s"}`}>
            <div className="mb-2 flex items-center gap-2">
              <input
                list="pi-diff-search-options"
                value={globalSearch}
                onChange={(event) => setGlobalSearch(event.target.value)}
                placeholder="Search across every visible column..."
                className="h-8 w-full max-w-md rounded border border-slate-300 bg-white px-2.5 text-sm text-slate-800 outline-none focus:border-sky-500"
              />
              <datalist id="pi-diff-search-options">
                {globalSearchOptions.map((option) => <option key={option} value={option} />)}
              </datalist>
              {hasActiveSearch ? (
                <>
                  <button type="button" onClick={() => setGlobalSearch("")} className="h-8 rounded border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-100">
                    Clear
                  </button>
                  <span className="text-xs text-slate-500">{filteredRows.length} of {rows.length} rows</span>
                </>
              ) : null}
            </div>
            <div className="mb-2 text-xs text-slate-500">Double-click a row to open its PID document (MI02/MI03).</div>
            <ErpDenseGrid
              virtualize
              rangeSelect
              columns={gridColumns}
              rows={filteredRows}
              rowKey={(row, index) => `${row.pi_document_id}-${index}`}
              onRowActivate={openPidDetail}
              getRowProps={(row) => ({ onDoubleClick: () => openPidDetail(row), className: "cursor-pointer hover:bg-sky-50" })}
              emptyMessage={reportQuery.isFetching ? "Loading differences..." : hasActiveSearch ? "No rows match this search." : "No differences found for this filter."}
              maxHeight="620px"
            />
          </ErpSectionCard>
        )}
      </div>

      <ErpColumnVisibilityDrawer
        visible={columnsOpen}
        columns={COLUMN_DEFINITIONS}
        visibleColumnKeys={visibleColumns}
        layoutOptions={layoutOptions}
        activeLayoutId={activeLayoutId}
        defaultLayoutId={layoutsQuery.data?.defaultLayoutId ?? ""}
        onSelectLayout={handleApplyLayout}
        onSaveCurrentAs={handleSaveCurrentAs}
        onSetDefaultLayout={handleSetDefaultLayout}
        onDeleteLayout={handleDeleteLayout}
        onToggleColumn={(columnKey) =>
          setVisibleColumns((current) => {
            setActiveLayoutId("");
            setColumnSelectionTouched(true);
            if (current.includes(columnKey)) {
              return current.length === 1 ? current : current.filter((entry) => entry !== columnKey);
            }
            return [...current, columnKey];
          })
        }
        onResetColumns={() => {
          setActiveLayoutId("");
          setColumnSelectionTouched(false);
          setVisibleColumns(DEFAULT_VISIBLE_COLUMNS);
        }}
        onClose={() => setColumnsOpen(false)}
      />
    </ErpScreenScaffold>
  );
}
