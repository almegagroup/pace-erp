/*
 * File-ID: 24.3
 * File-Path: frontend/src/pages/dashboard/procurement/reports/CurrentStockPage.jsx
 * Gate: 24
 * Phase: 24
 * Domain: PROCUREMENT
 * Purpose: Current stock snapshot grid with multi-value filters and MB52-style output.
 * Authority: Frontend
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ErpColumnVisibilityDrawer from "../../../../components/ErpColumnVisibilityDrawer.jsx";
import DrawerBase from "../../../../components/layer/DrawerBase.jsx";
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
import { listMachines } from "../../om/omApi.js";
import {
  getCurrentStock,
  getCurrentStockMachineWise,
  searchCurrentStockBatchNumbers,
  searchCurrentStockPackingPoNumbers,
} from "../procurementApi.js";

const MATERIAL_TYPE_OPTIONS = ["RM", "PM", "INT", "SFG", "FG"];
const STOCK_TYPE_OPTIONS = [
  { value: "UNRESTRICTED", label: "Unrestricted" },
  { value: "QUALITY_INSPECTION", label: "Quality Inspection" },
  { value: "BLOCKED", label: "Blocked" },
  { value: "IN_TRANSIT", label: "In Transit" },
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
  "intransit_qty",
];

function planningStatusPresentation(status) {
  if (status === "CRITICAL") {
    return { dotClass: "bg-rose-600", rowClass: "!bg-rose-50 !text-rose-950", label: "Procurement Planning: Critical" };
  }
  if (status === "WARNING") {
    return { dotClass: "bg-amber-400", rowClass: "!bg-amber-50 !text-amber-950", label: "Procurement Planning: Replenishment" };
  }
  return null;
}

function planningStatusLabel(status) {
  if (status === "CRITICAL") return "Critical";
  if (status === "WARNING") return "Replenishment";
  return "Normal";
}

function hasPlanningAlert(row) {
  return row?.planning_status === "CRITICAL" || row?.planning_status === "WARNING";
}

function compareCurrentStockRows(left, right) {
  return String(left.material_label || "").localeCompare(String(right.material_label || ""))
    || String(left.storage_location_code || "").localeCompare(String(right.storage_location_code || ""))
    || String(left.batch_number || "").localeCompare(String(right.batch_number || ""))
    || String(left.packing_po_number || "").localeCompare(String(right.packing_po_number || ""));
}

// This is a review view only. A standalone alert remains on its own. When an
// alert occurs inside an Item Group, every returned member of that group is
// included so its alternatives can be checked together. The units themselves
// are alphabetic by their first material; members within one group stay
// together instead of being split across the list.
function buildPlanningAlertReviewRows(rows) {
  const alertingGroupIds = new Set(
    rows
      .filter((row) => hasPlanningAlert(row) && row.planning_item_group_id)
      .map((row) => row.planning_item_group_id),
  );
  const units = [];
  const groupedRows = new Map();

  for (const row of rows) {
    const groupId = row.planning_item_group_id;
    if (!groupId) {
      if (hasPlanningAlert(row)) units.push([row]);
      continue;
    }
    if (!alertingGroupIds.has(groupId)) continue;
    const groupRows = groupedRows.get(groupId) ?? [];
    groupRows.push(row);
    groupedRows.set(groupId, groupRows);
  }

  units.push(...groupedRows.values());
  return units
    .map((unit) => [...unit].sort(compareCurrentStockRows))
    .sort((left, right) => compareCurrentStockRows(left[0], right[0]))
    .flat();
}

function planningStatusExcelFill(status) {
  if (status === "CRITICAL") return "FFFEE2E2";
  if (status === "WARNING") return "FFFEF3C7";
  return null;
}

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

// Excel needs the raw number for these (so it stays calculable in the
// workbook), never the "0.000"-formatted display string formatQuantity()
// produces for the on-screen grid — see downloadColoredExcelFile's own
// getCellValue doc comment for why.
const NUMERIC_COLUMN_KEYS = new Set([
  "unrestricted_qty",
  "reserved_qty",
  "net_available_qty",
  "qi_qty",
  "blocked_qty",
  "intransit_qty",
]);

const MACHINE_WISE_COLUMNS = [
  {
    key: "material",
    label: "Material",
    width: "260px",
    render: (row) => [row.pace_code, row.document_name || row.material_name].filter(Boolean).join(" — ") || "—",
  },
  { key: "external_code", label: "External Code", width: "150px", render: (row) => row.external_code || "—" },
  { key: "material_type", label: "Type", width: "80px", render: (row) => row.material_type || "—" },
  { key: "storage_location_code", label: "SLoc", width: "90px", render: (row) => row.storage_location_code || "—" },
  { key: "machine_label", label: "Machine", width: "150px" },
  { key: "batch_number", label: "Batch Number", width: "150px", render: (row) => row.batch_number || "—" },
  { key: "unrestricted_qty", label: "Unrestricted (Machine)", width: "150px", align: "right", render: (row) => formatQuantity(row.unrestricted_qty) },
  { key: "base_uom_code", label: "UOM", width: "80px", render: (row) => row.base_uom_code || "—" },
];

// §138.8 — "Machine wise stock" drawer (business owner, 2026-09-22). Re-runs
// the exact same filter criteria the main Current Stock report was last
// executed with, aggregating machine_stock_log into a current per-machine
// balance instead of stock_snapshot. Own state, own grid, own export; the
// main report's rows are never touched. Only rendered when the company
// actually has MTS machines mapped (see hasMtsQuery in the parent
// component) — companies without MTS never see the button at all. Only the
// Unrestricted-equivalent qty splits by machine (business owner confirmed) —
// Reserved/QI/Blocked/Net Available have no machine dimension here.
function MachineWiseStockDrawer({ visible, onClose, params }) {
  const query = useQuery({
    queryKey: ["current-stock-machine-wise", params],
    queryFn: () => getCurrentStockMachineWise(params),
    enabled: visible && Boolean(params),
    select: (result) => (Array.isArray(result?.data) ? result.data : []),
  });
  const rows = query.data ?? [];
  const [exporting, setExporting] = useState(false);

  async function handleExport() {
    if (rows.length === 0) return;
    setExporting(true);
    try {
      const { downloadColoredExcelFile } = await import("../../../../shared/downloadColoredExcelFile.js");
      await downloadColoredExcelFile({
        fileName: `current_stock_machine_wise_${new Date().toISOString().slice(0, 10)}.xlsx`,
        sheetName: "Machine Wise Stock",
        columns: MACHINE_WISE_COLUMNS,
        rows,
        getCellValue: (row, column) =>
          column.key === "unrestricted_qty" ? Number(row?.unrestricted_qty ?? 0) : (row?.[column.key] ?? "—"),
      });
    } finally {
      setExporting(false);
    }
  }

  return (
    <DrawerBase
      visible={visible}
      onClose={onClose}
      onEscape={onClose}
      side="center"
      width="min(1000px, calc(100vw - 24px))"
      title="Machine Wise Stock"
      actions={(
        <>
          <button
            type="button"
            onClick={onClose}
            className="h-8 border border-slate-300 bg-white px-4 text-xs font-semibold uppercase tracking-[0.12em] text-slate-700"
          >
            Close
          </button>
          <button
            type="button"
            onClick={() => void handleExport()}
            disabled={exporting || rows.length === 0}
            className="h-8 border border-sky-700 bg-sky-100 px-4 text-xs font-semibold uppercase tracking-[0.12em] text-sky-950 disabled:opacity-50"
          >
            {exporting ? "Exporting..." : "Export Excel"}
          </button>
        </>
      )}
    >
      <p className="mb-3 text-xs text-slate-500">
        Same filters as the report just executed — company, materials, storage locations, batch numbers.
      </p>
      {query.isLoading ? (
        <p className="py-6 text-center text-sm text-slate-500">Loading...</p>
      ) : query.error ? (
        <p className="py-6 text-center text-sm text-rose-600">{query.error instanceof Error ? query.error.message : "Failed to load machine-wise stock."}</p>
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-400">No machine-tracked stock for this filter.</p>
      ) : (
        <ErpDenseGrid columns={MACHINE_WISE_COLUMNS} rows={rows} rowKey={(row, index) => `${row.material_id}-${row.storage_location_code}-${row.machine_label}-${index}`} virtualize />
      )}
    </DrawerBase>
  );
}

export default function CurrentStockPage() {
  const { runtimeContext } = useMenu();
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
  // §138.8 -- "Machine wise stock" button only shows for a company that
  // actually has MTS machines mapped, same visibility check already
  // established for IN11's "Distribute to Machine" button (§138.13).
  const hasMtsQuery = useQuery({
    queryKey: ["current-stock-has-mts", effectiveCompanyId],
    queryFn: () => listMachines({ po_type: "MTS", company_id: effectiveCompanyId, active: true }),
    enabled: Boolean(effectiveCompanyId),
    select: (data) => (Array.isArray(data) ? data : data?.data ?? []),
  });
  const hasMts = (hasMtsQuery.data ?? []).length > 0;

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
  // MultiValueFilterField's internal debounce effect depends on `searchFn` by
  // reference -- an inline arrow function here would be a NEW reference every
  // render, re-triggering that effect (and its "Searching…" loading flip) on
  // every parent re-render, not just when the user actually types. That's the
  // picker-drawer flicker/never-stabilizes bug reported live 2026-08-11.
  // useCallback keeps the reference stable across renders that don't change
  // companyId.
  const searchBatchNumbers = useCallback(
    async (queryText) => {
      const response = await searchCurrentStockBatchNumbers({
        q: queryText || undefined,
        company_ids: effectiveCompanyId || undefined,
      });
      return Array.isArray(response?.data) ? response.data : [];
    },
    [effectiveCompanyId],
  );
  const searchPackingPoNumbers = useCallback(
    async (queryText) => {
      const response = await searchCurrentStockPackingPoNumbers({
        q: queryText || undefined,
        company_ids: effectiveCompanyId || undefined,
      });
      return Array.isArray(response?.data) ? response.data : [];
    },
    [effectiveCompanyId],
  );
  const [materialValues, setMaterialValues] = useState([]);
  const [slocValues, setSlocValues] = useState([]);
  const [batchValues, setBatchValues] = useState([]);
  const [packingPoValues, setPackingPoValues] = useState([]);
  const [materialTypes, setMaterialTypes] = useState([...MATERIAL_TYPE_OPTIONS]);
  const [stockTypes, setStockTypes] = useState(STOCK_TYPE_OPTIONS.map((entry) => entry.value));
  const [showZero, setShowZero] = useState(false);
  const [rows, setRows] = useState([]);
  const [planningAlertsOnly, setPlanningAlertsOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState("");
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState(DEFAULT_VISIBLE_COLUMNS);
  const [exporting, setExporting] = useState(false);
  const [submittedParams, setSubmittedParams] = useState(null);
  const [machineWiseOpen, setMachineWiseOpen] = useState(false);
  // Page 1 (Filters) and Page 2 (Output Grid) are separate full-page views,
  // like Process PO's step pages or SAP MB52/ZMB51's Execute -> report screen
  // — never both visible at once.
  const [page, setPage] = useState(1);

  const columnDefinitions = useMemo(
    () => [
      { key: "company_code", label: "Company", width: "120px" },
      { key: "material_type", label: "Type", width: "90px" },
      {
        key: "material_label",
        label: "Material",
        width: "260px",
        render: (row) => {
          const planningStatus = planningStatusPresentation(row.planning_status);
          return (
            <span className="flex items-center gap-2">
              {planningStatus ? <span aria-label={planningStatus.label} title={planningStatus.label} className={`h-2.5 w-2.5 shrink-0 rounded-full ${planningStatus.dotClass}`} /> : null}
              <span>
                <span className="block">{row.material_label}</span>
                {planningAlertsOnly && row.planning_item_group_name ? (
                  <span className="block text-xs font-normal text-slate-500">Group: {row.planning_item_group_name}</span>
                ) : null}
              </span>
            </span>
          );
        },
      },
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
      { key: "intransit_qty", label: "In Transit", width: "120px", align: "right", render: (row) => formatQuantity(row.intransit_qty) },
    ],
    [planningAlertsOnly],
  );

  const gridColumns = useMemo(
    () => columnDefinitions.filter((column) => visibleColumns.includes(column.key)),
    [columnDefinitions, visibleColumns],
  );

  const planningAlertRowCount = useMemo(
    () => rows.filter(hasPlanningAlert).length,
    [rows],
  );
  const mainRows = useMemo(
    () => rows.filter((row) => !row.planning_context_only),
    [rows],
  );
  const displayedRows = useMemo(
    () => (planningAlertsOnly ? buildPlanningAlertReviewRows(rows) : mainRows),
    [mainRows, planningAlertsOnly, rows],
  );

  async function handleSearch() {
    if (!companyId) {
      setError("Select a company first.");
      return;
    }
    setLoading(true);
    setError("");
    setSearched(true);
    setPlanningAlertsOnly(false);
    // Captured once here so the "Machine wise stock" drawer (§138.8) re-runs
    // the EXACT same criteria this search was executed with, even if the
    // filter panel is changed afterwards without re-searching.
    const params = {
      company_ids: companyId,
      material_ids: joinValues(materialValues) || undefined,
      storage_location_ids: joinValues(slocValues) || undefined,
      batch_numbers: joinValues(batchValues) || undefined,
      packing_po_numbers: joinValues(packingPoValues) || undefined,
      material_types: materialTypes.join(",") || undefined,
      stock_types: stockTypes.join(",") || undefined,
      show_zero: showZero ? "true" : "false",
    };
    try {
      const response = await getCurrentStock(params);
      setRows(Array.isArray(response?.data) ? response.data : []);
      setSubmittedParams(params);
      setPage(2);
    } catch (searchError) {
      setRows([]);
      setError(searchError instanceof Error ? searchError.message : "CURRENT_STOCK_FETCH_FAILED");
    } finally {
      setLoading(false);
    }
  }

  // Same pattern as AC01's Export Excel (downloadColoredExcelFile, dynamic
  // import so exceljs never enters this page's own bundle until Export is
  // actually clicked). It exports the currently displayed rows, preserves
  // their planning-status row colour, and includes an explicit text status
  // column so the alert remains understandable outside the ERP as well.
  async function handleExportExcel() {
    setExporting(true);
    try {
      const { downloadColoredExcelFile } = await import("../../../../shared/downloadColoredExcelFile.js");
      const exportColumns = gridColumns.map((column) => ({
        ...column,
        numFmt: NUMERIC_COLUMN_KEYS.has(column.key) ? "0.000" : undefined,
      }));
      exportColumns.push({
        key: "planning_status",
        label: "Planning Status",
        width: "150px",
      });
      exportColumns.push({
        key: "planning_item_group_name",
        label: "Planning Group",
        width: "180px",
      });
      await downloadColoredExcelFile({
        fileName: `current_stock_${new Date().toISOString().slice(0, 10)}.xlsx`,
        sheetName: "Current Stock",
        columns: exportColumns,
        rows: displayedRows,
        getCellValue: (row, column) =>
          column.key === "planning_status"
            ? planningStatusLabel(row?.planning_status)
            : NUMERIC_COLUMN_KEYS.has(column.key)
              ? Number(row?.[column.key] ?? 0)
              : (row?.[column.key] ?? "—"),
        getRowFillArgb: (row) => planningStatusExcelFill(row?.planning_status),
      });
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "CURRENT_STOCK_EXPORT_FAILED");
    } finally {
      setExporting(false);
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
                key: "export",
                label: exporting ? "Exporting..." : "Export Excel",
                onClick: () => void handleExportExcel(),
                disabled: exporting || displayedRows.length === 0,
              },
              // §138.8 -- hidden entirely (not just disabled) for a company
              // with no MTS machines mapped, per business owner's own words.
              ...(hasMts ? [{
                key: "machine-wise",
                label: "Machine Wise Stock",
                onClick: () => setMachineWiseOpen(true),
              }] : []),
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
              placeholder="All packing POs"
              value={packingPoValues}
              onChange={setPackingPoValues}
              searchFn={searchPackingPoNumbers}
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
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setPage(1)}
              className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-50"
            >
              Back to Filters
            </button>
            <label className="inline-flex items-center gap-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-950">
              <input
                type="checkbox"
                checked={planningAlertsOnly}
                onChange={(event) => setPlanningAlertsOnly(event.target.checked)}
              />
              <span>Critical / Replenishment only ({planningAlertRowCount})</span>
            </label>
          </div>
          {!searched ? (
            <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
              Set filters and click Search to view current stock.
            </div>
          ) : (
            <ErpDenseGrid
              columns={gridColumns}
              rows={displayedRows}
              rowKey={(row) => row.row_key}
              getRowProps={(row) => {
                const planningStatus = planningStatusPresentation(row.planning_status);
                return planningStatus ? { className: planningStatus.rowClass } : {};
              }}
              emptyMessage={loading
                ? "Searching current stock..."
                : planningAlertsOnly
                  ? "No critical or replenishment item is present in this result."
                  : "No current stock matched the selected filters."}
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

      <MachineWiseStockDrawer
        visible={machineWiseOpen}
        onClose={() => setMachineWiseOpen(false)}
        params={submittedParams}
      />
    </ErpScreenScaffold>
  );
}
