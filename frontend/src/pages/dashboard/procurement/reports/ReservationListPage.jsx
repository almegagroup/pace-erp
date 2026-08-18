/*
 * File-ID: 125.1
 * File-Path: frontend/src/pages/dashboard/procurement/reports/ReservationListPage.jsx
 * Gate: 125
 * Phase: 125
 * Domain: PROCUREMENT
 * Purpose: IN12 — Reservation List, SAP MB25-equivalent. See feasibility §125.
 * Authority: Frontend
 */

import { useMemo, useState } from "react";
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
  listReportLayouts,
  listReservations,
  setDefaultReportLayout,
} from "../procurementApi.js";

const REPORT_CODE = "IN12";
const DEFAULT_VISIBLE_COLUMNS = [
  "reservation_number",
  "source_type",
  "source_document",
  "company",
  "material",
  "external_code",
  "storage_location",
  "batch_number",
  "required_qty",
  "issued_qty",
  "balance_qty",
  "uom_code",
  "status",
  "required_by_date",
];

const SOURCE_TYPE_OPTIONS = [
  { value: "PROCESS_PO", label: "Process PO" },
  { value: "PACKING_PO", label: "Packing PO" },
  { value: "SALES_ORDER", label: "Sales order" },
  { value: "STO", label: "STO" },
  { value: "LOCATION_TRANSFER", label: "Location transfer" },
];

const STATUS_OPTIONS = [
  { value: "OPEN", label: "Open" },
  { value: "PARTIAL", label: "Partial" },
  { value: "FULLY_ISSUED", label: "Fully issued" },
  { value: "CANCELLED", label: "Cancelled" },
];

function formatQuantity(value) {
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
    source_types: joinSelectedValues(filters.sourceTypeValues) || undefined,
    statuses: filters.statuses.length > 0 ? filters.statuses.join(",") : undefined,
    date_from: filters.dateFrom || undefined,
    date_to: filters.dateTo || undefined,
  };
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

