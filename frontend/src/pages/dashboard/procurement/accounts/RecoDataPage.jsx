/*
 * File-Path: frontend/src/pages/dashboard/procurement/accounts/RecoDataPage.jsx
 * Domain: PROCUREMENT / Accounts
 * Purpose: AC10 -- RECO DATA report. First real consumer of the
 *          Stock-vs-AP-Reco two-layer model (§104) -- Standard / Actual /
 *          AP Approved for every posted dispatch in a Tally Invoice Date
 *          range, plus a synthesized FG summary row per dispatch group,
 *          PARTIAL_REVERSAL (PR19) rows, and RPS "Shape 2" passthrough rows
 *          in the same grid, distinguished by row background only (never
 *          appended text -- numeric cells must stay pure numbers for Excel
 *          export, §135.6). Page 1 (Filters) / Page 2 (Output Grid) /
 *          Page 3 (Reco Summary Data, reached via the "Summary" button) --
 *          same shell as SO04/IN02/PR24/AC09.
 *          Column order and row shapes are copied verbatim from the locked
 *          mock (reco_data_mock.html) -- do not reorder without re-checking
 *          that mock first. Full design: feasibility doc Section 135.
 * Authority: Frontend
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import MultiValueFilterField from "../../../../components/inputs/MultiValueFilterField.jsx";
import TransactionCompanySelector from "../../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../../components/inputs/transactionCompanyRuntime.js";
import ErpScreenScaffold, { ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { useErpScreenHotkeys } from "../../../../hooks/useErpScreenHotkeys.js";
import { useScreenBackInterceptor } from "../../../../hooks/useScreenBackInterceptor.js";
import { MASTER_PICKER_FETCH_LIMIT, useMaterialOptionsQuery } from "../../../../hooks/queries/useOmMasterQueries.js";
import { getRecoData } from "../procurementApi.js";

const TYPE_OPTIONS = ["RM", "PM", "INT", "SFG", "FG"];
const FG_TYPE_OPTIONS = ["MTO", "HPS", "MTS", "MTEST"];
const DISPATCH_TYPE_OPTIONS = ["DEPENDENT_DIRECT", "DEPENDENT_DEPOT", "INDEPENDENT_PARTY", "INDEPENDENT_PARTY_ASIAN_BILLED", "DEPENDENT_NO_INBOUND", "STO"];
const DISPATCH_CATEGORY_OPTIONS = ["FRPS", "RPS", "SRPS", "FSRPS"];
const MAX_RANGE_DAYS = 366;

const TYPE_BADGE = {
  FG: { label: "FG", className: "bg-sky-900 text-white" },
  RM: { label: "RM", className: "bg-emerald-50 text-emerald-700" },
  PM: { label: "PM", className: "bg-fuchsia-50 text-fuchsia-700" },
  INT: { label: "INT", className: "bg-blue-50 text-blue-700" },
  SFG: { label: "SFG", className: "bg-amber-50 text-amber-700" },
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
function daysAgoIso(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}
function dateSpanTooWide(dateFrom, dateTo) {
  if (!dateFrom || !dateTo) return false;
  const from = new Date(`${dateFrom}T00:00:00.000Z`);
  const to = new Date(`${dateTo}T00:00:00.000Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return false;
  return Math.floor((to.getTime() - from.getTime()) / 86400000) > MAX_RANGE_DAYS;
}
function dateRangeInvalid(dateFrom, dateTo) {
  if (!dateFrom || !dateTo) return false;
  return new Date(`${dateTo}T00:00:00.000Z`) < new Date(`${dateFrom}T00:00:00.000Z`);
}
function fmtQty(value, decimals = 3) {
  if (value === null || value === undefined || value === "") return "—";
  const amount = Number(value);
  return Number.isFinite(amount) ? amount.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : "—";
}
function fmtPct(value) {
  if (value === null || value === undefined || value === "") return "—";
  const amount = Number(value);
  return Number.isFinite(amount) ? `${amount.toFixed(2)}%` : "—";
}
// Excel-safety rule (§135.6): a numeric cell's render() may carry color, but
// its exported value must always stay a pure number -- never text appended
// to a quantity. excelValue()/copyValue() below are the enforcement point.
const numericExcelValue = (field) => (row) => (row[field] === null || row[field] === undefined ? "" : Number(row[field]));

function TypeBadge({ rowType }) {
  const info = TYPE_BADGE[rowType] ?? { label: rowType ?? "—", className: "bg-slate-100 text-slate-600" };
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${info.className}`}>{info.label}</span>;
}

// Dosage%/Qty-per-Pack shares one column (locked mock): RM/INT show the
// stroke's dosage%, PM shows the packing PO's own qty-per-pack, FG blank.
// §135.6-F: reused for the sibling "Dosage % — SO Stroke" column too (same
// PM-vs-percent formatting rule), via the optional `field` prop.
function DosageOrQtyCell({ row, field = "dosage_or_qty" }) {
  const value = row[field];
  if (value === null || value === undefined) return <span className="text-slate-300">—</span>;
  return <span>{row.type_badge === "PM" ? fmtQty(value, 3) : fmtPct(value)}</span>;
}

function ApVarianceCell({ actual, approved }) {
  if (actual === null || actual === undefined || approved === null || approved === undefined) {
    return <span className="text-slate-300">—</span>;
  }
  const mismatch = Number(actual) !== Number(approved);
  return <span className={mismatch ? "rounded bg-rose-100 px-1 font-semibold text-rose-800" : ""}>{fmtQty(approved)}</span>;
}

const GRID_COLUMNS = [
  { key: "company_code", label: "Company", width: "90px", render: (r) => r.company_code || "—" },
  { key: "month_year", label: "Month-Year", width: "90px" },
  { key: "pace_doc_number", label: "PACE Doc #", width: "120px", render: (r) => r.pace_doc_number || "—" },
  { key: "tally_invoice_number", label: "Tally Invoice #", width: "140px", render: (r) => r.tally_invoice_number || "—" },
  { key: "tally_invoice_date", label: "Tally Inv. Date", width: "110px", render: (r) => r.tally_invoice_date || "—" },
  { key: "inbound_number", label: "IBN", width: "110px", render: (r) => r.inbound_number || "—" },
  { key: "fo_number", label: "FO #", width: "110px", render: (r) => r.fo_number || "—" },
  { key: "dispatch_type", label: "Dispatch Type", width: "150px", render: (r) => (r.dispatch_type || "—").replace(/_/g, " ") },
  { key: "dispatch_category", label: "Dispatch Cat.", width: "90px", render: (r) => r.dispatch_category || "—" },
  { key: "type_badge", label: "Type", width: "65px", render: (r) => <TypeBadge rowType={r.type_badge} />, copyValue: (r) => r.type_badge },
  { key: "fg_type", label: "FG Type", width: "75px", render: (r) => r.fg_type || "—" },
  { key: "pace_code", label: "PACE Code", width: "110px", render: (r) => r.pace_code || "—" },
  { key: "item_name", label: "Item Name", width: "200px", render: (r) => r.item_name || "—" },
  { key: "document_name", label: "Document Name", width: "170px", render: (r) => r.document_name || "—" },
  { key: "external_code", label: "External Code", width: "130px", render: (r) => r.external_code || "—" },
  { key: "costing_group", label: "Costing Group", width: "130px", render: (r) => r.costing_group || "—" },
  { key: "process_order_number", label: "Process PO #", width: "110px", render: (r) => r.process_order_number || "—" },
  { key: "batch_number", label: "Batch #", width: "100px", render: (r) => r.batch_number || "—" },
  { key: "packing_order_number", label: "Packing PO #", width: "110px", render: (r) => r.packing_order_number || "—" },
  { key: "sku_label", label: "SKU", width: "170px", render: (r) => r.sku_label || "—" },
  { key: "actual_prodshade_label", label: "Actual Prodshade", width: "170px", render: (r) => r.actual_prodshade_label || "—" },
  { key: "so_stroke", label: "SO Stroke", width: "75px", render: (r) => r.so_stroke || "—" },
  { key: "actual_stroke", label: "Actual Stroke", width: "85px", render: (r) => r.actual_stroke || "—" },
  { key: "invoice_total_qty_kg", label: "Dispatch Qty (kg) — Invoice Total", align: "right", width: "150px", render: (r) => fmtQty(r.invoice_total_qty_kg), excelValue: numericExcelValue("invoice_total_qty_kg") },
  { key: "invoice_total_pack_qty", label: "Pack Qty — Invoice Total", align: "right", width: "130px", render: (r) => fmtQty(r.invoice_total_pack_qty, 0), excelValue: numericExcelValue("invoice_total_pack_qty") },
  { key: "dispatch_qty_kg", label: "Dispatch Qty (kg)", align: "right", width: "115px", render: (r) => fmtQty(r.dispatch_qty_kg), excelValue: numericExcelValue("dispatch_qty_kg") },
  { key: "pack_qty", label: "Pack Qty", align: "right", width: "80px", render: (r) => fmtQty(r.pack_qty, 0), excelValue: numericExcelValue("pack_qty") },
  { key: "rps_qty", label: "RPS Qty (kg)", align: "right", width: "110px", render: (r) => fmtQty(r.rps_qty), excelValue: numericExcelValue("rps_qty") },
  { key: "dosage_pct_so_stroke", label: "Dosage % — SO Stroke", align: "right", width: "120px", render: (r) => <DosageOrQtyCell row={r} field="dosage_pct_so_stroke" />, excelValue: numericExcelValue("dosage_pct_so_stroke") },
  { key: "dosage_or_qty", label: "Dosage % / Qty per Pack", align: "right", width: "140px", render: (r) => <DosageOrQtyCell row={r} />, excelValue: numericExcelValue("dosage_or_qty") },
  { key: "standard_qty_so_stroke", label: "Standard Qty — SO Stroke", align: "right", width: "140px", render: (r) => fmtQty(r.standard_qty_so_stroke), excelValue: numericExcelValue("standard_qty_so_stroke") },
  { key: "standard_qty_dispatched_stroke", label: "Standard Qty — Dispatched Stroke", align: "right", width: "150px", render: (r) => fmtQty(r.standard_qty_dispatched_stroke), excelValue: numericExcelValue("standard_qty_dispatched_stroke") },
  { key: "actual_qty", label: "Actual Qty", align: "right", width: "110px", render: (r) => fmtQty(r.actual_qty), excelValue: numericExcelValue("actual_qty") },
  {
    key: "ap_approved_qty", label: "AP Approved Qty", align: "right", width: "120px",
    render: (r) => <ApVarianceCell actual={r.actual_qty} approved={r.ap_approved_qty} />,
    excelValue: numericExcelValue("ap_approved_qty"),
  },
];

const emptyFilters = () => ({
  dateFrom: daysAgoIso(30),
  dateTo: todayIso(),
  types: [],
  fgTypes: [],
  dispatchTypes: [],
  dispatchCategories: [],
  materialValues: [],
});

// Row background -- colour only, never appended text (§135.6 Excel-safety
// rule). FG summary rows get the bold "sku-row" treatment; a COR6-netted
// line and a Partial Reversal line both get the same amber "corrected"
// wash; RPS gets its own distinct tint so it never reads as a correction.
function rowClassName(row) {
  if (row.row_kind === "FG_SUMMARY") return "bg-sky-50/70 font-semibold";
  if (row.section === "PARTIAL_REVERSAL") return "bg-amber-50/80";
  if (row.is_corrected) return "bg-amber-50/80";
  if (row.section === "RPS") return "bg-violet-50/70";
  return "";
}

const SUMMARY_COLUMNS = [
  { key: "company_code", label: "Company", width: "90px", render: (r) => r.company_code || "—" },
  { key: "costing_group", label: "Costing Group Name", width: "150px", render: (r) => r.costing_group || "—" },
  { key: "item_name", label: "Item Name", width: "200px", render: (r) => r.item_name || "—" },
  { key: "external_code", label: "External Code", width: "130px", render: (r) => r.external_code || "—" },
  { key: "so_standard", label: "SO Standard", align: "right", width: "115px", render: (r) => fmtQty(r.so_standard), excelValue: numericExcelValue("so_standard") },
  { key: "dispatch_standard", label: "Dispatch Standard", align: "right", width: "130px", render: (r) => fmtQty(r.dispatch_standard), excelValue: numericExcelValue("dispatch_standard") },
  { key: "dispatch_actual", label: "Dispatch Actual", align: "right", width: "120px", render: (r) => fmtQty(r.dispatch_actual), excelValue: numericExcelValue("dispatch_actual") },
  { key: "dispatch_apl_approved", label: "Dispatch APL Approved", align: "right", width: "150px", render: (r) => fmtQty(r.dispatch_apl_approved), excelValue: numericExcelValue("dispatch_apl_approved") },
  { key: "mtest_standard", label: "MTEST Standard", align: "right", width: "120px", render: (r) => fmtQty(r.mtest_standard), excelValue: numericExcelValue("mtest_standard") },
  { key: "mtest_actual", label: "MTEST Actual", align: "right", width: "110px", render: (r) => fmtQty(r.mtest_actual), excelValue: numericExcelValue("mtest_actual") },
  { key: "dispatched_rps", label: "Dispatched RPS", align: "right", width: "115px", render: (r) => fmtQty(r.dispatched_rps), excelValue: numericExcelValue("dispatched_rps") },
  { key: "prev", label: "PREV", align: "right", width: "100px", render: (r) => fmtQty(r.prev), excelValue: numericExcelValue("prev") },
];

export default function RecoDataPage() {
  const { runtimeContext } = useMenu();
  const [companyId, setCompanyId] = useState("");
  useEffect(() => {
    const defaultCompanyId = resolveDefaultTransactionCompanyId(runtimeContext);
    if (defaultCompanyId && !companyId) setCompanyId(defaultCompanyId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtimeContext]);
  const effectiveCompanyId = companyId || resolveDefaultTransactionCompanyId(runtimeContext);

  const [filters, setFilters] = useState(emptyFilters);
  const [submittedParams, setSubmittedParams] = useState(null);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1); // 1 = filters, 2 = grid, 3 = summary
  // §135.12 -- a plain INDEPENDENT_PARTY RM/PM/INT sale is a real dispatch
  // with no Asian Paints reconciliation behind it. On by default (matches
  // the report's original AP-only scope); unticking on either Page 2 or
  // Page 3 reveals everything, including non-AP-billed sales -- one shared
  // toggle, visible on both pages.
  const [excludeNonApBilled, setExcludeNonApBilled] = useState(true);

  const materialsQuery = useMaterialOptionsQuery(
    { status: "ACTIVE", limit: MASTER_PICKER_FETCH_LIMIT, company_id: effectiveCompanyId },
    { enabled: Boolean(effectiveCompanyId) },
  );
  const materialOptions = useMemo(
    () => (materialsQuery.materials ?? []).map((material) => ({
      value: material.id,
      label: `${material.pace_code ?? "—"} — ${material.document_name || material.material_name || "—"}`,
    })),
    [materialsQuery.materials],
  );

  const reportQ = useQuery({
    queryKey: ["reco-data", submittedParams],
    queryFn: () => getRecoData(submittedParams),
    enabled: Boolean(submittedParams),
    select: (data) => (Array.isArray(data) ? data : data?.data ?? []),
  });
  const allRows = useMemo(() => reportQ.data ?? [], [reportQ.data]);
  const rows = useMemo(() => {
    const materialFilter = new Set((filters.materialValues ?? []).map((v) => v.value));
    const typeFilter = new Set(filters.types);
    const fgTypeFilter = new Set(filters.fgTypes);
    const dispatchTypeFilter = new Set(filters.dispatchTypes);
    const dispatchCategoryFilter = new Set(filters.dispatchCategories);
    return allRows.filter((row) => {
      if (excludeNonApBilled && row.is_asian_billed === false) return false;
      if (materialFilter.size > 0 && !materialFilter.has(row.material_id)) return false;
      if (typeFilter.size > 0 && !typeFilter.has(row.type_badge)) return false;
      if (fgTypeFilter.size > 0 && !fgTypeFilter.has((row.fg_type || "").toUpperCase())) return false;
      if (dispatchCategoryFilter.size > 0 && !dispatchCategoryFilter.has((row.dispatch_category || "").toUpperCase())) return false;
      if (dispatchTypeFilter.size > 0 && !dispatchTypeFilter.has((row.dispatch_type || "").toUpperCase())) return false;
      return true;
    });
  }, [allRows, excludeNonApBilled, filters.materialValues, filters.types, filters.fgTypes, filters.dispatchTypes, filters.dispatchCategories]);

  const [globalSearch, setGlobalSearch] = useState("");
  function getColumnFilterText(column, row) {
    if (typeof column.copyValue === "function") return String(column.copyValue(row) ?? "");
    const raw = row?.[column.key];
    return raw == null ? "" : String(raw);
  }
  const globalSearchOptions = useMemo(() => {
    const values = new Set();
    outer: for (const row of rows) {
      for (const column of GRID_COLUMNS) {
        const text = getColumnFilterText(column, row);
        if (text) values.add(text);
        if (values.size >= 500) break outer;
      }
    }
    return [...values].sort();
  }, [rows]);
  const hasActiveSearch = globalSearch.trim().length > 0;
  const filteredRows = useMemo(() => {
    const needle = globalSearch.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => GRID_COLUMNS.some((column) => getColumnFilterText(column, row).toLowerCase().includes(needle)));
  }, [rows, globalSearch]);

  // Page 3 -- Reco Summary Data. Grouped by (Company, PACE Code) -- one row
  // per material, every bucket (SO/Dispatch/MTEST/RPS/PREV) its own column
  // on that SAME row, never a separate row per bucket (locked mock's own
  // footnote: a material appearing in both a real dispatch and a Partial
  // Reversal lands on ONE row, each bucket filled independently). Summed
  // off the SAME already-netted Page 2 LINE rows -- no separate backend
  // aggregation endpoint (§135.7); the FG_SUMMARY rows are excluded here to
  // avoid double-counting their own already-aggregated RM/INT totals.
  const [summaryMaterialType, setSummaryMaterialType] = useState("");
  const [summarySearch, setSummarySearch] = useState("");
  const summaryRows = useMemo(() => {
    const groups = new Map();
    for (const row of rows) {
      if (row.row_kind !== "LINE") continue;
      if (summaryMaterialType && row.type_badge !== summaryMaterialType) continue;
      const key = `${row.company_code}|${row.pace_code}`;
      const group = groups.get(key) ?? {
        key, company_code: row.company_code, costing_group: row.costing_group, item_name: row.item_name, external_code: row.external_code,
        so_standard: 0, dispatch_standard: 0, dispatch_actual: 0, dispatch_apl_approved: 0,
        mtest_standard: 0, mtest_actual: 0, dispatched_rps: 0, prev: 0,
      };
      if (row.section === "PARTIAL_REVERSAL") {
        group.prev += Number(row.ap_approved_qty ?? 0);
      } else if (row.section === "RPS") {
        group.dispatched_rps += Number(row.ap_approved_qty ?? 0);
      } else if (row.fg_type === "MTEST") {
        group.mtest_standard += Number(row.standard_qty_dispatched_stroke ?? 0);
        group.mtest_actual += Number(row.actual_qty ?? 0);
      } else {
        group.so_standard += Number(row.standard_qty_so_stroke ?? 0);
        group.dispatch_standard += Number(row.standard_qty_dispatched_stroke ?? 0);
        group.dispatch_actual += Number(row.actual_qty ?? 0);
        group.dispatch_apl_approved += Number(row.ap_approved_qty ?? 0);
      }
      groups.set(key, group);
    }
    return [...groups.values()].sort((a, b) => a.company_code.localeCompare(b.company_code) || a.item_name.localeCompare(b.item_name));
  }, [rows, summaryMaterialType]);
  const filteredSummaryRows = useMemo(() => {
    const needle = summarySearch.trim().toLowerCase();
    if (!needle) return summaryRows;
    return summaryRows.filter((row) => SUMMARY_COLUMNS.some((column) => {
      const text = typeof column.copyValue === "function" ? String(column.copyValue(row) ?? "") : String(row?.[column.key] ?? "");
      return text.toLowerCase().includes(needle);
    }));
  }, [summaryRows, summarySearch]);

  function updateFilter(key, value) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }
  function toggleMulti(key, value) {
    setFilters((prev) => ({
      ...prev,
      [key]: prev[key].includes(value) ? prev[key].filter((v) => v !== value) : [...prev[key], value],
    }));
  }
  function handleReset() {
    setFilters(emptyFilters());
    setSubmittedParams(null);
    setError("");
    setGlobalSearch("");
    setSummarySearch("");
    setSummaryMaterialType("");
    setExcludeNonApBilled(true);
    setPage(1);
  }
  function handleExecute() {
    setError("");
    setGlobalSearch("");
    if (!effectiveCompanyId) { setError("Select a company first."); return; }
    if (!filters.dateFrom || !filters.dateTo) { setError("A Tally Invoice Date range is required."); return; }
    if (dateRangeInvalid(filters.dateFrom, filters.dateTo)) { setError("Date To cannot be before Date From."); return; }
    if (dateSpanTooWide(filters.dateFrom, filters.dateTo)) { setError(`Date range cannot exceed ${MAX_RANGE_DAYS} days.`); return; }
    const nextParams = { company_id: effectiveCompanyId, date_from: filters.dateFrom, date_to: filters.dateTo };
    if (submittedParams && JSON.stringify(submittedParams) === JSON.stringify(nextParams)) {
      void reportQ.refetch();
      setPage(2);
      return;
    }
    setSubmittedParams(nextParams);
    setPage(2);
  }

  const [exporting, setExporting] = useState(false);
  async function handleExport() {
    if (filteredRows.length === 0) return;
    setExporting(true);
    try {
      const { downloadColoredExcelFile } = await import("../../../../shared/downloadColoredExcelFile.js");
      await downloadColoredExcelFile({
        fileName: `reco_data_${filters.dateFrom}_${filters.dateTo}.xlsx`,
        sheetName: "Reco Data",
        columns: GRID_COLUMNS,
        rows: filteredRows,
        getCellValue: (row, column) =>
          typeof column.excelValue === "function" ? column.excelValue(row)
            : typeof column.copyValue === "function" ? column.copyValue(row) : (row?.[column.key] ?? ""),
      });
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "RECO_DATA_EXPORT_FAILED");
    } finally {
      setExporting(false);
    }
  }
  async function handleExportSummary() {
    if (filteredSummaryRows.length === 0) return;
    setExporting(true);
    try {
      const { downloadColoredExcelFile } = await import("../../../../shared/downloadColoredExcelFile.js");
      await downloadColoredExcelFile({
        fileName: `reco_summary_data_${filters.dateFrom}_${filters.dateTo}.xlsx`,
        sheetName: "Reco Summary Data",
        columns: SUMMARY_COLUMNS,
        rows: filteredSummaryRows,
        getCellValue: (row, column) =>
          typeof column.excelValue === "function" ? column.excelValue(row)
            : typeof column.copyValue === "function" ? column.copyValue(row) : (row?.[column.key] ?? ""),
      });
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "RECO_SUMMARY_DATA_EXPORT_FAILED");
    } finally {
      setExporting(false);
    }
  }

  useScreenBackInterceptor(() => {
    if (page === 1) return false;
    if (page === 3) { setPage(2); return true; }
    setPage(1);
    return true;
  });
  useErpScreenHotkeys({
    focusPrimary: { perform: () => handleExecute() },
    refresh: { disabled: page === 1, perform: () => void reportQ.refetch() },
  });

  const activeError = error || (reportQ.error instanceof Error ? reportQ.error.message : "");

  if (page === 3) {
    return (
      <ErpScreenScaffold
        eyebrow="Accounts"
        title="Reco Summary Data"
        notices={activeError ? [{ key: "reco-summary-error", tone: "error", message: activeError }] : []}
        actions={[
          { key: "back", label: "Back to Reco Data", hint: "Esc", onClick: () => setPage(2) },
          { key: "export", label: exporting ? "Exporting..." : "Export Excel", onClick: () => void handleExportSummary(), disabled: exporting || filteredSummaryRows.length === 0 },
        ]}
      >
        <div className="grid gap-4">
          <ErpSectionCard eyebrow="Page 3" title={`Reco Summary Data (${filters.dateFrom} to ${filters.dateTo})`}>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <select
                value={summaryMaterialType}
                onChange={(e) => setSummaryMaterialType(e.target.value)}
                className="h-8 rounded border border-slate-300 bg-white px-2 text-sm text-slate-700"
              >
                <option value="">All Material Types</option>
                {TYPE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
              <input
                list="reco-summary-search-options"
                value={summarySearch}
                onChange={(e) => setSummarySearch(e.target.value)}
                placeholder="Search across every column..."
                className="h-8 w-full max-w-md rounded border border-slate-300 bg-white px-2.5 text-sm text-slate-800 outline-none focus:border-sky-500"
              />
              <label className="flex items-center gap-1.5 text-xs text-slate-600">
                <input type="checkbox" checked={excludeNonApBilled} onChange={(e) => setExcludeNonApBilled(e.target.checked)} />
                Exclude non-AP-billed
              </label>
              <span className="text-xs text-slate-500">{filteredSummaryRows.length} line{filteredSummaryRows.length === 1 ? "" : "s"}</span>
            </div>
            <ErpDenseGrid
              columns={SUMMARY_COLUMNS}
              rows={filteredSummaryRows}
              rowKey={(row) => row.key}
              virtualize
              rangeSelect
              maxHeight="calc(100vh - 260px)"
              emptyMessage={reportQ.isLoading ? "Loading..." : "No rows in this range."}
            />
          </ErpSectionCard>
        </div>
      </ErpScreenScaffold>
    );
  }

  return (
    <ErpScreenScaffold
      eyebrow="Accounts"
      title="Reco Data"
      notices={activeError ? [{ key: "reco-data-error", tone: "error", message: activeError }] : []}
      actions={
        page === 1
          ? [
              { key: "reset", label: "Reset", onClick: handleReset },
              { key: "execute", label: "Execute", tone: "primary", onClick: handleExecute },
            ]
          : [
              { key: "back", label: "Back to Filters", hint: "Esc", onClick: () => setPage(1) },
              { key: "export", label: exporting ? "Exporting..." : "Export Excel", onClick: () => void handleExport(), disabled: exporting || filteredRows.length === 0 },
              { key: "summary", label: "Summary", onClick: () => setPage(3), disabled: filteredRows.length === 0 },
              {
                key: "execute",
                label: reportQ.isFetching ? "Executing..." : "Execute Again",
                tone: "primary",
                onClick: handleExecute,
                disabled: reportQ.isFetching,
              },
            ]
      }
    >
      {page === 1 ? (
        <div className="grid gap-4">
          <ErpSectionCard eyebrow="Page 1" title="Selection Screen">
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
                <TransactionCompanySelector runtimeContext={runtimeContext} value={companyId} onChange={setCompanyId} label="Company" />
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-500">Tally Invoice Date <span className="text-rose-500">*</span></label>
                  <div className="flex items-center gap-1.5">
                    <input type="date" className="rounded border border-slate-300 px-2 py-1 text-sm" value={filters.dateFrom} onChange={(e) => updateFilter("dateFrom", e.target.value)} />
                    <span className="text-slate-400">-</span>
                    <input type="date" className="rounded border border-slate-300 px-2 py-1 text-sm" value={filters.dateTo} onChange={(e) => updateFilter("dateTo", e.target.value)} />
                  </div>
                </div>
                <MultiValueFilterField
                  label="Material"
                  placeholder="All materials"
                  value={filters.materialValues}
                  onChange={(value) => updateFilter("materialValues", value)}
                  options={materialOptions}
                  loadError={materialsQuery.error instanceof Error ? materialsQuery.error.message : ""}
                  disabled={!effectiveCompanyId}
                />
              </div>

              <div>
                <p className="mb-1.5 text-xs text-slate-500">Type:</p>
                <div className="flex flex-wrap gap-1.5">
                  {TYPE_OPTIONS.map((option) => (
                    <button key={option} type="button" onClick={() => toggleMulti("types", option)}
                      className={`rounded-full border px-2.5 py-1 text-xs font-medium ${filters.types.includes(option) ? "border-sky-500 bg-sky-50 text-sky-700" : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"}`}>
                      {option}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-1.5 text-xs text-slate-500">FG Type:</p>
                <div className="flex flex-wrap gap-1.5">
                  {FG_TYPE_OPTIONS.map((option) => (
                    <button key={option} type="button" onClick={() => toggleMulti("fgTypes", option)}
                      className={`rounded-full border px-2.5 py-1 text-xs font-medium ${filters.fgTypes.includes(option) ? "border-sky-500 bg-sky-50 text-sky-700" : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"}`}>
                      {option}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-1.5 text-xs text-slate-500">Dispatch Type:</p>
                <div className="flex flex-wrap gap-1.5">
                  {DISPATCH_TYPE_OPTIONS.map((option) => (
                    <button key={option} type="button" onClick={() => toggleMulti("dispatchTypes", option)}
                      className={`rounded-full border px-2.5 py-1 text-xs font-medium ${filters.dispatchTypes.includes(option) ? "border-sky-500 bg-sky-50 text-sky-700" : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"}`}>
                      {option.replace(/_/g, " ")}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-1.5 text-xs text-slate-500">Dispatch Category:</p>
                <div className="flex flex-wrap gap-1.5">
                  {DISPATCH_CATEGORY_OPTIONS.map((option) => (
                    <button key={option} type="button" onClick={() => toggleMulti("dispatchCategories", option)}
                      className={`rounded-full border px-2.5 py-1 text-xs font-medium ${filters.dispatchCategories.includes(option) ? "border-sky-500 bg-sky-50 text-sky-700" : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"}`}>
                      {option}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-end border-t border-dashed border-slate-200 pt-3">
                <button type="button" onClick={handleExecute} className="rounded bg-sky-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-sky-700">
                  Execute
                </button>
              </div>
            </div>
          </ErpSectionCard>
        </div>
      ) : (
        <div className="grid gap-4">
          <ErpSectionCard eyebrow="Page 2" title={`Reco Data (${filters.dateFrom} to ${filters.dateTo})`}>
            <div className="mb-2 flex items-center justify-between">
              <button type="button" onClick={() => setPage(1)} className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
                Back to Filters
              </button>
              <span className="text-xs text-slate-500">
                {reportQ.isLoading ? "Loading..." : `${filteredRows.length} row${filteredRows.length === 1 ? "" : "s"}`}
              </span>
            </div>
            <div className="mb-2 flex items-center gap-2">
              <input
                list="reco-data-search-options"
                value={globalSearch}
                onChange={(e) => setGlobalSearch(e.target.value)}
                placeholder="Search across every column..."
                className="h-8 w-full max-w-md rounded border border-slate-300 bg-white px-2.5 text-sm text-slate-800 outline-none focus:border-sky-500"
              />
              <datalist id="reco-data-search-options">
                {globalSearchOptions.map((option) => <option key={option} value={option} />)}
              </datalist>
              <label className="flex items-center gap-1.5 whitespace-nowrap text-xs text-slate-600">
                <input type="checkbox" checked={excludeNonApBilled} onChange={(e) => setExcludeNonApBilled(e.target.checked)} />
                Exclude non-AP-billed
              </label>
              {hasActiveSearch ? (
                <button type="button" onClick={() => setGlobalSearch("")} className="h-8 rounded border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-100">
                  Clear
                </button>
              ) : null}
            </div>
            <ErpDenseGrid
              columns={GRID_COLUMNS}
              rows={filteredRows}
              rowKey={(row, index) => `${row.group_key || "row"}-${row.material_id}-${row.row_kind}-${index}`}
              virtualize
              rangeSelect
              maxHeight="calc(100vh - 260px)"
              getRowProps={(row) => ({ className: rowClassName(row) })}
              emptyMessage={
                reportQ.isLoading
                  ? "Loading..."
                  : hasActiveSearch
                    ? "No rows match this search."
                    : "No dispatches in this range."
              }
            />
          </ErpSectionCard>
        </div>
      )}
    </ErpScreenScaffold>
  );
}
