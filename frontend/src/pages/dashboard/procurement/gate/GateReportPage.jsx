/*
 * File-Path: frontend/src/pages/dashboard/procurement/gate/GateReportPage.jsx
 * Purpose: Gate Entry Report (ZGATE) -- two-page report modelled on IN03 (Current Stock):
 *          Page 1 = filters, Page 2 = output grid (Columns picker, search-all-columns, Excel export).
 * Authority: Frontend
 *
 * Company is session-scoped (TransactionCompanySelector: single-company user = locked, multi-company
 * user = own allowed companies only). The Material picker is scoped to that company too.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ErpColumnVisibilityDrawer from "../../../../components/ErpColumnVisibilityDrawer.jsx";
import { layoutDrawerProps, useColumnLayouts } from "../../../../shared/columnLayouts/useColumnLayouts.js";
import { pushToast } from "../../../../store/uiToast.js";
import MultiValueFilterField from "../../../../components/inputs/MultiValueFilterField.jsx";
import TransactionCompanySelector from "../../../../components/inputs/TransactionCompanySelector.jsx";
import { buildTransactionCompanyList, resolveDefaultTransactionCompanyId } from "../../../../components/inputs/transactionCompanyRuntime.js";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpScreenScaffold, { ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { MASTER_PICKER_FETCH_LIMIT, useMaterialOptionsQuery } from "../../../../hooks/queries/useOmMasterQueries.js";
import { useScreenBackInterceptor } from "../../../../hooks/useScreenBackInterceptor.js";
import { getGateReport } from "../procurementApi.js";

const MATERIAL_TYPE_OPTIONS = ["RM", "PM", "INT", "SFG", "FG"];
const DATE_INPUT_CLASS = "h-10 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500";
const DEFAULT_RANGE_DAYS = 30;

const vendorLabel = (r) => (r.vendor_name ? `${r.vendor_code || ""} — ${r.vendor_name}`.replace(/^ — /, "") : "");
const num = (value) => (value == null || value === "" || !Number.isFinite(Number(value)) ? "" : Number(value));
const dash = (value) => (value == null || value === "" ? "—" : value);

function istDate(offsetDays = 0) {
  const date = new Date(Date.now() + offsetDays * 86_400_000);
  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function daysBadge(days) {
  if (days == null) return "—";
  if (days > 2) return <span className="font-semibold text-rose-700">{days}d</span>;
  return `${days}d`;
}

// One column list drives the grid, the Columns picker and the Excel. `value` = raw Excel value (numbers stay numbers).
const TEXT_COLUMN = (key, label, width) => ({
  key, label, width, render: (r) => dash(r[key]), filterValue: (r) => dash(r[key]), value: (r) => r[key] ?? "",
});
const COLUMN_DEFINITIONS = [
  { key: "ge_number", label: "GE Number", width: "120px", value: (r) => r.ge_number ?? "" },
  TEXT_COLUMN("company_code", "Company", "90px"),
  TEXT_COLUMN("ge_type", "GE Type", "110px"),
  TEXT_COLUMN("ge_status", "Status", "100px"),
  TEXT_COLUMN("vehicle_number", "Vehicle No.", "110px"),
  TEXT_COLUMN("ge_person_name", "GE Person Name", "140px"),
  TEXT_COLUMN("gex_person_name", "GEX Person Name", "140px"),
  {
    key: "vendor", label: "Vendor", width: "180px",
    render: (r) => vendorLabel(r) || "—", copyValue: (r) => vendorLabel(r), filterValue: (r) => vendorLabel(r) || "—", value: (r) => vendorLabel(r),
  },
  TEXT_COLUMN("material_code", "Material Code", "120px"),
  TEXT_COLUMN("material_type", "Item Type", "90px"),
  TEXT_COLUMN("material_name", "Material Name", "240px"),
  {
    key: "ge_qty", label: "Qty", width: "90px", align: "right", numFmt: "#,##0.###",
    render: (r) => (r.ge_qty != null ? `${Number(r.ge_qty).toFixed(3)} ${r.uom_code || ""}`.trim() : "—"),
    copyValue: (r) => r.ge_qty ?? "", filterValue: (r) => (r.ge_qty != null ? String(Number(r.ge_qty)) : "—"), value: (r) => num(r.ge_qty),
  },
  { key: "uom_code", label: "UOM", width: "60px", render: (r) => dash(r.uom_code), filterValue: (r) => dash(r.uom_code), value: (r) => r.uom_code ?? "" },
  TEXT_COLUMN("grn_number", "GRN No.", "110px"),
  {
    key: "grn_qty", label: "GRN Qty", width: "90px", align: "right", numFmt: "#,##0.###",
    render: (r) => (r.grn_qty != null ? Number(r.grn_qty).toFixed(3) : "—"),
    copyValue: (r) => r.grn_qty ?? "", filterValue: (r) => (r.grn_qty != null ? String(Number(r.grn_qty)) : "—"), value: (r) => num(r.grn_qty),
  },
  TEXT_COLUMN("invoice_number", "Invoice No.", "120px"),
  TEXT_COLUMN("gex_number", "GEX No.", "110px"),
  { key: "ge_date", label: "GE Date", width: "100px", filterType: "date", value: (r) => r.ge_date ?? "" },
  { ...TEXT_COLUMN("grn_date", "GRN Date", "100px"), filterType: "date" },
  { ...TEXT_COLUMN("gex_date", "GEX Date", "100px"), filterType: "date" },
  {
    key: "remarks", label: "Remarks", width: "140px",
    render: (r) => r.gex_remarks || r.ge_remarks || "—", copyValue: (r) => r.gex_remarks || r.ge_remarks || "",
    filterValue: (r) => r.gex_remarks || r.ge_remarks || "—", value: (r) => r.gex_remarks || r.ge_remarks || "",
  },
  {
    key: "gross_weight", label: "Gross Wt", width: "90px", align: "right", numFmt: "#,##0.###",
    render: (r) => dash(r.gross_weight), filterValue: (r) => (r.gross_weight == null ? "—" : String(r.gross_weight)), value: (r) => num(r.gross_weight),
  },
  {
    key: "tare_weight", label: "Tare Wt", width: "90px", align: "right", numFmt: "#,##0.###",
    render: (r) => dash(r.tare_weight), filterValue: (r) => (r.tare_weight == null ? "—" : String(r.tare_weight)), value: (r) => num(r.tare_weight),
  },
  {
    key: "net_weight_calculated", label: "Net Wt (Calc)", width: "100px", align: "right", numFmt: "#,##0.###",
    render: (r) => dash(r.net_weight_calculated), copyValue: (r) => r.net_weight_calculated ?? "",
    filterValue: (r) => (r.net_weight_calculated == null ? "—" : String(r.net_weight_calculated)), value: (r) => num(r.net_weight_calculated),
  },
  {
    key: "days_ge_to_gex", label: "GEX−GE (days)", width: "110px", align: "right",
    render: (r) => daysBadge(r.days_ge_to_gex), copyValue: (r) => r.days_ge_to_gex ?? "",
    filterValue: (r) => (r.days_ge_to_gex == null ? "—" : String(r.days_ge_to_gex)), value: (r) => num(r.days_ge_to_gex),
  },
  {
    key: "days_ge_to_grn", label: "GRN−GE (days)", width: "110px", align: "right",
    render: (r) => daysBadge(r.days_ge_to_grn), copyValue: (r) => r.days_ge_to_grn ?? "",
    filterValue: (r) => (r.days_ge_to_grn == null ? "—" : String(r.days_ge_to_grn)), value: (r) => num(r.days_ge_to_grn),
  },
];
const DEFAULT_HIDDEN_COLUMNS = new Set(["uom_code"]);
const PICKER_COLUMNS = COLUMN_DEFINITIONS.map((column) => ({ ...column, defaultHidden: DEFAULT_HIDDEN_COLUMNS.has(column.key) }));

function rowSearchText(row) {
  return COLUMN_DEFINITIONS.map((column) => String(column.value(row) ?? "")).join(" ").toLowerCase();
}

export default function GateReportPage() {
  const { runtimeContext } = useMenu();

  // Page 1 (Filters) and Page 2 (Output Grid) are separate full-page views, like IN03 -- never both at once.
  const [page, setPage] = useState(1);
  const [companyId, setCompanyId] = useState("");
  const [dateFrom, setDateFrom] = useState(() => istDate(-DEFAULT_RANGE_DAYS));
  const [dateTo, setDateTo] = useState(() => istDate(0));
  const [materialTypes, setMaterialTypes] = useState([]);
  const [materialValues, setMaterialValues] = useState([]);
  const [pendingGrn, setPendingGrn] = useState(false);
  const [pendingGex, setPendingGex] = useState(false);
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

  // Material picker is scoped to the selected company (material_master itself is global).
  const materialsQuery = useMaterialOptionsQuery(
    { status: "ACTIVE", limit: MASTER_PICKER_FETCH_LIMIT, company_id: effectiveCompanyId },
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
    queryKey: ["procurement", "gate-report", submittedParams],
    enabled: submittedParams != null,
    queryFn: () => getGateReport(submittedParams),
  });
  const loading = reportQuery.isFetching;
  const error = reportQuery.error?.message ?? "";
  const allRows = useMemo(
    () => (Array.isArray(reportQuery.data?.items) ? reportQuery.data.items : []),
    [reportQuery.data],
  );

  const displayedRows = useMemo(() => {
    const term = allColumnSearch.trim().toLowerCase();
    return term ? allRows.filter((row) => rowSearchText(row).includes(term)) : allRows;
  }, [allRows, allColumnSearch]);

  const layoutMessage = useCallback((message, tone) => pushToast({ message, tone }), []);
  const layout = useColumnLayouts("GATE_REPORT", PICKER_COLUMNS, layoutMessage);
  const gridColumns = layout.columns;

  const buildParams = useCallback(() => ({
    company_id: effectiveCompanyId,
    date_from: dateFrom,
    date_to: dateTo,
    material_types: materialTypes.join(","),
    material_ids: materialValues.join(","),
    pending_grn: pendingGrn ? "1" : "",
    pending_gex: pendingGex ? "1" : "",
  }), [effectiveCompanyId, dateFrom, dateTo, materialTypes, materialValues, pendingGrn, pendingGex]);

  const handleSearch = useCallback(() => {
    if (!effectiveCompanyId) return;
    const next = buildParams();
    setAllColumnSearch("");
    setExportError("");
    // Same criteria as the last run = same query key, so re-fetch instead of silently serving the cache.
    if (JSON.stringify(next) === JSON.stringify(submittedParams)) void reportQuery.refetch();
    else setSubmittedParams(next);
    setPage(2);
  }, [effectiveCompanyId, buildParams, submittedParams, reportQuery]);

  function toggleMaterialType(type) {
    setMaterialTypes((current) => (current.includes(type) ? current.filter((entry) => entry !== type) : [...current, type]));
  }

  // Exports exactly the rows on screen (criteria + search + column filters) in the visible columns, with the
  // report context and the export date-time above the header.
  async function handleExportExcel() {
    if (gridRows.length === 0) return;
    setExporting(true);
    setExportError("");
    try {
      const { downloadColoredExcelFile } = await import("../../../../shared/downloadColoredExcelFile.js");
      const now = new Date();
      const exportStamp = now.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
      const fileStamp = now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
      const company = buildTransactionCompanyList(runtimeContext).find((entry) => String(entry.id) === String(submittedParams?.company_id));
      const companyCode = String(company?.company_code || "company").replace(/[^A-Za-z0-9_-]+/g, "_");
      const criteria = submittedParams ?? {};
      await downloadColoredExcelFile({
        fileName: `gate_entry_report_${companyCode}_exported_${fileStamp}.xlsx`,
        sheetName: "Gate Entry Report",
        columns: gridColumns,
        rows: gridRows,
        preambleRows: [
          ["Report", "Gate Entry Report (ZGATE)"],
          ["Company", company ? [company.company_code, company.company_name].filter(Boolean).join(" — ") : "-"],
          ["GE Date", `${criteria.date_from || "…"} to ${criteria.date_to || "…"}`],
          ["Item Type", criteria.material_types || "All"],
          ["Material", criteria.material_ids ? `${criteria.material_ids.split(",").length} selected` : "All"],
          ["GRN pending", criteria.pending_grn ? "Yes" : "No"],
          ["Gate Exit pending", criteria.pending_gex ? "Yes" : "No"],
          ...(allColumnSearch.trim() ? [["Search", allColumnSearch.trim()]] : []),
          ...(gridRows.length !== displayedRows.length ? [["Column Filters", "Applied (only the filtered rows are exported)"]] : []),
          ["Rows", gridRows.length],
          ["Export Date", `${exportStamp} IST`],
        ],
        getCellValue: (row, column) => (typeof column.value === "function" ? column.value(row) : (row?.[column.key] ?? "")),
        // Same signal as the screen: more than 2 days is shown in red.
        getCellColor: (row, column) =>
          (column.key === "days_ge_to_gex" || column.key === "days_ge_to_grn") && Number(row[column.key]) > 2
            ? { fontArgb: "FFBE123C", bold: true }
            : null,
      });
    } catch (failure) {
      setExportError(failure instanceof Error ? failure.message : "GATE_REPORT_EXPORT_FAILED");
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
    disabled: loading || !effectiveCompanyId,
  };

  return (
    <ErpScreenScaffold
      eyebrow="Procurement Reports"
      title="Gate Entry Report (ZGATE)"
      notices={[
        ...(error ? [{ key: "gate-report-error", tone: "error", message: error }] : []),
        ...(exportError ? [{ key: "gate-report-export-error", tone: "error", message: exportError }] : []),
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
              <TransactionCompanySelector
                runtimeContext={runtimeContext}
                value={companyId}
                onChange={setCompanyId}
                label="Company"
              />
              <label className="grid gap-1 text-[11px] font-medium text-slate-600">
                GE Date from
                <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={DATE_INPUT_CLASS} />
              </label>
              <label className="grid gap-1 text-[11px] font-medium text-slate-600">
                GE Date to
                <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={DATE_INPUT_CLASS} />
              </label>
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
              <fieldset className="grid gap-1 text-[11px] font-medium text-slate-600">
                <legend className="mb-1">Item Type {materialTypes.length === 0 ? "(All)" : ""}</legend>
                <div className="flex flex-wrap items-center gap-3 text-sm text-slate-800">
                  {MATERIAL_TYPE_OPTIONS.map((type) => (
                    <label key={type} className="inline-flex items-center gap-1.5">
                      <input type="checkbox" checked={materialTypes.includes(type)} onChange={() => toggleMaterialType(type)} />
                      <span>{type}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="grid gap-1 text-[11px] font-medium text-slate-600">
                <span>Pending</span>
                <div className="flex flex-wrap items-center gap-4 text-sm text-slate-800">
                  <label className="inline-flex items-center gap-1.5">
                    <input type="checkbox" checked={pendingGrn} onChange={(e) => setPendingGrn(e.target.checked)} />
                    <span>GRN pending</span>
                  </label>
                  <label className="inline-flex items-center gap-1.5">
                    <input type="checkbox" checked={pendingGex} onChange={(e) => setPendingGex(e.target.checked)} />
                    <span>Gate Exit pending</span>
                  </label>
                </div>
              </div>
            </div>
            <p className="mt-3 text-xs text-slate-500">
              No Item Type ticked = all types. Pending filters leave out cancelled / pruned gate entries.
            </p>
          </ErpSectionCard>
        </div>
      ) : (
        <div className="grid gap-4">
          <ErpSectionCard eyebrow="Page 2" title="Gate Entry Output Grid">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <label className="min-w-[260px] flex-1 text-xs font-semibold uppercase tracking-[0.1em] text-slate-600">
                Search all columns
                <input
                  type="search"
                  value={allColumnSearch}
                  onChange={(event) => setAllColumnSearch(event.target.value)}
                  placeholder="GE, GRN, GEX, vendor, material, vehicle, invoice..."
                  className="mt-1 h-9 w-full rounded border border-slate-300 bg-white px-3 text-sm font-normal normal-case tracking-normal text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                />
              </label>
              <span className="pb-2 text-sm text-slate-500">
                {loading ? "Loading..." : `${gridRows.length} of ${allRows.length} rows`}
              </span>
            </div>
            <ErpDenseGrid
              // Excel-style: arrow-key cell navigation, range select + Ctrl+C, per-column AutoFilter (funnel in each header).
              rangeSelect
              columnFilter
              virtualize
              stickyFirstColumn
              maxHeight="calc(100vh - 380px)"
              onFilteredRowsChange={setGridRows}
              columns={gridColumns}
              rows={displayedRows}
              rowKey={(r, i) => `${r.ge_number}-${r.line_number ?? i}-${r.grn_number ?? ""}`}
              emptyMessage={
                loading
                  ? "Loading..."
                  : error
                    ? "The report could not be loaded — see the error above."
                    : allColumnSearch.trim()
                      ? "No row matches this search."
                      : "No records matched the criteria."
              }
            />
          </ErpSectionCard>
        </div>
      )}

      <ErpColumnVisibilityDrawer
        visible={columnsOpen}
        {...layoutDrawerProps(layout)}
        onClose={() => setColumnsOpen(false)}
      />
    </ErpScreenScaffold>
  );
}
