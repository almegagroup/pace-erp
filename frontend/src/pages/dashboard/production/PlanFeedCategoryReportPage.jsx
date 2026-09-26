/*
 * File-ID: 27.5-REPORT
 * File-Path: frontend/src/pages/dashboard/production/PlanFeedCategoryReportPage.jsx
 * Purpose: Plan Feed "Report" -- read-only, always-live PO Type x Category
 *          summary (Order/Production/Dispatch Qty), each measured
 *          independently against its own date column within the selected
 *          range. PO Type: MTO/HPS/MTEST. Category: Prodshade's own
 *          material_category, rolled up into a Category Group (letter
 *          prefix for MTO/MTEST -- PC/PX/S; as-is for HPS, whose Prodshades
 *          are individually named, not a numbered grade series).
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import TransactionCompanySelector from "../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../components/inputs/transactionCompanyRuntime.js";
import ErpDenseGrid from "../../../components/data/ErpDenseGrid.jsx";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import { useMenu } from "../../../context/useMenu.js";
import { pushToast } from "../../../store/uiToast.js";
import { getPlanFeedCategoryReport } from "./prodApi.js";

function firstDayOfMonthIso() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
}
function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
function fmt(value) {
  return Number(value ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
// Matches StockHistoryPage's own Total row convention (bg-amber-100), same
// idiom, yellow shades per business owner's request -- lighter for a
// Category Group's own total, deeper for a PO Type's grand total.
function reportRowClassName(row) {
  if (row.row_type === "PO_TYPE_TOTAL") return "bg-yellow-300 font-bold border-t-2 border-yellow-500";
  if (row.row_type === "GROUP_TOTAL") return "bg-yellow-100 font-semibold border-t border-yellow-300";
  return "";
}
// Same two shades as reportRowClassName, as ARGB for the Excel export --
// yellow-100 (#FEF9C3) / yellow-300 (#FDE047), matching Total Table's own
// on-screen-vs-Excel color-parity convention (§130.13/130.14).
const GROUP_TOTAL_FILL_ARGB = "FFFEF9C3";
const PO_TYPE_TOTAL_FILL_ARGB = "FFFDE047";
function reportRowFillArgb(row) {
  if (row.row_type === "PO_TYPE_TOTAL") return PO_TYPE_TOTAL_FILL_ARGB;
  if (row.row_type === "GROUP_TOTAL") return GROUP_TOTAL_FILL_ARGB;
  return null;
}

export default function PlanFeedCategoryReportPage() {
  const { runtimeContext } = useMenu();
  const [companyId, setCompanyId] = useState("");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState(firstDayOfMonthIso());
  const [dateTo, setDateTo] = useState(todayIso());
  const [exporting, setExporting] = useState(false);

  const effectiveCompanyId = companyId || resolveDefaultTransactionCompanyId(runtimeContext);

  const reportQ = useQuery({
    queryKey: ["plan-feed-category-report", effectiveCompanyId, dateFrom, dateTo],
    queryFn: () => getPlanFeedCategoryReport({ company_id: effectiveCompanyId, date_from: dateFrom, date_to: dateTo }),
    select: (data) => (Array.isArray(data) ? data : []),
    enabled: Boolean(effectiveCompanyId && dateFrom && dateTo),
  });

  const rows = useMemo(() => {
    const list = reportQ.data ?? [];
    const term = search.trim().toLowerCase();
    if (!term) return list;
    return list.filter((row) => [row.po_type, row.category].some((v) => String(v ?? "").toLowerCase().includes(term)));
  }, [reportQ.data, search]);

  const columns = [
    { key: "po_type", label: "PO Type", width: "90px" },
    { key: "category", label: "Category", width: "160px" },
    { key: "order_qty", label: "Order Qty", width: "120px", align: "right", copyValue: (r) => fmt(r.order_qty), excelValue: (r) => Number(r.order_qty ?? 0), numFmt: "#,##0.00", render: (r) => <span className="font-mono">{fmt(r.order_qty)}</span> },
    { key: "production_qty", label: "Production Qty", width: "120px", align: "right", copyValue: (r) => fmt(r.production_qty), excelValue: (r) => Number(r.production_qty ?? 0), numFmt: "#,##0.00", render: (r) => <span className="font-mono">{fmt(r.production_qty)}</span> },
    { key: "dispatch_qty", label: "Dispatch Qty", width: "120px", align: "right", copyValue: (r) => fmt(r.dispatch_qty), excelValue: (r) => Number(r.dispatch_qty ?? 0), numFmt: "#,##0.00", render: (r) => <span className="font-mono">{fmt(r.dispatch_qty)}</span> },
  ];

  async function handleExportExcel() {
    setExporting(true);
    try {
      const { downloadColoredExcelFile } = await import("../../../shared/downloadColoredExcelFile.js");
      await downloadColoredExcelFile({
        fileName: `plan_feed_report_${dateFrom}_to_${dateTo}.xlsx`,
        sheetName: "Plan Feed Report",
        columns,
        rows,
        getCellValue: (row, column) => (typeof column.excelValue === "function" ? column.excelValue(row) : (row?.[column.key] ?? "")),
        getRowFillArgb: reportRowFillArgb,
        getCellColor: (row) => (row.row_type === "PO_TYPE_TOTAL" || row.row_type === "GROUP_TOTAL" ? { bold: true } : null),
      });
    } catch (err) {
      pushToast({ message: err instanceof Error ? err.message : "PLAN_FEED_REPORT_EXPORT_FAILED", tone: "error" });
    } finally {
      setExporting(false);
    }
  }

  return (
    <ErpScreenScaffold
      title="Plan Feed Report"
      subtitle="PO Type x Category -- Order / Production / Dispatch Qty, live (read-only)"
      actions={[{ key: "plan-feed-report-export", label: exporting ? "Exporting..." : "Export Excel", onClick: () => void handleExportExcel(), disabled: exporting || rows.length === 0 }]}
    >
      <ErpSectionCard title="Filters">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <TransactionCompanySelector runtimeContext={runtimeContext} value={companyId} onChange={setCompanyId} label="Company" hint="" />
          <label className="text-xs text-slate-500">
            Search
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search PO Type or Category..."
              className="mt-1 h-9 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
            />
          </label>
          <label className="text-xs text-slate-500">
            Date From
            <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)}
              className="mt-1 h-9 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500" />
          </label>
          <label className="text-xs text-slate-500">
            Date To
            <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)}
              className="mt-1 h-9 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500" />
          </label>
        </div>
        <p className="mt-2 text-[11px] text-slate-400">
          Order Qty is by each FO's own Order Date, Production Qty by the Process PO's Verify date (SFG level), Dispatch Qty by the posted Invoice's Tally Invoice Date -- each independent, not traced against one another.
        </p>
      </ErpSectionCard>
      <ErpSectionCard title={`Report (${rows.length} row${rows.length === 1 ? "" : "s"})`}>
        {!effectiveCompanyId ? (
          <p className="text-sm text-slate-400 py-4 text-center">Select a company to view the report.</p>
        ) : reportQ.isFetching ? (
          <p className="text-sm text-slate-400 py-4 text-center">Loading…</p>
        ) : (
          <ErpDenseGrid
            columns={columns}
            rows={rows}
            rowKey={(row, index) => `${row.po_type}-${row.category}-${index}`}
            getRowProps={(row) => ({ className: reportRowClassName(row) })}
            cellNavigate
            fitColumnWidths
            stickyFirstColumn
            maxHeight="calc(100vh - 340px)"
            emptyMessage="No data for this company and date range."
          />
        )}
      </ErpSectionCard>
    </ErpScreenScaffold>
  );
}
