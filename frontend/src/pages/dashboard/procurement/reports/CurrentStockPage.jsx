/*
 * File-ID: 24.3
 * File-Path: frontend/src/pages/dashboard/procurement/reports/CurrentStockPage.jsx
 * Gate: 24
 * Phase: 24
 * Domain: PROCUREMENT
 * Purpose: Current stock snapshot grid with multi-value filters and MB52-style output.
 * Authority: Frontend
 */

import { useEffect, useMemo, useState } from "react";
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
  useMaterialOptionsQuery,
  useStorageLocationOptionsQuery,
} from "../../../../hooks/queries/useOmMasterQueries.js";
import { useScreenBackInterceptor } from "../../../../hooks/useScreenBackInterceptor.js";
import {
  getCurrentStock,
  searchCurrentStockBatchNumbers,
  searchCurrentStockPackingPoNumbers,
} from "../procurementApi.js";

const MATERIAL_TYPE_OPTIONS = ["RM", "PM", "INT", "SFG", "FG"];
const STOCK_TYPE_OPTIONS = [
  { value: "UNRESTRICTED", label: "Unrestricted" },
  { value: "QUALITY_INSPECTION", label: "Quality Inspection" },
  { value: "BLOCKED", label: "Blocked" },
];

const DEFAULT_VISIBLE_COLUMNS = [
  "company_code",
  "material_type",
  "material_label",
  "external_code",
  "uom_code",
  "storage_location_code",
  "batch_number",
  "packing_po_number",
  "unrestricted_qty",
  "reserved_qty",
  "net_available_qty",
  "qi_qty",
  "blocked_qty",
];

function formatQuantity(value) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) {
    return "0.000";
  }
  return amount.toFixed(3);
}

function joinValues(entries) {
  return entries.map((entry) => entry.value).join(",");
}

function toggleValue(list, targetValue) {
  return list.includes(targetValue)
    ? list.filter((entry) => entry !== targetValue)
    : [...list, targetValue];
}

