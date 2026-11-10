/*
 * File-Path: frontend/src/pages/dashboard/procurement/grn/GRNListPage.jsx
 * Purpose: Goods Receipts (GRN register) -- two-page report like the Gate Entry Report: Page 1 filters, Page 2 output
 *          grid (Columns picker, search-all-columns, Excel export). Post GRN, Invoice Mapping and Refresh stay; Enter on a
 *          row opens the GRN detail, as before. ACL unchanged (PROC_GRN_LIST).
 * Authority: Frontend
 *
 * Company is session-scoped (TransactionCompanySelector); the Material picker is scoped to that company. No column is fixed.
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
import { useErpScreenHotkeys } from "../../../../hooks/useErpScreenHotkeys.js";
import { useScreenBackInterceptor } from "../../../../hooks/useScreenBackInterceptor.js";
import { openScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import { getGrnReport } from "../procurementApi.js";

const MATERIAL_TYPE_OPTIONS = ["RM", "PM", "INT", "SFG", "FG"];
const STATUS_OPTIONS = ["DRAFT", "POSTED", "SPLIT", "REVERSED"];
const DATE_INPUT_CLASS = "h-10 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500";
const DEFAULT_RANGE_DAYS = 30;

const dash = (value) => (value == null || value === "" ? "—" : value);
const num = (value) => (value == null || value === "" || !Number.isFinite(Number(value)) ? "" : Number(value));
const joined = (code, name) => (name ? `${code || ""} — ${name}`.replace(/^ — /, "") : "");

function statusTone(status) {
  switch (String(status || "").toUpperCase()) {
    case "POSTED": return "bg-emerald-100 text-emerald-800";
    case "REVERSED": return "bg-rose-100 text-rose-800";
    // Invoice split: the receipt stands, its invoices are separate invoice GRNs.
    case "SPLIT": return "bg-violet-100 text-violet-800";
    case "DRAFT": default: return "bg-sky-100 text-sky-800";
  }
}

function istDate(offsetDays = 0) {
  return new Date(Date.now() + offsetDays * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

// One definition feeds the grid, the Columns picker and the Excel. `value` = the raw Excel cell (numbers stay numbers).
const text = (key, label, width, extra = {}) => ({
  key, label, width, render: (row) => dash(row[key]), filterValue: (row) => dash(row[key]), value: (row) => row[key] ?? "", ...extra,
});
const COLUMN_DEFINITIONS = [
  { key: "grn_number", label: "GRN Number", width: "120px", value: (row) => row.grn_number ?? "" },
  text("material_code", "Material Code", "130px"),
  text("material_name", "Material Name", "240px"),
  text("material_type", "Item Type", "90px"),
  {
    key: "vendor", label: "Vendor", width: "200px",
    render: (row) => joined(row.vendor_code, row.vendor_name) || "—", copyValue: (row) => joined(row.vendor_code, row.vendor_name),
    filterValue: (row) => joined(row.vendor_code, row.vendor_name) || "—", value: (row) => joined(row.vendor_code, row.vendor_name),
  },
  text("ge_number", "GE Number", "120px"),
  {
    key: "received_qty", label: "Received Qty", width: "130px", align: "right", numFmt: "#,##0.###",
    render: (row) => (row.received_qty != null ? `${Number(row.received_qty).toFixed(3)} ${row.uom_code || ""}`.trim() : "—"),
    copyValue: (row) => row.received_qty ?? "", filterValue: (row) => (row.received_qty != null ? String(Number(row.received_qty)) : "—"),
    value: (row) => num(row.received_qty),
  },
  text("invoice_number", "Invoice No.", "120px"),
  { ...text("grn_date", "GRN Date", "100px"), filterType: "date" },
  { ...text("invoice_date", "Invoice Date", "100px"), filterType: "date" },
  {
    key: "transporter", label: "Transporter", width: "180px",
    render: (row) => joined(row.transporter_code, row.transporter_name) || "—", copyValue: (row) => joined(row.transporter_code, row.transporter_name),
    filterValue: (row) => joined(row.transporter_code, row.transporter_name) || "—", value: (row) => joined(row.transporter_code, row.transporter_name),
  },
  text("lr_number", "LR Number", "110px"),
  { ...text("lr_date", "LR Date", "100px"), filterType: "date" },
  {
    key: "status", label: "Status", width: "100px",
    render: (row) => (
      <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusTone(row.status)}`}>
        {row.status}
      </span>
    ),
    filterValue: (row) => dash(row.status), value: (row) => row.status ?? "",
  },
];
// GE Number is new on this screen: available in the picker, off by default so the default view matches the old register.
const DEFAULT_HIDDEN_COLUMNS = new Set(["ge_number"]);
const PICKER_COLUMNS = COLUMN_DEFINITIONS.map((column) => ({ ...column, defaultHidden: DEFAULT_HIDDEN_COLUMNS.has(column.key) }));

function rowSearchText(row) {
  return COLUMN_DEFINITIONS.map((column) => String(column.value(row) ?? "")).join(" ").toLowerCase();
}

export default function GRNListPage() {
  const { runtimeContext } = useMenu();

  // Page 1 (Filters) and Page 2 (Output Grid) are separate full-page views, like IN03 -- never both at once.
  const [page, setPage] = useState(1);
  const [companyId, setCompanyId] = useState("");
  const [dateFrom, setDateFrom] = useState(() => istDate(-DEFAULT_RANGE_DAYS));
  const [dateTo, setDateTo] = useState(() => istDate(0));
  const [materialTypes, setMaterialTypes] = useState([]);
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
    // Under the ["procurement", "grns"] prefix on purpose: GRN posting and invoice mapping invalidate that prefix, so the
    // register refreshes itself after them.
    queryKey: ["procurement", "grns", "report", submittedParams],
    enabled: submittedParams != null,
    queryFn: () => getGrnReport(submittedParams),
  });
  const loading = reportQuery.isFetching;
  const error = reportQuery.error?.message ?? "";
  const allRows = useMemo(() => (Array.isArray(reportQuery.data?.items) ? reportQuery.data.items : []), [reportQuery.data]);

  const displayedRows = useMemo(() => {
    const term = allColumnSearch.trim().toLowerCase();
    return term ? allRows.filter((row) => rowSearchText(row).includes(term)) : allRows;
  }, [allRows, allColumnSearch]);

  const layoutMessage = useCallback((message, tone) => pushToast({ message, tone }), []);
  const layout = useColumnLayouts("GRN_REPORT", PICKER_COLUMNS, layoutMessage);
  const gridColumns = layout.columns;

  const buildParams = useCallback(() => ({
    company_id: effectiveCompanyId,
    date_from: dateFrom,
    date_to: dateTo,
    material_types: materialTypes.join(","),
    // MultiValueFilterField holds [{ value, label }] entries: send the ids (joining the objects gave "[object Object]").
    material_ids: materialValues.map((entry) => entry.value).join(","),
    statuses: statuses.join(","),
  }), [effectiveCompanyId, dateFrom, dateTo, materialTypes, materialValues, statuses]);

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

  function toggleIn(setter, value) {
    setter((current) => (current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value]));
  }

  function openDetail(row) {
    openScreen(OPERATION_SCREENS.PROC_GRN_DETAIL.screen_code, { context: { id: row.id } });
  }
  function openPostFlow() {
    openScreen(OPERATION_SCREENS.PROC_GRN_POST_FLOW.screen_code, {});
  }
  function openInvoiceMapping() {
    openScreen(OPERATION_SCREENS.PROC_GRN_INVOICE_MAPPING.screen_code, {});
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
      const criteria = submittedParams ?? {};
      const company = buildTransactionCompanyList(runtimeContext).find((entry) => String(entry.id) === String(criteria.company_id));
      const companyCode = String(company?.company_code || "company").replace(/[^A-Za-z0-9_-]+/g, "_");
      await downloadColoredExcelFile({
        fileName: `grn_register_${companyCode}_exported_${fileStamp}.xlsx`,
        sheetName: "GRN Register",
        columns: gridColumns,
        rows: gridRows,
        preambleRows: [
          ["Report", "GRN Register"],
          ["Company", company ? [company.company_code, company.company_name].filter(Boolean).join(" — ") : "-"],
          ["GRN Date", `${criteria.date_from || "…"} to ${criteria.date_to || "…"}`],
          ["Item Type", criteria.material_types || "All"],
          ["Material", criteria.material_ids ? `${criteria.material_ids.split(",").length} selected` : "All"],
          ["Status", criteria.statuses || "All"],
          ...(allColumnSearch.trim() ? [["Search", allColumnSearch.trim()]] : []),
          ...(gridRows.length !== displayedRows.length ? [["Column Filters", "Applied (only the filtered rows are exported)"]] : []),
          ["Rows", gridRows.length],
          ["Export Date", `${exportStamp} IST`],
        ],
        getCellValue: (row, column) => (typeof column.value === "function" ? column.value(row) : (row?.[column.key] ?? "")),
      });
    } catch (failure) {
      setExportError(failure instanceof Error ? failure.message : "GRN_REGISTER_EXPORT_FAILED");
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

  // Same Refresh hotkey as before, now re-running the report (only meaningful on the output page).
  useErpScreenHotkeys({
    refresh: {
      disabled: loading || page !== 2,
      perform: () => void reportQuery.refetch(),
    },
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

  const postAction = { key: "post-grn", label: "Post GRN (F6)", tone: "primary", onClick: openPostFlow };
  const mappingAction = { key: "invoice-mapping", label: "Invoice Mapping", tone: "neutral", onClick: openInvoiceMapping };

  return (
    <ErpScreenScaffold
      eyebrow="Procurement"
      title="Goods Receipts"
      notices={[
        ...(error ? [{ key: "grn-report-error", tone: "error", message: error }] : []),
        ...(exportError ? [{ key: "grn-report-export-error", tone: "error", message: exportError }] : []),
      ]}
      actions={
        page === 1
          ? [
              postAction,
              mappingAction,
              { key: "search", label: loading ? "Searching..." : "Search", tone: "primary", hint: "F8", onClick: handleSearch, disabled: loading || !effectiveCompanyId },
            ]
          : [
              postAction,
              mappingAction,
              { key: "back", label: "Back to Filters", hint: "Esc", onClick: () => setPage(1) },
              { key: "columns", label: "Columns", onClick: () => setColumnsOpen(true) },
              {
                key: "export",
                label: exporting ? "Exporting..." : "Export Excel",
                onClick: () => void handleExportExcel(),
                disabled: exporting || gridRows.length === 0,
              },
              { key: "refresh", label: loading ? "Refreshing…" : "Refresh", tone: "neutral", hint: "F8", onClick: handleSearch, disabled: loading || !effectiveCompanyId },
            ]
      }
    >
      {page === 1 ? (
        <div className="grid gap-4">
          <ErpSectionCard eyebrow="Page 1" title="Filters">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <TransactionCompanySelector runtimeContext={runtimeContext} value={companyId} onChange={setCompanyId} label="Company" />
              <label className="grid gap-1 text-[11px] font-medium text-slate-600">
                GRN Date from
                <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={DATE_INPUT_CLASS} />
              </label>
              <label className="grid gap-1 text-[11px] font-medium text-slate-600">
                GRN Date to
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
                      <input type="checkbox" checked={materialTypes.includes(type)} onChange={() => toggleIn(setMaterialTypes, type)} />
                      <span>{type}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset className="grid gap-1 text-[11px] font-medium text-slate-600">
                <legend className="mb-1">Status {statuses.length === 0 ? "(All)" : ""}</legend>
                <div className="flex flex-wrap items-center gap-3 text-sm text-slate-800">
                  {STATUS_OPTIONS.map((option) => (
                    <label key={option} className="inline-flex items-center gap-1.5">
                      <input type="checkbox" checked={statuses.includes(option)} onChange={() => toggleIn(setStatuses, option)} />
                      <span>{option}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
            <p className="mt-3 text-xs text-slate-500">Nothing ticked = all.</p>
          </ErpSectionCard>
        </div>
      ) : (
        <div className="grid gap-4">
          <ErpSectionCard eyebrow="Page 2" title="GRN Register">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <label className="min-w-[260px] flex-1 text-xs font-semibold uppercase tracking-[0.1em] text-slate-600">
                Search all columns
                <input
                  type="search"
                  value={allColumnSearch}
                  onChange={(event) => setAllColumnSearch(event.target.value)}
                  placeholder="GRN number, GE, vendor, material, invoice, LR..."
                  className="mt-1 h-9 w-full rounded border border-slate-300 bg-white px-3 text-sm font-normal normal-case tracking-normal text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                />
              </label>
              <span className="pb-2 text-sm text-slate-500">{loading ? "Loading..." : `${gridRows.length} of ${allRows.length} GRNs`}</span>
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
              rowKey={(row) => row.id}
              onRowActivate={openDetail}
              emptyMessage={
                loading
                  ? "Loading…"
                  : error
                    ? "The register could not be loaded — see the error above."
                    : allColumnSearch.trim()
                      ? "No GRN matches this search."
                      : "No GRNs matched the current filters."
              }
            />
            <p className="mt-2 text-xs text-slate-500">Enter opens the GRN.</p>
          </ErpSectionCard>
        </div>
      )}

      <ErpColumnVisibilityDrawer visible={columnsOpen} {...layoutDrawerProps(layout)} onClose={() => setColumnsOpen(false)} />
    </ErpScreenScaffold>
  );
}
