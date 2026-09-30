/*
 * File-ID: 27.5-REPORT
 * File-Path: frontend/src/pages/dashboard/production/PlanFeedCategoryReportPage.jsx
 * Purpose: Plan Feed "Report" -- read-only, always-live PO Type x Category
 *          summary. Date Range = the Order Date window, which picks an FO
 *          cohort. Against that SAME cohort (regardless of when
 *          production/dispatch actually happened): Order Qty, Production
 *          Qty (vs Order), Dispatch Qty (vs Order). Two more columns are
 *          independent of the cohort -- Actual Production / Actual Dispatch
 *          are activity that happened WITHIN the date range by its own date
 *          (Process PO Verify / posted Sales Invoice Tally date), regardless
 *          of which order it relates to. PO Type: MTO/HPS/MTEST. Category:
 *          Prodshade's own material_category, rolled up into a Category
 *          Group (letter prefix for MTO/MTEST -- PC/PX/S; as-is for HPS,
 *          whose Prodshades are individually named, not a numbered grade
 *          series).
 * Rendered as a tab on PlanFeedPage.jsx, NOT a separate route -- see
 * PlanFeedPrioritizePage.jsx's own header comment for why (screen-stack sync
 * bounce-back on route-only companions with no registered screen code).
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import TransactionCompanySelector from "../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../components/inputs/transactionCompanyRuntime.js";
import ErpDenseGrid from "../../../components/data/ErpDenseGrid.jsx";
import { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
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

export default function PlanFeedCategoryReportSection() {
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
    { key: "po_type", label: "PO Type", width: "75px" },
    { key: "category", label: "Category", width: "110px" },
    { key: "order_qty", label: "Order Qty", width: "105px", align: "right", copyValue: (r) => fmt(r.order_qty), excelValue: (r) => Number(r.order_qty ?? 0), numFmt: "#,##0.00", render: (r) => <span className="font-mono">{fmt(r.order_qty)}</span> },
    { key: "production_qty_vs_order", label: "Production Qty (vs Order)", width: "150px", align: "right", copyValue: (r) => fmt(r.production_qty_vs_order), excelValue: (r) => Number(r.production_qty_vs_order ?? 0), numFmt: "#,##0.00", render: (r) => <span className="font-mono">{fmt(r.production_qty_vs_order)}</span> },
    { key: "dispatch_qty_vs_order", label: "Dispatch Qty (vs Order)", width: "140px", align: "right", copyValue: (r) => fmt(r.dispatch_qty_vs_order), excelValue: (r) => Number(r.dispatch_qty_vs_order ?? 0), numFmt: "#,##0.00", render: (r) => <span className="font-mono">{fmt(r.dispatch_qty_vs_order)}</span> },
    { key: "actual_production_qty", label: "Actual Production", width: "125px", align: "right", copyValue: (r) => fmt(r.actual_production_qty), excelValue: (r) => Number(r.actual_production_qty ?? 0), numFmt: "#,##0.00", render: (r) => <span className="font-mono">{fmt(r.actual_production_qty)}</span> },
    { key: "actual_dispatch_qty", label: "Actual Dispatch", width: "120px", align: "right", copyValue: (r) => fmt(r.actual_dispatch_qty), excelValue: (r) => Number(r.actual_dispatch_qty ?? 0), numFmt: "#,##0.00", render: (r) => <span className="font-mono">{fmt(r.actual_dispatch_qty)}</span> },
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
    <>
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
          Date Range = Order Date, picking an FO cohort. Order Qty, Production Qty (vs Order) and Dispatch Qty (vs Order) are all measured against that SAME cohort, regardless of when production/dispatch actually happened. Actual Production and Actual Dispatch are independent -- activity that happened within the date range by its own date (Process PO Verify date / posted Invoice's Tally Invoice Date), regardless of which order it relates to.
        </p>
      </ErpSectionCard>
      <ErpSectionCard
        title={`Report (${rows.length} row${rows.length === 1 ? "" : "s"})`}
        actions={[{ key: "plan-feed-report-export", label: exporting ? "Exporting..." : "Export Excel", onClick: () => void handleExportExcel(), disabled: exporting || rows.length === 0 }]}
      >
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
            maxHeight="calc(100vh - 380px)"
            emptyMessage="No data for this company and date range."
          />
        )}
      </ErpSectionCard>
    </>
  );
}
