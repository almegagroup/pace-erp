/*
 * File-ID: 130.1
 * File-Path: frontend/src/pages/dashboard/procurement/reports/StockHistoryPage.jsx
 * Gate: IN14
 * Domain: PROCUREMENT
 * Purpose: Stock History report — Opening -> per-business-event bucket columns -> Closing,
 *          one row per (Material, Stock Status, Storage Location), for a date range.
 *          Feasibility doc Section 130 is the design SSOT for this page.
 * Authority: Frontend
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import ErpColumnVisibilityDrawer from "../../../../components/ErpColumnVisibilityDrawer.jsx";
import MultiValueFilterField from "../../../../components/inputs/MultiValueFilterField.jsx";
import TransactionCompanySelector from "../../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../../components/inputs/transactionCompanyRuntime.js";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpScreenScaffold, {
  ErpSectionCard,
} from "../../../../components/templates/ErpScreenScaffold.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import {
  MASTER_PICKER_FETCH_LIMIT,
  useMaterialOptionsQuery,
  useStorageLocationOptionsQuery,
} from "../../../../hooks/queries/useOmMasterQueries.js";
import { useScreenBackInterceptor } from "../../../../hooks/useScreenBackInterceptor.js";
import { getStockHistory } from "../procurementApi.js";

const MATERIAL_TYPE_OPTIONS = ["RM", "PM", "INT", "SFG", "FG"].map((value) => ({ value, label: value }));

// §130.5 — fixed display order + label for each business-event bucket. The
// backend only ever returns a subset of these keys per row (visible_buckets
// tells us which columns actually carry a value anywhere in this executed
// report, per §130.12) — this map is purely presentation, the bucket_code
// -> movement_type mapping itself lives in the DB (stock_history_bucket_map).
const BUCKET_LABELS = {
  INWARD: "Inward",
  CONS: "Consumption",
  SALE_DISPATCH: "Sale / Dispatch",
  PID: "PID",
  QA: "QA",
  REJECT: "Reject",
  RETURN: "Return",
  RTV: "RTV",
  SCRAP: "Scrap",
  REPROCESS: "Reprocess",
  TRANSFER: "Transfer",
};
const BUCKET_ORDER = Object.keys(BUCKET_LABELS);

function joinValues(entries) {
  return entries.map((entry) => entry.value).join(",");
}

// §130.11 — no "+" on positive values; color follows the value's sign, not
// its column. Zero renders as "—" (a bucket can be individually zero on one
// row even though it's visible because some other row in the report needed
// it — §130.12 only hides a bucket that is zero on EVERY row). ARGB hex
// values mirror the on-screen Tailwind colors (emerald-700 / rose-700) so
// the §130.14 coloured Excel export matches the live grid exactly.
const POSITIVE_FONT_ARGB = "FF047857";
const NEGATIVE_FONT_ARGB = "FFBE123C";
const TOTAL_ROW_FILL_ARGB = "FFFFFBEB"; // amber-50, matches the Total row's on-screen fill

function formatSignedQuantity(value) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount) || Math.abs(amount) < 0.000001) {
    return { text: "—", className: "text-slate-400", fontArgb: null };
  }
  const text = Math.abs(amount).toFixed(3);
  return amount > 0
    ? { text, className: "text-emerald-700 font-medium", fontArgb: POSITIVE_FONT_ARGB }
    : { text: `-${text}`, className: "text-rose-700 font-medium", fontArgb: NEGATIVE_FONT_ARGB };
}

function formatBalanceQuantity(value) {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount.toFixed(3) : "0.000";
}

function dateSpanTooWide(dateFrom, dateTo) {
  if (!dateFrom || !dateTo) return false;
  const from = new Date(`${dateFrom}T00:00:00.000Z`);
  const to = new Date(`${dateTo}T00:00:00.000Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return false;
  return Math.floor((to.getTime() - from.getTime()) / 86400000) > 365;
}

function dateRangeInvalid(dateFrom, dateTo) {
  if (!dateFrom || !dateTo) return false;
  const from = new Date(`${dateFrom}T00:00:00.000Z`);
  const to = new Date(`${dateTo}T00:00:00.000Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return false;
  return to.getTime() < from.getTime();
}

export default function StockHistoryPage() {
  const { runtimeContext } = useMenu();
  // Law 12 (single company shown read-only / locked, multi-company = pick
  // from allowed list) — same TransactionCompanySelector pattern as IN03.
  const [companyId, setCompanyId] = useState("");
  useEffect(() => {
    const defaultCompanyId = resolveDefaultTransactionCompanyId(runtimeContext);
    if (defaultCompanyId && !companyId) {
      setCompanyId(defaultCompanyId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtimeContext]);
  const effectiveCompanyId = companyId || resolveDefaultTransactionCompanyId(runtimeContext);

  const materialsQuery = useMaterialOptionsQuery(
    { status: "ACTIVE", limit: MASTER_PICKER_FETCH_LIMIT, company_id: effectiveCompanyId },
    { enabled: Boolean(effectiveCompanyId) },
  );
  const slocQuery = useStorageLocationOptionsQuery({ is_active: true, limit: 1000 });

  const materialOptions = useMemo(
    () => (materialsQuery.materials ?? []).map((material) => ({
      value: material.id,
      label: `${material.pace_code ?? "—"} — ${material.document_name || material.material_name || ""}`,
    })),
    [materialsQuery.materials],
  );
  const slocOptions = useMemo(
    () => (slocQuery.storageLocations ?? []).map((sloc) => ({
      value: sloc.id,
      label: sloc.code ? `${sloc.code}${sloc.name ? ` — ${sloc.name}` : ""}` : sloc.name || sloc.id,
    })),
    [slocQuery.storageLocations],
  );

  const [materialTypeValues, setMaterialTypeValues] = useState([]);
  const [materialValues, setMaterialValues] = useState([]);
  const [slocValues, setSlocValues] = useState([]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [rows, setRows] = useState([]);
  const [visibleBuckets, setVisibleBuckets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState("");
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [page, setPage] = useState(1);

  const baseColumnDefinitions = useMemo(
    () => [
      { key: "company", label: "Company", width: "100px" },
      { key: "material_type", label: "Type", width: "80px" },
      { key: "material", label: "Material", width: "260px" },
      { key: "external_code", label: "External Code", width: "160px" },
      { key: "base_uom_code", label: "UOM", width: "80px" },
      { key: "storage_location", label: "SLoc", width: "100px" },
      { key: "stock_status", label: "Status", width: "140px" },
      {
        key: "opening",
        label: "Opening",
        width: "110px",
        align: "right",
        render: (row) => formatBalanceQuantity(row.opening),
        // §130.10 range-copy / §130.14 Excel export both read this instead
        // of re-deriving text from the JSX `render` output.
        copyValue: (row) => formatBalanceQuantity(row.opening),
      },
    ],
    [],
  );

  const bucketColumnDefinitions = useMemo(
    () => visibleBuckets.map((bucketCode) => ({
      key: `bucket_${bucketCode}`,
      label: BUCKET_LABELS[bucketCode] || bucketCode,
      width: "120px",
      align: "right",
      render: (row) => {
        const { text, className } = formatSignedQuantity(row.buckets?.[bucketCode]);
        return <span className={className}>{text}</span>;
      },
      copyValue: (row) => formatSignedQuantity(row.buckets?.[bucketCode]).text,
      excelColor: (row) => {
        const { fontArgb } = formatSignedQuantity(row.buckets?.[bucketCode]);
        return fontArgb ? { fontArgb } : null;
      },
    })),
    [visibleBuckets],
  );

  const closingColumnDefinition = useMemo(
    () => ({
      key: "closing",
      label: "Closing",
      width: "110px",
      align: "right",
      render: (row) => formatBalanceQuantity(row.closing),
      copyValue: (row) => formatBalanceQuantity(row.closing),
    }),
    [],
  );

  const columnDefinitions = useMemo(
    () => [...baseColumnDefinitions, ...bucketColumnDefinitions, closingColumnDefinition],
    [baseColumnDefinitions, bucketColumnDefinitions, closingColumnDefinition],
  );

  const [hiddenColumns, setHiddenColumns] = useState([]);
  const gridColumns = useMemo(
    () => columnDefinitions.filter((column) => !hiddenColumns.includes(column.key)),
    [columnDefinitions, hiddenColumns],
  );

  const searchDisabled = !companyId || !dateFrom || !dateTo || dateSpanTooWide(dateFrom, dateTo) || dateRangeInvalid(dateFrom, dateTo);

  const handleSearch = useCallback(async () => {
    setError("");
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
    setLoading(true);
    setSearched(true);
    try {
      const response = await getStockHistory({
        company_ids: companyId,
        material_types: joinValues(materialTypeValues) || undefined,
        material_ids: joinValues(materialValues) || undefined,
        storage_location_ids: joinValues(slocValues) || undefined,
        date_from: dateFrom,
        date_to: dateTo,
      });
      setRows(Array.isArray(response?.data) ? response.data : []);
      setVisibleBuckets(Array.isArray(response?.visible_buckets) ? response.visible_buckets : []);
      setPage(2);
    } catch (searchError) {
      setRows([]);
      setVisibleBuckets([]);
      setError(searchError instanceof Error ? searchError.message : "STOCK_HISTORY_FETCH_FAILED");
    } finally {
      setLoading(false);
    }
  }, [companyId, materialTypeValues, materialValues, slocValues, dateFrom, dateTo]);

  // Page 1 (Filters) <-> Page 2 (Output Grid) — same pattern as IN02/IN03,
  // no workspace/maintenance toggle since Stock History has no maintenance
  // mode at all (§130.16).
  useScreenBackInterceptor(() => {
    if (page !== 2) return false;
    setPage(1);
    return true;
  });

  useEffect(() => {
    function handleExecuteShortcut(event) {
      if (event.key !== "F8" || loading) return;
      event.preventDefault();
      void handleSearch();
    }
    window.addEventListener("keydown", handleExecuteShortcut);
    return () => window.removeEventListener("keydown", handleExecuteShortcut);
  }, [loading, handleSearch]);

  const [exporting, setExporting] = useState(false);
  async function handleExportExcel() {
    setExporting(true);
    try {
      // Dynamic import — exceljs only ever loads once Export is actually
      // clicked, never as part of this page's own bundle.
      const { downloadColoredExcelFile } = await import("../../../../shared/downloadColoredExcelFile.js");
      await downloadColoredExcelFile({
        fileName: `stock_history_${dateFrom || "from"}_${dateTo || "to"}.xlsx`,
        sheetName: "Stock History",
        columns: gridColumns,
        rows,
        getCellValue: (row, column) =>
          typeof column.copyValue === "function" ? column.copyValue(row) : (row?.[column.key] ?? ""),
        getCellColor: (row, column) =>
          typeof column.excelColor === "function" ? column.excelColor(row) : null,
        // §130.13 — the same distinct fill the Total row gets on screen.
        getRowFillArgb: (row) => (row.is_total ? TOTAL_ROW_FILL_ARGB : null),
      });
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "STOCK_HISTORY_EXPORT_FAILED");
    } finally {
      setExporting(false);
    }
  }

  return (
    <ErpScreenScaffold
      eyebrow="Inventory Reports"
      title="Stock History"
      notices={error ? [{ key: "stock-history-error", tone: "error", message: error }] : []}
      actions={
        page === 1
          ? [
              {
                key: "search",
                label: loading ? "Executing..." : "Execute",
                tone: "primary",
                hint: "F8",
                onClick: () => void handleSearch(),
                disabled: loading || searchDisabled,
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
                label: exporting ? "Exporting..." : "Export Excel",
                onClick: () => void handleExportExcel(),
                disabled: exporting || rows.length === 0,
              },
              {
                key: "search",
                label: loading ? "Executing..." : "Execute Again",
                tone: "primary",
                hint: "F8",
                onClick: () => void handleSearch(),
                disabled: loading || searchDisabled,
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
                label="Material Type"
                placeholder="All material types"
                value={materialTypeValues}
                onChange={setMaterialTypeValues}
                options={MATERIAL_TYPE_OPTIONS}
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
                disabled={loading || searchDisabled}
                className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? "Executing..." : "Execute"}
              </button>
            </div>
          </ErpSectionCard>
        </div>
      ) : (
        <div className="grid gap-4">
          <ErpSectionCard eyebrow="Page 2" title="Stock History Output Grid">
            <div className="mb-3 flex justify-start">
              <button
                type="button"
                onClick={() => setPage(1)}
                className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-50"
              >
                Back to Filters
              </button>
            </div>
            {!searched ? (
              <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                Set filters and click Execute to view stock history.
              </div>
            ) : (
              <>
                <div className="mb-2 text-xs text-slate-500">
                  Click and drag (or Shift+Click / Shift+Arrow) to select a range, then Ctrl+C to copy — same as Excel.
                </div>
                <ErpDenseGrid
                  columns={gridColumns}
                  rows={rows}
                  rowKey={(row) => row.row_key}
                  virtualize
                  rangeSelect
                  // §130.13 — each material's own Total row gets a distinct fill
                  // so it reads as a subtotal, not just another data row.
                  getRowProps={(row) =>
                    row.is_total
                      ? { className: "bg-amber-50 font-semibold border-t-2 border-amber-300" }
                      : {}
                  }
                  emptyMessage={loading ? "Executing..." : "No stock history matched the selected filters."}
                />
              </>
            )}
          </ErpSectionCard>
        </div>
      )}

      <ErpColumnVisibilityDrawer
        visible={columnsOpen}
        columns={columnDefinitions}
        visibleColumnKeys={columnDefinitions.map((column) => column.key).filter((key) => !hiddenColumns.includes(key))}
        onToggleColumn={(columnKey) =>
          setHiddenColumns((current) =>
            current.includes(columnKey)
              ? current.filter((entry) => entry !== columnKey)
              : [...current, columnKey],
          )
        }
        onResetColumns={() => setHiddenColumns([])}
        onClose={() => setColumnsOpen(false)}
      />
    </ErpScreenScaffold>
  );
}
