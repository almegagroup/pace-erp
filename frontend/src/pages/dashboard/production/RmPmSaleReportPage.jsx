/*
 * File-ID: 27.FE-PR25
 * File-Path: frontend/src/pages/dashboard/production/RmPmSaleReportPage.jsx
 * Gate: 27
 * Domain: PRODUCTION
 * Purpose: PR25 "RM/PM Sale Report" — month-end report replicating the business's manual
 *          Excel "RMPM Sale" tab. Row = one (Material, Month). Direct RM/PM/INT sale qty
 *          plus MTEST-derived RM/PM/INT content on 3 independent bases (Standard/Actual/
 *          AP-Approved) and 3 combined grand totals — the downloader picks which to use.
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
import { listRmPmSaleReport } from "./prodApi.js";

function firstDayOfMonthsAgo(monthsAgo) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - monthsAgo);
  return d.toISOString().slice(0, 10);
}
function today() {
  return new Date().toISOString().slice(0, 10);
}

function formatQty(value) {
  const num = Number(value ?? 0);
  return Number.isFinite(num) ? num.toLocaleString("en-IN", { maximumFractionDigits: 3 }) : "";
}
function excelQty(value) {
  const num = Number(value ?? 0);
  return Number.isFinite(num) ? num : "";
}

function buildColumns() {
  const qtyCol = (key, label, width = "110px") => ({
    key, label, width, align: "right",
    render: (row) => formatQty(row[key]),
    copyValue: (row) => formatQty(row[key]),
    excelValue: (row) => excelQty(row[key]),
    numFmt: "#,##0.000",
  });
  return [
    { key: "month", label: "Month", width: "90px" },
    { key: "item_type", label: "Item Type", width: "90px" },
    { key: "item_name", label: "Item Name", width: "220px" },
    { key: "external_code", label: "External Code", width: "120px" },
    { key: "document_name", label: "Document Name", width: "220px" },
    qtyCol("rm_pm_sale_qty", "RM/PM Sale (Direct)"),
    qtyCol("mtest_std_qty", "MTEST — STD"),
    qtyCol("mtest_actual_qty", "MTEST — Actual"),
    qtyCol("mtest_apl_qty", "MTEST — APL Approved"),
    qtyCol("total_std", "Total (RPS + MTEST STD)", "150px"),
    qtyCol("total_actual", "Total (RPS + MTEST Actual)", "150px"),
    qtyCol("total_apl", "Total (RPS + MTEST APL)", "150px"),
  ];
}

const COLUMNS = buildColumns();
const ITEM_TYPE_OPTIONS = ["RM", "PM", "INT"];

export default function RmPmSaleReportPage() {
  const { runtimeContext } = useMenu();
  const defaultCompanyId = resolveDefaultTransactionCompanyId(runtimeContext);

  const [companyId, setCompanyId] = useState(defaultCompanyId || "");
  const [search, setSearch] = useState("");
  const [itemType, setItemType] = useState("");
  const [dateFrom, setDateFrom] = useState(firstDayOfMonthsAgo(1));
  const [dateTo, setDateTo] = useState(today());
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");

  const effectiveCompanyId = companyId || defaultCompanyId;

  const listQuery = useQuery({
    // No `search` here -- filtered client-side across every column below (see
    // PR26's own note for why), so typing never triggers a refetch.
    queryKey: ["pr25", "rm-pm-sale-report", { companyId: effectiveCompanyId, dateFrom, dateTo }],
    queryFn: () =>
      listRmPmSaleReport({
        company_id: effectiveCompanyId,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
      }),
    enabled: Boolean(effectiveCompanyId && dateFrom && dateTo),
  });

  const allRows = useMemo(() => (Array.isArray(listQuery.data) ? listQuery.data : []), [listQuery.data]);
  const rows = useMemo(() => {
    let result = itemType ? allRows.filter((row) => row.item_type === itemType) : allRows;
    const term = search.trim().toLowerCase();
    if (term) {
      result = result.filter((row) =>
        COLUMNS.some((column) => {
          const value = typeof column.copyValue === "function" ? column.copyValue(row) : row[column.key];
          return String(value ?? "").toLowerCase().includes(term);
        }));
    }
    return result;
  }, [allRows, itemType, search]);

  async function handleExportExcel() {
    setExporting(true);
    setError("");
    try {
      const { downloadColoredExcelFile } = await import("../../../shared/downloadColoredExcelFile.js");
      await downloadColoredExcelFile({
        fileName: `pr25_rm_pm_sale_report_${dateFrom || "from"}_${dateTo || "to"}.xlsx`,
        sheetName: "PR25 RM-PM Sale Report",
        columns: COLUMNS,
        rows,
        getCellValue: (row, column) =>
          typeof column.excelValue === "function" ? column.excelValue(row)
            : typeof column.copyValue === "function" ? column.copyValue(row) : (row?.[column.key] ?? ""),
      });
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "PR25_EXPORT_FAILED");
    } finally {
      setExporting(false);
    }
  }

  return (
    <ErpMasterListTemplate
      eyebrow="Production"
      title="PR25 · RM/PM Sale Report"
      notices={error ? [{ key: "pr25-error", tone: "error", message: error }] : (listQuery.isError ? [{ key: "pr25-load-error", tone: "error", message: listQuery.error?.message || "Failed to load report." }] : [])}
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
          <div className="grid gap-2 xl:grid-cols-[200px_120px_260px_150px_150px] items-end">
            <TransactionCompanySelector
              runtimeContext={runtimeContext}
              value={effectiveCompanyId}
              onChange={(value) => setCompanyId(value)}
              label="Company"
            />
            <label className="grid gap-1 text-[11px] font-medium text-slate-600">
              Item Type
              <select value={itemType} onChange={(event) => setItemType(event.target.value)} className="h-[26px] border border-slate-300 bg-white px-2 text-[11px] outline-none focus:border-sky-500">
                <option value="">All</option>
                {ITEM_TYPE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
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
              From date
              <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="h-[26px] border border-slate-300 bg-white px-2 text-[11px] outline-none focus:border-sky-500" />
            </label>
            <label className="grid gap-1 text-[11px] font-medium text-slate-600">
              To date
              <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="h-[26px] border border-slate-300 bg-white px-2 text-[11px] outline-none focus:border-sky-500" />
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
            rowKey={(row) => `${row.material_id}::${row.month}`}
            rangeSelect
            virtualize
            emptyMessage={
              !effectiveCompanyId ? "Select a company to view the report."
                : listQuery.isLoading ? "Loading..."
                : allRows.length === 0 ? "No RM/PM/INT sale or MTEST dispatch found for this range."
                : "No rows match the current filter."
            }
          />
        ),
      }}
    />
  );
}