export default function ReservationListPage() {
  const queryClient = useQueryClient();
  const { runtimeContext } = useMenu();
  const canSaveGlobalLayout = runtimeContext?.roleCode === "SA" || runtimeContext?.roleCode === "GA";

  // Same Law-12 single-company pattern as IN02/IN03 — single-company users
  // get it auto-resolved and locked, multi-company users pick one.
  const [companyId, setCompanyId] = useState(() => resolveDefaultTransactionCompanyId(runtimeContext) || "");
  const effectiveCompanyId = companyId || resolveDefaultTransactionCompanyId(runtimeContext);

  const materialsQuery = useMaterialOptionsQuery(
    { status: "ACTIVE", limit: MASTER_PICKER_FETCH_LIMIT, company_id: effectiveCompanyId },
    { enabled: Boolean(effectiveCompanyId) },
  );
  const slocQuery = useStorageLocationOptionsQuery({ is_active: true, limit: 1000 });

  // Material column is name-only (document_name/material_name), matching
  // IN03 — not IN02's old combined pace_code+name format (§125, corrected
  // 2026-08-19). This picker's own dropdown label still shows pace_code
  // for search-ability, same as IN02/IN03's material pickers do — that's
  // a different, unrelated concern from what the results grid displays.
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

  const [materialValues, setMaterialValues] = useState([]);
  const [slocValues, setSlocValues] = useState([]);
  const [batchValues, setBatchValues] = useState([]);
  const [sourceTypeValues, setSourceTypeValues] = useState([]);
  const [statuses, setStatuses] = useState(["OPEN", "PARTIAL"]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [submittedFilters, setSubmittedFilters] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [activeLayoutId, setActiveLayoutId] = useState("");
  const [visibleColumns, setVisibleColumns] = useState(DEFAULT_VISIBLE_COLUMNS);
  const [columnSelectionTouched, setColumnSelectionTouched] = useState(false);
  // Page 1 (Filters) and Page 2 (Output Grid) are separate full-page views —
  // same split as IN02/IN03/PR14/PR24, never both visible at once.
  const [page, setPage] = useState(1);

  const columnDefinitions = useMemo(
    () => [
      { key: "reservation_number", label: "Reservation", width: "140px" },
      { key: "source_type", label: "Source Type", width: "130px" },
      { key: "source_document", label: "Source Document", width: "150px" },
      { key: "company", label: "Company", width: "110px" },
      { key: "material", label: "Material", width: "260px" },
      { key: "external_code", label: "External Code", width: "160px" },
      { key: "storage_location", label: "Storage Location", width: "130px" },
      { key: "batch_number", label: "Batch Number", width: "140px" },
      { key: "required_qty", label: "Required Qty", width: "120px", align: "right", render: (row) => formatQuantity(row.required_qty) },
      { key: "issued_qty", label: "Issued Qty", width: "120px", align: "right", render: (row) => formatQuantity(row.issued_qty) },
      { key: "balance_qty", label: "Balance Qty", width: "120px", align: "right", render: (row) => formatQuantity(row.balance_qty) },
      { key: "uom_code", label: "UoM", width: "80px" },
      { key: "status", label: "Status", width: "110px" },
      { key: "required_by_date", label: "Required By", width: "120px" },
      { key: "created_by", label: "Created By", width: "200px" },
      { key: "created_at", label: "Created At", width: "170px" },
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
    queryKey: ["procurement-reservation-list", submittedFilters],
    enabled: Boolean(submittedFilters),
    queryFn: () => listReservations(submittedFilters),
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

  const reportRows = Array.isArray(reportQuery.data) ? reportQuery.data : [];
  const searchDisabled = !companyId || !dateFrom || !dateTo || dateSpanTooWide(dateFrom, dateTo) || dateRangeInvalid(dateFrom, dateTo);
  const activeError = error || (reportQuery.error instanceof Error ? reportQuery.error.message : "");

  async function handleSearch() {
    setError("");
    setNotice("");
    if (!companyId) {
      setError("Select a company first.");
      return;
    }
    if (!dateFrom || !dateTo) {
      setError("Date range is required.");
      return;
    }
    if (dateSpanTooWide(dateFrom, dateTo)) {
      setError("Date range cannot exceed 365 days.");
      return;
    }
    if (dateRangeInvalid(dateFrom, dateTo)) {
      setError("Date To cannot be earlier than Date From.");
      return;
    }

    const nextParams = buildReportParams({
      companyId,
      materialValues,
      slocValues,
      batchValues,
      sourceTypeValues,
      statuses,
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
    if (reportRows.length === 0) {
      return;
    }
    const csvColumns = gridColumns.map((column) => ({ key: column.key, label: column.label }));
    downloadCsvFile({
      fileName: `reservation_list_${dateFrom || "from"}_${dateTo || "to"}.csv`,
      columns: csvColumns,
      rows: reportRows,
    });
  }

  function toggleStatus(value) {
    setStatuses((current) =>
      current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value]);
  }

  return (
    <ErpScreenScaffold
      eyebrow="Inventory Reports"
      title="Reservation List"
      notices={[
        ...(error ? [{ key: "reservation-list-error", tone: "error", message: error }] : []),
        ...(!error && activeError ? [{ key: "reservation-list-query-error", tone: "error", message: activeError }] : []),
        ...(notice ? [{ key: "reservation-list-notice", tone: "success", message: notice }] : []),
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
                disabled: reportRows.length === 0,
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
            />

            <MultiValueFilterField
              label="Source Type"
              placeholder="All source types"
              value={sourceTypeValues}
              onChange={setSourceTypeValues}
              options={SOURCE_TYPE_OPTIONS}
            />

            <label className="grid gap-1 text-sm text-slate-700">
              <span className="font-medium text-slate-800">Date From</span>
              <input
                type="date"
                value={dateFrom}
                onChange={(event) => setDateFrom(event.target.value)}
                className="min-h-9 border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              />
            </label>

            <label className="grid gap-1 text-sm text-slate-700">
              <span className="font-medium text-slate-800">Date To</span>
              <input
                type="date"
                value={dateTo}
                onChange={(event) => setDateTo(event.target.value)}
                className="min-h-9 border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              />
            </label>
          </div>

          <div className="mt-3">
            <span className="text-sm font-medium text-slate-800">Status</span>
            <div className="mt-1 flex flex-wrap gap-4">
              {STATUS_OPTIONS.map((option) => (
                <label key={option.value} className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={statuses.includes(option.value)}
                    onChange={() => toggleStatus(option.value)}
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </div>

          {dateRangeInvalid(dateFrom, dateTo) ? (
            <div className="mt-3 text-sm text-rose-700">Date To cannot be earlier than Date From.</div>
          ) : null}

          {dateSpanTooWide(dateFrom, dateTo) ? (
            <div className="mt-3 text-sm text-rose-700">Date range cannot exceed 365 days.</div>
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
        <ErpSectionCard eyebrow="Page 2" title="Reservation List Output Grid">
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
                ? `${reportRows.length} rows loaded`
                : "Set filters and click Search to load the reservation list."}
            </div>
          </div>
          <ErpDenseGrid
            columns={gridColumns}
            rows={reportRows}
            rowKey={(row) => row.id}
            emptyMessage={reportQuery.isFetching ? "Loading reservation list..." : "No reservations matched the selected filters."}
            virtualize
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
