/*
 * File-ID: 24.2
 * File-Path: frontend/src/pages/dashboard/procurement/reports/StockLedgerReportPage.jsx
 * Gate: 24
 * Phase: 24
 * Domain: PROCUREMENT
 * Purpose: Redesigned stock ledger report with scoped filters, saved layouts, and CSV export.
 * Authority: Frontend
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ErpColumnVisibilityDrawer from "../../../../components/ErpColumnVisibilityDrawer.jsx";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import MultiValueFilterField from "../../../../components/inputs/MultiValueFilterField.jsx";
import TransactionCompanySelector from "../../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../../components/inputs/transactionCompanyRuntime.js";
import ErpScreenScaffold, {
  ErpSectionCard,
} from "../../../../components/templates/ErpScreenScaffold.jsx";
import { MASTER_PICKER_FETCH_LIMIT, useStorageLocationOptionsQuery, useMaterialOptionsQuery } from "../../../../hooks/queries/useOmMasterQueries.js";
import { useScreenBackInterceptor } from "../../../../hooks/useScreenBackInterceptor.js";
import { downloadCsvFile } from "../../../../shared/downloadTabularFile.js";
import { useMenu } from "../../../../context/useMenu.js";
import {
  createReportLayout,
  deleteReportLayout,
  getStockLedgerReport,
  listReportLayouts,
  listStockLedgerMovementTypes,
  searchStockLedgerBatchNumbers,
  searchStockLedgerPackingPoNumbers,
  setDefaultReportLayout,
} from "../procurementApi.js";

const REPORT_CODE = "IN02";
const DEFAULT_VISIBLE_COLUMNS = [
  "material_document_number",
  "material_document_item",
  "material_document_year",
  "posting_date",
  "company",
  "material_type",
  "material",
  "external_code",
  "storage_location",
  "batch_number",
  "movement_type",
  "base_quantity",
  "base_uom_code",
  "pack_quantity",
  "pack_uom_code",
  "value",
  "direction",
  "reference_document",
  "vendor_customer",
  "user_display",
  "entry_date_time",
];

function formatQuantity(value) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) {
    return "—";
  }
  return amount.toFixed(3);
}

function formatValue(value) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) {
    return "—";
  }
  return amount.toFixed(3);
}

function joinSelectedValues(entries) {
  return (Array.isArray(entries) ? entries : []).map((entry) => entry.value).filter(Boolean).join(",");
}

function buildReportParams(filters) {
  return {
    company_ids: filters.companyId || undefined,
    material_ids: joinSelectedValues(filters.materialValues) || undefined,
    storage_location_ids: joinSelectedValues(filters.slocValues) || undefined,
    batch_numbers: joinSelectedValues(filters.batchValues) || undefined,
    movement_type_codes: joinSelectedValues(filters.movementTypeValues) || undefined,
    packing_po_numbers: joinSelectedValues(filters.packingPoValues) || undefined,
    date_from: filters.dateFrom || undefined,
    date_to: filters.dateTo || undefined,
  };
}

// Business owner ask (2026-09-03), same pattern as PR24/PR14 — a single search
// box, client-side, on top of this report's own (already extensive) server-side
// filters. Filters against whichever columns are CURRENTLY VISIBLE (gridColumns
// reacts to the saved-layout/column-visibility picker), not the full column
// universe, so it always matches what's actually on screen.
function getColumnFilterText(column, row) {
  if (typeof column.copyValue === "function") return String(column.copyValue(row) ?? "");
  const raw = row?.[column.key];
  return raw == null ? "" : String(raw);
}

function findLayout(layouts, layoutId) {
  return layouts.find((layout) => layout.id === layoutId) || null;
}

function normalizeVisibleColumnKeys(candidateKeys, columnDefinitions) {
  const allowedKeys = new Set(columnDefinitions.map((column) => column.key));
  const normalized = (Array.isArray(candidateKeys) ? candidateKeys : []).filter((key) => allowedKeys.has(key));
  return normalized.length > 0 ? normalized : DEFAULT_VISIBLE_COLUMNS.filter((key) => allowedKeys.has(key));
}

function dateSpanTooWide(dateFrom, dateTo) {
  if (!dateFrom || !dateTo) {
    return false;
  }
  const from = new Date(`${dateFrom}T00:00:00.000Z`);
  const to = new Date(`${dateTo}T00:00:00.000Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return false;
  }
  return Math.floor((to.getTime() - from.getTime()) / 86400000) > 365;
}

function dateRangeInvalid(dateFrom, dateTo) {
  if (!dateFrom || !dateTo) {
    return false;
  }
  const from = new Date(`${dateFrom}T00:00:00.000Z`);
  const to = new Date(`${dateTo}T00:00:00.000Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return false;
  }
  return to.getTime() < from.getTime();
}

export default function StockLedgerReportPage() {
  const queryClient = useQueryClient();
  const { runtimeContext } = useMenu();
  const canSaveGlobalLayout = runtimeContext?.roleCode === "SA" || runtimeContext?.roleCode === "GA";

  // Business decision (2026-08-04): single company at a time, never multi —
  // same rule as IN03 (see CurrentStockPage.jsx). Single-company users get it
  // auto-resolved and locked; multi-company users pick exactly one from their
  // own allowed list via TransactionCompanySelector (Law 12 pattern).
  const [companyId, setCompanyId] = useState("");
  useEffect(() => {
    const defaultCompanyId = resolveDefaultTransactionCompanyId(runtimeContext);
    if (defaultCompanyId && !companyId) {
      setCompanyId(defaultCompanyId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtimeContext]);
  // Defensive fallback, not just a stopgap for the effect above: TransactionCompanySelector
  // itself already falls back to this same resolver for its own DISPLAY value
  // (see transactionCompanyRuntime.js) whenever the `companyId` state prop is
  // still empty -- so the Company field can visibly show the right company
  // while `companyId` state is still "" for a render or two. Anything reading
  // `companyId` directly (this query, the picker searchFns) must fall back to
  // the same resolver, or it can silently stay scoped to nothing while the
  // field looks populated. Investigated live 2026-08-11 (IN02/IN03 Material
  // picker reported empty) -- this closes the gap regardless of why state lags.
  const effectiveCompanyId = companyId || resolveDefaultTransactionCompanyId(runtimeContext);

  // Materials filter dropdown is scoped to the selected company (§8A gap
  // fix, 2026-08-05) -- material_master itself is global, so without this
  // the picker leaked every company's materials into every other company's
  // dropdown even though report execution itself was already scoped.
  const materialsQuery = useMaterialOptionsQuery(
    { status: "ACTIVE", limit: MASTER_PICKER_FETCH_LIMIT, company_id: effectiveCompanyId },
    { enabled: Boolean(effectiveCompanyId) },
  );
  const slocQuery = useStorageLocationOptionsQuery({ is_active: true, limit: 1000 });
  const movementTypesQuery = useQuery({
    queryKey: ["procurement-stock-ledger-movement-types"],
    queryFn: () => listStockLedgerMovementTypes(),
    select: (result) => result?.data ?? [],
  });

  const materialOptions = useMemo(
    () => (materialsQuery.materials ?? []).map((material) => ({
      value: material.id,
      label: `${material.pace_code ?? "—"} — ${material.document_name || material.material_name || "—"}`,
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
  const movementTypeOptions = useMemo(
    () => (Array.isArray(movementTypesQuery.data) ? movementTypesQuery.data : []).map((entry) => ({
      value: entry.value,
      label: entry.label,
    })),
    [movementTypesQuery.data],
  );
  // MultiValueFilterField's internal debounce effect depends on `searchFn` by
  // reference -- an inline arrow function here would be a NEW reference every
  // render, re-triggering that effect (and its "Searching…" loading flip) on
  // every parent re-render, not just when the user actually types. That's the
  // picker-drawer flicker/never-stabilizes bug reported live 2026-08-11.
  // useCallback keeps the reference stable across renders that don't change
  // companyId.
  const searchBatchNumbers = useCallback(
    async (queryText) => {
      const result = await searchStockLedgerBatchNumbers({
        q: queryText || undefined,
        company_ids: effectiveCompanyId || undefined,
      });
      return Array.isArray(result?.data) ? result.data : [];
    },
    [effectiveCompanyId],
  );
  const searchPackingPoNumbers = useCallback(
    async (queryText) => {
      const result = await searchStockLedgerPackingPoNumbers({
        q: queryText || undefined,
        company_ids: effectiveCompanyId || undefined,
      });
      return Array.isArray(result?.data) ? result.data : [];
    },
    [effectiveCompanyId],
  );
  const [materialValues, setMaterialValues] = useState([]);
  const [slocValues, setSlocValues] = useState([]);
  const [batchValues, setBatchValues] = useState([]);
  const [packingPoValues, setPackingPoValues] = useState([]);
  const [movementTypeValues, setMovementTypeValues] = useState([]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [submittedFilters, setSubmittedFilters] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [activeLayoutId, setActiveLayoutId] = useState("");
  const [visibleColumns, setVisibleColumns] = useState(DEFAULT_VISIBLE_COLUMNS);
  const [columnSelectionTouched, setColumnSelectionTouched] = useState(false);
  // Page 1 (Filters) and Page 2 (Output Grid) are separate full-page views,
  // like Process PO's step pages or SAP MB52/ZMB51's Execute -> report screen
  // — never both visible at once.
  const [page, setPage] = useState(1);

  const columnDefinitions = useMemo(
    () => [
      { key: "material_document_number", label: "Material Document Number", width: "170px" },
      { key: "material_document_item", label: "Material Doc. Item", width: "120px" },
      { key: "material_document_year", label: "Material Doc. Year", width: "120px" },
      { key: "posting_date", label: "Posting Date", width: "120px" },
      { key: "company", label: "Company", width: "220px" },
      { key: "material_type", label: "Type", width: "90px" },
      { key: "material", label: "Material", width: "280px" },
      { key: "external_code", label: "External Code", width: "180px" },
      { key: "document_name", label: "Document Name", width: "260px" },
      { key: "storage_location", label: "Storage Location", width: "120px" },
      { key: "batch_number", label: "Batch Number", width: "160px" },
      { key: "movement_type", label: "Movement Type", width: "170px" },
      { key: "base_quantity", label: "Posted Qty (Base)", width: "130px", align: "right", render: (row) => formatQuantity(row.base_quantity) },
      { key: "base_uom_code", label: "Base UoM", width: "90px" },
      { key: "pack_quantity", label: "Posted Qty (Pack)", width: "130px", align: "right", render: (row) => row.pack_quantity == null ? "—" : formatQuantity(row.pack_quantity) },
      { key: "pack_uom_code", label: "Pack UoM", width: "90px", render: (row) => row.pack_uom_code || "—" },
      { key: "value", label: "Posted Value", width: "120px", align: "right", render: (row) => formatValue(row.value) },
      { key: "direction", label: "Direction", width: "100px" },
      { key: "reference_document", label: "Reference Document", width: "170px" },
      { key: "vendor_customer", label: "Vendor / Customer", width: "260px" },
      { key: "user_display", label: "User", width: "220px" },
      { key: "entry_date_time", label: "Entry Date/Time", width: "180px" },
    ],
    [],
  );

  const layoutsQuery = useQuery({
    queryKey: ["procurement-report-layouts", REPORT_CODE],
    queryFn: () => listReportLayouts({ report_code: REPORT_CODE }),
    select: (result) => ({
      layouts: Array.isArray(result?.data) ? result.data : [],
      defaultLayoutId: result?.default_layout_id ?? "",
    }),
  });

  const reportQuery = useQuery({
    queryKey: ["procurement-stock-ledger-report", submittedFilters],
    enabled: Boolean(submittedFilters),
    queryFn: () => getStockLedgerReport(submittedFilters),
    select: (result) => result?.data ?? [],
  });

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
    () => columnDefinitions.filter((column) => {
      const activeLayout = findLayout(layoutsQuery.data?.layouts ?? [], activeLayoutId);
      const defaultLayout = findLayout(layoutsQuery.data?.layouts ?? [], layoutsQuery.data?.defaultLayoutId ?? "");
      const effectiveVisibleColumns = activeLayout
        ? normalizeVisibleColumnKeys(activeLayout.visible_columns, columnDefinitions)
        : columnSelectionTouched
          ? visibleColumns
          : normalizeVisibleColumnKeys(defaultLayout?.visible_columns ?? visibleColumns, columnDefinitions);
      return effectiveVisibleColumns.includes(column.key);
    }),
    [activeLayoutId, columnDefinitions, columnSelectionTouched, layoutsQuery.data, visibleColumns],
  );

  const reportRows = useMemo(() => (Array.isArray(reportQuery.data) ? reportQuery.data : []), [reportQuery.data]);
  const searchDisabled = !companyId || !dateFrom || !dateTo || dateSpanTooWide(dateFrom, dateTo) || dateRangeInvalid(dateFrom, dateTo);
  const activeError = error || (reportQuery.error instanceof Error ? reportQuery.error.message : "");

  // Single global search across every currently-visible column (business owner,
  // 2026-09-03) — client-side, on top of the server-side filters above.
  const [globalSearch, setGlobalSearch] = useState("");
  const globalSearchOptions = useMemo(() => {
    const values = new Set();
    outer: for (const row of reportRows) {
      for (const column of gridColumns) {
        const text = getColumnFilterText(column, row);
        if (text) values.add(text);
        if (values.size >= 500) break outer;
      }
    }
    return [...values].sort();
  }, [reportRows, gridColumns]);
  const hasActiveSearch = globalSearch.trim().length > 0;
  const filteredRows = useMemo(() => {
    const needle = globalSearch.trim().toLowerCase();
    if (!needle) return reportRows;
    return reportRows.filter((row) => gridColumns.some((column) => getColumnFilterText(column, row).toLowerCase().includes(needle)));
  }, [reportRows, gridColumns, globalSearch]);

  async function handleSearch() {
    setError("");
    setNotice("");
    setGlobalSearch("");
    if (!companyId) {
      setError("Select a company first.");
      return;
    }
    if (!dateFrom || !dateTo) {
      setError("Posting date range is required.");
      return;
    }
    if (dateSpanTooWide(dateFrom, dateTo)) {
      setError("Posting date range cannot exceed 365 days.");
      return;
    }
    if (dateRangeInvalid(dateFrom, dateTo)) {
      setError("Posting Date To cannot be earlier than Posting Date From.");
      return;
    }

    const nextParams = buildReportParams({
      companyId,
      materialValues,
      slocValues,
      batchValues,
      movementTypeValues,
      packingPoValues,
      dateFrom,
      dateTo,
    });
    if (submittedFilters && JSON.stringify(submittedFilters) === JSON.stringify(nextParams)) {
      await reportQuery.refetch();
      setPage(2);
      return;
    }
    setSubmittedFilters(nextParams);
    setPage(2);
  }

  // Esc / shell Back / browser Back from the output grid returns to the
  // filter page instead of leaving the screen entirely (§ shell back
  // interceptor — the shell's Escape handling runs in the capture phase,
  // ahead of any bubble-phase listener a page could register on its own).
  useScreenBackInterceptor(() => {
    if (page !== 2) return false;
    setPage(1);
    return true;
  });

  function handleApplyLayout(layoutId) {
    setActiveLayoutId(layoutId);
    setColumnSelectionTouched(false);
    if (!layoutId) {
      const defaultLayout = findLayout(layoutsQuery.data?.layouts ?? [], layoutsQuery.data?.defaultLayoutId ?? "");
      setVisibleColumns(normalizeVisibleColumnKeys(defaultLayout?.visible_columns ?? DEFAULT_VISIBLE_COLUMNS, columnDefinitions));
      return;
    }
    const layout = findLayout(layoutsQuery.data?.layouts ?? [], layoutId);
    setVisibleColumns(normalizeVisibleColumnKeys(layout?.visible_columns ?? DEFAULT_VISIBLE_COLUMNS, columnDefinitions));
  }

  async function handleSaveCurrentAs() {
    const layoutName = window.prompt("Layout name");
    if (!layoutName || !layoutName.trim()) {
      return;
    }
    const scope = canSaveGlobalLayout && window.confirm("Save as Global layout?\nPress OK for Global, Cancel for User.")
      ? "GLOBAL"
      : "USER";
    try {
      setError("");
      setNotice("");
      await createReportLayout({
        report_code: REPORT_CODE,
        scope,
        layout_name: layoutName.trim(),
        visible_columns: visibleColumns,
      });
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
    if (!layoutId) {
      return;
    }
    if (!window.confirm("Delete this saved layout?")) {
      return;
    }
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

  function handleExport() {
    if (filteredRows.length === 0) {
      return;
    }
    const csvColumns = gridColumns.map((column) => ({ key: column.key, label: column.label }));
    downloadCsvFile({
      fileName: `stock_ledger_${dateFrom || "from"}_${dateTo || "to"}.csv`,
      columns: csvColumns,
      // Exports whatever the search box currently shows, not the full fetch —
      // matches ordinary spreadsheet "export what I see" expectations.
      rows: filteredRows,
    });
  }

  return (
    <ErpScreenScaffold
      eyebrow="Inventory Reports"
      title="Stock Ledger"
      notices={[
        ...(error ? [{ key: "stock-ledger-error", tone: "error", message: error }] : []),
        ...(!error && activeError ? [{ key: "stock-ledger-query-error", tone: "error", message: activeError }] : []),
        ...(notice ? [{ key: "stock-ledger-notice", tone: "success", message: notice }] : []),
      ]}
      actions={
        page === 1
          ? [
              {
                key: "search",
                label: reportQuery.isFetching ? "Searching..." : "Search",
                tone: "primary",
                onClick: () => void handleSearch(),
                disabled: searchDisabled || reportQuery.isFetching,
              },
            ]
          : [
              {
                key: "back",
                label: "Back to Filters",
                hint: "Esc",
                onClick: () => setPage(1),
              },
              {
                key: "columns",
                label: "Columns",
                onClick: () => setColumnsOpen(true),
              },
              {
                key: "export",
                label: "Export Excel",
                onClick: handleExport,
                disabled: filteredRows.length === 0,
              },
              {
                key: "search",
                label: reportQuery.isFetching ? "Searching..." : "Search Again",
                tone: "primary",
                onClick: () => void handleSearch(),
                disabled: searchDisabled || reportQuery.isFetching,
              },
            ]
      }
    >
      {page === 1 ? (
      <div className="grid gap-4">
        <ErpSectionCard eyebrow="Page 1" title="Filters">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <TransactionCompanySelector
              runtimeContext={runtimeContext}
              value={companyId}
              onChange={setCompanyId}
              label="Company"
            />

            <MultiValueFilterField
              label="Material"
              placeholder="All materials"
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

            <MultiValueFilterField
              label="Packing PO Number"
              placeholder="All packing PO numbers"
              value={packingPoValues}
              onChange={setPackingPoValues}
              searchFn={searchPackingPoNumbers}
            />

            <MultiValueFilterField
              label="Movement Type"
              placeholder="All movement types"
              value={movementTypeValues}
              onChange={setMovementTypeValues}
              options={movementTypeOptions}
            />

            <label className="grid gap-1 text-sm text-slate-700">
              <span className="font-medium text-slate-800">Posting Date From</span>
              <input
                type="date"
                value={dateFrom}
                onChange={(event) => setDateFrom(event.target.value)}
                className="min-h-9 border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              />
            </label>

            <label className="grid gap-1 text-sm text-slate-700">
              <span className="font-medium text-slate-800">Posting Date To</span>
              <input
                type="date"
                value={dateTo}
                onChange={(event) => setDateTo(event.target.value)}
                className="min-h-9 border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              />
            </label>
          </div>

          {dateRangeInvalid(dateFrom, dateTo) ? (
            <div className="mt-3 text-sm text-rose-700">Posting Date To cannot be earlier than Posting Date From.</div>
          ) : null}

          {dateSpanTooWide(dateFrom, dateTo) ? (
            <div className="mt-3 text-sm text-rose-700">Posting date range cannot exceed 365 days.</div>
          ) : null}

          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={() => void handleSearch()}
              disabled={searchDisabled || reportQuery.isFetching}
              className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {reportQuery.isFetching ? "Searching..." : "Search"}
            </button>
          </div>
        </ErpSectionCard>
      </div>
      ) : (
      <div className="grid gap-4">
        <ErpSectionCard eyebrow="Page 2" title="Stock Ledger Output Grid">
          <div className="mb-3 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setPage(1)}
              className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-50"
            >
              Back to Filters
            </button>
            <div className="text-sm text-slate-600">
              {submittedFilters
                ? hasActiveSearch
                  ? `${filteredRows.length} of ${reportRows.length} rows (filtered)`
                  : `${reportRows.length} rows loaded`
                : "Set filters and click Search to load the stock ledger."}
            </div>
          </div>
          {submittedFilters ? (
            <div className="mb-3 flex items-center gap-2">
              <input
                list="stock-ledger-search-options"
                value={globalSearch}
                onChange={(event) => setGlobalSearch(event.target.value)}
                placeholder="Search across every visible column..."
                className="h-8 w-full max-w-md rounded border border-slate-300 bg-white px-2.5 text-sm text-slate-800 outline-none focus:border-sky-500"
              />
              <datalist id="stock-ledger-search-options">
                {globalSearchOptions.map((option) => <option key={option} value={option} />)}
              </datalist>
              {hasActiveSearch ? (
                <button type="button" onClick={() => setGlobalSearch("")} className="h-8 rounded border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-100">
                  Clear
                </button>
              ) : null}
            </div>
          ) : null}
          <ErpDenseGrid
            columns={gridColumns}
            rows={filteredRows}
            rowKey={(row) => row.row_key || row.id}
            emptyMessage={
              reportQuery.isFetching
                ? "Loading stock ledger..."
                : hasActiveSearch
                  ? "No rows match this search."
                  : "No stock ledger rows matched the selected filters."
            }
            virtualize
            rangeSelect
          />
        </ErpSectionCard>
      </div>
      )}

      <ErpColumnVisibilityDrawer
        visible={columnsOpen}
        columns={columnDefinitions}
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
