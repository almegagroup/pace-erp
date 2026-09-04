/*
 * File-ID: 27.FE-PR26
 * File-Path: frontend/src/pages/dashboard/production/ExcessConsumptionReportPage.jsx
 * Gate: 27
 * Domain: PRODUCTION
 * Purpose: PR26 "Excess Consumption Report" — replicates the business's manual Excel
 *          "Excess Consumption" tab. Row = one dispatch_reco line with a batch behind it
 *          (MTO/HPS/MTEST). "Actual" here is deliberately AP-Approved (not raw physical
 *          actual, which is PACE's own absorbed exposure, out of scope per §104.7).
 *          "Everyone Reports" (CAP_EVERYONE_REPORTS) — company-scoped, no per-row edit.
 * Authority: Frontend
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ErpDenseGrid from "../../../components/data/ErpDenseGrid.jsx";
import ErpMasterListTemplate from "../../../components/templates/ErpMasterListTemplate.jsx";
import TransactionCompanySelector from "../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../components/inputs/transactionCompanyRuntime.js";
import { useMenu } from "../../../context/useMenu.js";
import { listExcessConsumptionReport } from "./prodApi.js";

function firstDayOfMonthsAgo(monthsAgo) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - monthsAgo);
  return d.toISOString().slice(0, 10);
}
function today() {
  return new Date().toISOString().slice(0, 10);
}

function toDDMMYYYY(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (!match) return text;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function formatQty(value) {
  const num = Number(value ?? 0);
  return Number.isFinite(num) ? num.toLocaleString("en-IN", { maximumFractionDigits: 3 }) : "";
}
function formatPct(value) {
  const num = Number(value ?? 0);
  return Number.isFinite(num) ? `${num.toFixed(2)}%` : "";
}
function excelNum(value) {
  const num = Number(value ?? 0);
  return Number.isFinite(num) ? num : "";
}

const COLUMNS = [
  { key: "month", label: "Month", width: "80px" },
  { key: "order_number", label: "Order Number", width: "110px" },
  { key: "item_name", label: "Item Name", width: "200px" },
  { key: "external_code", label: "External Code", width: "110px" },
  { key: "document_name", label: "Document Name", width: "200px" },
  { key: "sku_item_name", label: "SKU Item Name", width: "200px" },
  {
    key: "batch_qty", label: "Batch Qty (Dispatch)", width: "130px", align: "right",
    render: (row) => formatQty(row.batch_qty), copyValue: (row) => formatQty(row.batch_qty),
    excelValue: (row) => excelNum(row.batch_qty), numFmt: "#,##0.000",
  },
  {
    key: "invoice_date", label: "Invoice Date", width: "100px",
    render: (row) => toDDMMYYYY(row.invoice_date), copyValue: (row) => toDDMMYYYY(row.invoice_date),
  },
  { key: "so_number", label: "SO Number", width: "110px" },
  { key: "fo_number", label: "FO Number", width: "110px" },
  {
    key: "standard_pct", label: "Standard % Dosage", width: "120px", align: "right",
    render: (row) => formatPct(row.standard_pct), copyValue: (row) => formatPct(row.standard_pct),
    excelValue: (row) => excelNum(row.standard_pct), numFmt: "0.00\"%\"",
  },
  {
    key: "standard_qty", label: "Standard (kg)", width: "110px", align: "right",
    render: (row) => formatQty(row.standard_qty), copyValue: (row) => formatQty(row.standard_qty),
    excelValue: (row) => excelNum(row.standard_qty), numFmt: "#,##0.000",
  },
  {
    key: "actual_pct", label: "Actual % Dosage (APL)", width: "140px", align: "right",
    render: (row) => formatPct(row.actual_pct), copyValue: (row) => formatPct(row.actual_pct),
    excelValue: (row) => excelNum(row.actual_pct), numFmt: "0.00\"%\"",
  },
  {
    key: "actual_usage_qty", label: "Actual Usage (kg, APL)", width: "150px", align: "right",
    render: (row) => formatQty(row.actual_usage_qty), copyValue: (row) => formatQty(row.actual_usage_qty),
    excelValue: (row) => excelNum(row.actual_usage_qty), numFmt: "#,##0.000",
  },
  {
    // APL - STD in base qty (kg) -- the absolute variance, alongside the existing
    // percentage-based Excess % column. Both figures derived client-side from the
    // same two API fields, no backend change needed.
    key: "apl_minus_std_qty", label: "APL - STD (kg)", width: "120px", align: "right",
    render: (row) => {
      const value = Number(row.actual_usage_qty ?? 0) - Number(row.standard_qty ?? 0);
      return (
        <span className={value > 0 ? "font-semibold text-rose-600" : value < 0 ? "text-emerald-600" : ""}>
          {formatQty(value)}
        </span>
      );
    },
    copyValue: (row) => formatQty(Number(row.actual_usage_qty ?? 0) - Number(row.standard_qty ?? 0)),
    excelValue: (row) => excelNum(Number(row.actual_usage_qty ?? 0) - Number(row.standard_qty ?? 0)),
    numFmt: "#,##0.000",
  },
  {
    key: "excess_pct", label: "Excess %", width: "100px", align: "right",
    render: (row) => (
      <span className={Number(row.excess_pct) > 0 ? "font-semibold text-rose-600" : Number(row.excess_pct) < 0 ? "text-emerald-600" : ""}>
        {formatPct(row.excess_pct)}
      </span>
    ),
    copyValue: (row) => formatPct(row.excess_pct),
    excelValue: (row) => excelNum(row.excess_pct), numFmt: "0.00\"%\"",
    excelColor: (row) => (Number(row.excess_pct) > 0 ? { fontArgb: "FFBE123C", bold: true } : null),
  },
];

export default function ExcessConsumptionReportPage() {
  const { runtimeContext } = useMenu();
  const defaultCompanyId = resolveDefaultTransactionCompanyId(runtimeContext);

  const [companyId, setCompanyId] = useState(defaultCompanyId || "");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState(firstDayOfMonthsAgo(1));
  const [dateTo, setDateTo] = useState(today());
  const [onlyVariance, setOnlyVariance] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");

  const effectiveCompanyId = companyId || defaultCompanyId;

  const listQuery = useQuery({
    // No `search` here -- it's applied client-side across every column below,
    // so typing never triggers a refetch (true instant/auto-suggest feel) and
    // isn't limited to whichever few fields a server-side filter happened to check.
    queryKey: ["pr26", "excess-consumption-report", { companyId: effectiveCompanyId, dateFrom, dateTo }],
    queryFn: () =>
      listExcessConsumptionReport({
        company_id: effectiveCompanyId,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
      }),
    enabled: Boolean(effectiveCompanyId && dateFrom && dateTo),
  });

  const allRows = useMemo(() => (Array.isArray(listQuery.data) ? listQuery.data : []), [listQuery.data]);
  // Both filters are pure client-side -- the full fetch already has every field
  // needed, so no extra round trip for either toggle/keystroke.
  // "Only variance": excess_pct != 0. Search: every column, via each column's own
  // copyValue (same text the grid/Excel export already show) -- so it matches
  // formatted dates/percentages/qty exactly as displayed, and any column added
  // later is automatically covered too, not just a hand-picked few fields.
  const rows = useMemo(() => {
    let result = onlyVariance ? allRows.filter((row) => Math.abs(Number(row.excess_pct ?? 0)) > 0.005) : allRows;
    const term = search.trim().toLowerCase();
    if (term) {
      result = result.filter((row) =>
        COLUMNS.some((column) => {
          const value = typeof column.copyValue === "function" ? column.copyValue(row) : row[column.key];
          return String(value ?? "").toLowerCase().includes(term);
        }));
    }
    return result;
  }, [allRows, onlyVariance, search]);

  async function handleExportExcel() {
    setExporting(true);
    setError("");
    try {
      const { downloadColoredExcelFile } = await import("../../../shared/downloadColoredExcelFile.js");
      await downloadColoredExcelFile({
        fileName: `pr26_excess_consumption_report_${dateFrom || "from"}_${dateTo || "to"}.xlsx`,
        sheetName: "PR26 Excess Consumption",
        columns: COLUMNS,
        rows,
        getCellValue: (row, column) =>
          typeof column.excelValue === "function" ? column.excelValue(row)
            : typeof column.copyValue === "function" ? column.copyValue(row) : (row?.[column.key] ?? ""),
        getCellColor: (row, column) =>
          typeof column.excelColor === "function" ? column.excelColor(row) : null,
      });
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "PR26_EXPORT_FAILED");
    } finally {
      setExporting(false);
    }
  }

  return (
    <ErpMasterListTemplate
      eyebrow="Production"
      title="PR26 · Excess Consumption Report"
      notices={error ? [{ key: "pr26-error", tone: "error", message: error }] : (listQuery.isError ? [{ key: "pr26-load-error", tone: "error", message: listQuery.error?.message || "Failed to load report." }] : [])}
      actions={[
        {
          key: "export",
          label: exporting ? "Exporting..." : "Export Excel",
          onClick: () => void handleExportExcel(),
          disabled: exporting || rows.length === 0,
        },
      ]}
      filterSection={{
        eyebrow: "",
        title: "",
        children: (
          <div className="grid gap-2 xl:grid-cols-[200px_260px_150px_150px_170px] items-end">
            <TransactionCompanySelector
              runtimeContext={runtimeContext}
              value={effectiveCompanyId}
              onChange={(value) => setCompanyId(value)}
              label="Company"
            />
            <label className="grid gap-1 text-[11px] font-medium text-slate-600">
              Search (all columns)
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Type to filter any column..."
                className="h-[26px] border border-slate-300 bg-white px-2 text-[11px] outline-none focus:border-sky-500"
              />
            </label>
            <label className="grid gap-1 text-[11px] font-medium text-slate-600">
              From date (Invoice)
              <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="h-[26px] border border-slate-300 bg-white px-2 text-[11px] outline-none focus:border-sky-500" />
            </label>
            <label className="grid gap-1 text-[11px] font-medium text-slate-600">
              To date (Invoice)
              <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="h-[26px] border border-slate-300 bg-white px-2 text-[11px] outline-none focus:border-sky-500" />
            </label>
            <label className="flex h-[26px] items-center gap-1.5 text-[11px] font-medium text-slate-600">
              <input
                type="checkbox"
                checked={onlyVariance}
                onChange={(event) => setOnlyVariance(event.target.checked)}
                className="h-3.5 w-3.5"
              />
              Only variance rows
            </label>
          </div>
        ),
      }}
      listSection={{
        eyebrow: "",
        title: "",
        children: (
          <ErpDenseGrid
            columns={COLUMNS}
            rows={rows}
            rowKey={(row, index) => `${row.order_number || "row"}::${row.external_code || ""}::${index}`}
            rangeSelect
            virtualize
            emptyMessage={
              !effectiveCompanyId ? "Select a company to view the report."
                : listQuery.isLoading ? "Loading..."
                : allRows.length === 0 ? "No batch-linked dispatches found for this range."
                : search.trim() ? "No rows match this search."
                : onlyVariance ? "No variance rows — every dispatch in this range matched its Standard dosage."
                : "No batch-linked dispatches found for this range."
            }
          />
        ),
      }}
    />
  );
}