export default function CurrentStockPage() {
  const { runtimeContext } = useMenu();
  const materialsQuery = useMaterialOptionsQuery({ status: "ACTIVE", limit: 1000 });
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

  // Business decision (2026-08-04): single company at a time, never multi —
  // this report is one company's stock, not a cross-company roll-up. Single-
  // company users get it auto-resolved and locked; multi-company users pick
  // exactly one from their own allowed list, same pattern every transaction
  // page already uses (Law 12) — reuses TransactionCompanySelector directly
  // rather than the multi-value picker used for the other filters below.
  const [companyId, setCompanyId] = useState("");
  useEffect(() => {
    const defaultCompanyId = resolveDefaultTransactionCompanyId(runtimeContext);
    if (defaultCompanyId && !companyId) {
      setCompanyId(defaultCompanyId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtimeContext]);
  const [materialValues, setMaterialValues] = useState([]);
  const [slocValues, setSlocValues] = useState([]);
  const [batchValues, setBatchValues] = useState([]);
  const [packingPoValues, setPackingPoValues] = useState([]);
  const [materialTypes, setMaterialTypes] = useState([...MATERIAL_TYPE_OPTIONS]);
  const [stockTypes, setStockTypes] = useState(STOCK_TYPE_OPTIONS.map((entry) => entry.value));
  const [showZero, setShowZero] = useState(false);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState("");
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState(DEFAULT_VISIBLE_COLUMNS);
  // Page 1 (Filters) and Page 2 (Output Grid) are separate full-page views,
  // like Process PO's step pages or SAP MB52/ZMB51's Execute -> report screen
  // — never both visible at once.
  const [page, setPage] = useState(1);

  const columnDefinitions = useMemo(
    () => [
      { key: "company_code", label: "Company", width: "120px" },
      { key: "material_type", label: "Type", width: "90px" },
      { key: "material_label", label: "Material", width: "260px" },
      { key: "external_code", label: "External Code", width: "180px", render: (row) => row.external_code || "—" },
      { key: "document_name", label: "Document Name", width: "240px", render: (row) => row.document_name || "—" },
      { key: "uom_code", label: "UOM", width: "90px" },
      { key: "storage_location_code", label: "SLoc", width: "100px" },
      { key: "batch_number", label: "Batch Number", width: "160px", render: (row) => row.batch_number || "—" },
      { key: "packing_po_number", label: "Packing PO Number", width: "170px", render: (row) => row.packing_po_number || "—" },
      { key: "unrestricted_qty", label: "Unrestricted", width: "130px", align: "right", render: (row) => formatQuantity(row.unrestricted_qty) },
      { key: "reserved_qty", label: "Reserved", width: "120px", align: "right", render: (row) => formatQuantity(row.reserved_qty) },
      { key: "net_available_qty", label: "Net Available", width: "130px", align: "right", render: (row) => formatQuantity(row.net_available_qty) },
      { key: "qi_qty", label: "Quality Inspection", width: "150px", align: "right", render: (row) => formatQuantity(row.qi_qty) },
      { key: "blocked_qty", label: "Blocked", width: "120px", align: "right", render: (row) => formatQuantity(row.blocked_qty) },
    ],
    [],
  );

  const gridColumns = useMemo(
    () => columnDefinitions.filter((column) => visibleColumns.includes(column.key)),
    [columnDefinitions, visibleColumns],
  );

  async function handleSearch() {
    if (!companyId) {
      setError("Select a company first.");
      return;
    }
    setLoading(true);
    setError("");
    setSearched(true);
    try {
      const response = await getCurrentStock({
        company_ids: companyId,
        material_ids: joinValues(materialValues) || undefined,
        storage_location_ids: joinValues(slocValues) || undefined,
        batch_numbers: joinValues(batchValues) || undefined,
        packing_po_numbers: joinValues(packingPoValues) || undefined,
        material_types: materialTypes.join(",") || undefined,
        stock_types: stockTypes.join(",") || undefined,
        show_zero: showZero ? "true" : "false",
      });
      setRows(Array.isArray(response?.data) ? response.data : []);
      setPage(2);
    } catch (searchError) {
      setRows([]);
      setError(searchError instanceof Error ? searchError.message : "CURRENT_STOCK_FETCH_FAILED");
    } finally {
      setLoading(false);
    }
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

  // SAP-style Execute shortcut (F8) — mirrors ZMB51/MB52's own Execute key,
  // since this report is explicitly modeled on them.
  useEffect(() => {
    function handleExecuteShortcut(event) {
      if (event.key !== "F8" || loading) {
        return;
      }
      event.preventDefault();
      void handleSearch();
    }
    window.addEventListener("keydown", handleExecuteShortcut);
    return () => window.removeEventListener("keydown", handleExecuteShortcut);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, companyId, materialValues, slocValues, batchValues, packingPoValues, materialTypes, stockTypes, showZero]);

  return (
    <ErpScreenScaffold
      eyebrow="Inventory Reports"
      title="Current Stock"
      notices={error ? [{ key: "current-stock-error", tone: "error", message: error }] : []}
      actions={
        page === 1
          ? [
              {
                key: "search",
                label: loading ? "Searching..." : "Search",
                tone: "primary",
                hint: "F8",
                onClick: () => void handleSearch(),
                disabled: loading || !companyId,
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
                key: "search",
                label: loading ? "Searching..." : "Search Again",
                tone: "primary",
                hint: "F8",
                onClick: () => void handleSearch(),
                disabled: loading || !companyId,
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
            />
            <MultiValueFilterField
              label="Storage Location"
              placeholder="All storage locations"
              value={slocValues}
              onChange={setSlocValues}
              options={slocOptions}
            />
            <MultiValueFilterField
              label="Batch Number"
              placeholder="All batch numbers"
              value={batchValues}
              onChange={setBatchValues}
              searchFn={async (queryText) => {
                const response = await searchCurrentStockBatchNumbers({
                  q: queryText || undefined,
                  company_ids: companyId || undefined,
                });
                return Array.isArray(response?.data) ? response.data : [];
              }}
            />
            <MultiValueFilterField
              label="Packing PO Number"
              placeholder="All packing POs"
              value={packingPoValues}
              onChange={setPackingPoValues}
              searchFn={async (queryText) => {
                const response = await searchCurrentStockPackingPoNumbers({
                  q: queryText || undefined,
                  company_ids: companyId || undefined,
                });
                return Array.isArray(response?.data) ? response.data : [];
              }}
            />
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="grid gap-2">
              <div className="text-sm font-medium text-slate-800">Material Type</div>
              <div className="flex flex-wrap gap-3">
                {MATERIAL_TYPE_OPTIONS.map((entry) => (
                  <label key={entry} className="inline-flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={materialTypes.includes(entry)}
                      onChange={() => setMaterialTypes((current) => toggleValue(current, entry))}
                    />
                    <span>{entry}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="grid gap-2">
              <div className="text-sm font-medium text-slate-800">Stock Type</div>
              <div className="flex flex-wrap gap-3">
                {STOCK_TYPE_OPTIONS.map((entry) => (
                  <label key={entry.value} className="inline-flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={stockTypes.includes(entry.value)}
                      onChange={() => setStockTypes((current) => toggleValue(current, entry.value))}
                    />
                    <span>{entry.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          <label className="mt-4 inline-flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={showZero}
              onChange={(event) => setShowZero(event.target.checked)}
            />
            <span>Show Zero Stock</span>
          </label>

          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={() => void handleSearch()}
              disabled={loading || !companyId}
              className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "Searching..." : "Search"}
            </button>
          </div>
        </ErpSectionCard>
      </div>
      ) : (
      <div className="grid gap-4">
        <ErpSectionCard eyebrow="Page 2" title="Current Stock Output Grid">
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
              Set filters and click Search to view current stock.
            </div>
          ) : (
            <ErpDenseGrid
              columns={gridColumns}
              rows={rows}
              rowKey={(row) => row.row_key}
              emptyMessage={loading ? "Searching current stock..." : "No current stock matched the selected filters."}
            />
          )}
        </ErpSectionCard>
      </div>
      )}

      <ErpColumnVisibilityDrawer
        visible={columnsOpen}
        columns={columnDefinitions}
        visibleColumnKeys={visibleColumns}
        onToggleColumn={(columnKey) =>
          setVisibleColumns((current) =>
            current.includes(columnKey)
              ? current.filter((entry) => entry !== columnKey)
              : [...current, columnKey],
          )
        }
        onResetColumns={() => setVisibleColumns(DEFAULT_VISIBLE_COLUMNS)}
        onClose={() => setColumnsOpen(false)}
      />
    </ErpScreenScaffold>
  );
}
