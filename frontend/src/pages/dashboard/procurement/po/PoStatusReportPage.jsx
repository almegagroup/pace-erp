/*
 * File-Path: frontend/src/pages/dashboard/procurement/po/PoStatusReportPage.jsx
 * Domain: PROCUREMENT
 * Purpose: PO24 -- PO Status. Page 1 selection (company, PO date range, open only / all), Page 2 grid per vendor / PO / material
 *          line: PO qty, PO UoM, Delivered, In-transit, Open, Knocked off, QA Blocked, plus Knock-off (line) and Cancel PO buttons
 *          (a PO line split into lots also gets one row per lot under it: lot qty, received against that lot, open, blocked)
 *          that reuse the existing PO actions (same backend rules and access as the PO detail page).
 * Authority: Frontend
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ErpColumnVisibilityDrawer from "../../../../components/ErpColumnVisibilityDrawer.jsx";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import { layoutDrawerProps, useColumnLayouts } from "../../../../shared/columnLayouts/useColumnLayouts.js";
import { pushToast } from "../../../../store/uiToast.js";
import { buildTransactionCompanyList, resolveDefaultTransactionCompanyId } from "../../../../components/inputs/transactionCompanyRuntime.js";
import ErpScreenScaffold, { ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { useScreenBackInterceptor } from "../../../../hooks/useScreenBackInterceptor.js";
import { openActionPrompt } from "../../../../store/actionPrompt.js";
import { openActionConfirm } from "../../../../store/actionConfirm.js";
import { cancelPurchaseOrder, getPoStatusReport, knockOffPOLine } from "../procurementApi.js";

const todayIso = () => new Date().toISOString().slice(0, 10);
const yearStartIso = () => `${todayIso().slice(0, 4)}-01-01`;
const pill = (on) => `rounded-full border px-2.5 py-1 text-xs font-medium ${on ? "border-sky-500 bg-sky-50 text-sky-700" : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"}`;
const qty = (value) => (value === null || value === undefined ? "" : Number(value).toLocaleString("en-IN", { maximumFractionDigits: 3 }));
const pct = (part, whole) => (Number(whole) > 0 && Number(part) > 0 ? `${((Number(part) / Number(whole)) * 100).toFixed(1)}%` : "");
const ACTIVE_LINE = new Set(["OPEN", "PARTIALLY_RECEIVED"]);

export default function PoStatusReportPage() {
  const { runtimeContext } = useMenu();
  const queryClient = useQueryClient();
  const companies = useMemo(() => buildTransactionCompanyList(runtimeContext), [runtimeContext]);
  const defaultCompanyId = resolveDefaultTransactionCompanyId(runtimeContext);
  const [companyIds, setCompanyIds] = useState([]);
  useEffect(() => {
    if (companyIds.length === 0 && defaultCompanyId) setCompanyIds([defaultCompanyId]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultCompanyId]);
  const effectiveCompanyIds = companyIds.length > 0 ? companyIds : (defaultCompanyId ? [defaultCompanyId] : []);

  const [dateFrom, setDateFrom] = useState(yearStartIso);
  const [dateTo, setDateTo] = useState(todayIso);
  const [openOnly, setOpenOnly] = useState(true);
  const [submitted, setSubmitted] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);

  const reportQ = useQuery({
    queryKey: ["po-status-report", submitted],
    queryFn: () => getPoStatusReport(submitted),
    enabled: Boolean(submitted),
    select: (data) => data?.data ?? data ?? {},
  });
  const rows = useMemo(
    () => (reportQ.data?.rows ?? []).map((r) => ({ ...r, row_key: `${r.line_id}|${r.lot_number ?? ""}` })),
    [reportQ.data],
  );

  function toggleCompany(id) {
    setCompanyIds((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
  }
  function execute() {
    setError("");
    if (effectiveCompanyIds.length === 0) return setError("Select a company first.");
    if (!dateFrom || !dateTo) return setError("A date range is required.");
    if (dateTo < dateFrom) return setError("Date To cannot be before Date From.");
    setSubmitted({ company_ids: effectiveCompanyIds.join(","), date_from: dateFrom, date_to: dateTo, open_only: openOnly ? "true" : "false" });
    setPage(2);
  }
  useScreenBackInterceptor(() => {
    if (page === 1) return false;
    setPage(1);
    return true;
  });

  async function runAction(fn, doneMessage) {
    setBusy(true); setError(""); setNotice("");
    try {
      await fn();
      setNotice(doneMessage);
      await queryClient.invalidateQueries({ queryKey: ["po-status-report"] });
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "PROCUREMENT_PO_ACTION_FAILED");
    } finally {
      setBusy(false);
    }
  }
  async function knockOffLine(row) {
    if (Number(row.in_transit) > 0) {
      const proceed = await openActionConfirm({
        eyebrow: "Purchase Order",
        title: "Material already in transit for this line",
        message: `${qty(row.in_transit)} ${row.po_uom} already dispatched — this knock-off will NOT cancel or affect it. Only the remaining un-dispatched balance will be closed. Continue?`,
        confirmLabel: "Continue",
      });
      if (!proceed) return;
    }
    const reason = await openActionPrompt({ eyebrow: "Purchase Order", title: `Knock off ${row.po_number} line ${row.line_number}?`, label: "Knock-off reason", required: true });
    if (!reason) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await knockOffPOLine(row.po_id, row.line_id, { reason });
      setNotice("PO line knocked off.");
      await queryClient.invalidateQueries({ queryKey: ["po-status-report"] });
    } catch (actionError) {
      if (actionError?.code === "PROCUREMENT_BULK_CUTOFF_DATE_REQUIRED") {
        setBusy(false);
        const cutoff = await openActionPrompt({
          eyebrow: "Purchase Order", title: "Cutoff Date required", label: "Cutoff Date (YYYY-MM-DD)", required: true,
          message: "No later Bulk PO exists yet for this vendor/company/material — a Cutoff Date bounds this PO's Effective Date window.",
        });
        if (!cutoff) return;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(cutoff)) return setError("Cutoff Date must be in YYYY-MM-DD format.");
        await runAction(() => knockOffPOLine(row.po_id, row.line_id, { reason, cutoff_date: cutoff }), "PO line knocked off.");
        return;
      }
      setError(actionError instanceof Error ? actionError.message : "PROCUREMENT_PO_ACTION_FAILED");
    } finally {
      setBusy(false);
    }
  }
  async function cancelPo(row) {
    const reason = await openActionPrompt({ eyebrow: "Purchase Order", title: `Cancel PO ${row.po_number}?`, label: "Cancellation reason", required: true });
    if (!reason) return;
    await runAction(() => cancelPurchaseOrder(row.po_id, { reason }), `PO ${row.po_number} cancelled.`);
  }

  const columns = useMemo(() => {
    const text = (key, label, width, getter) => ({ key, label, width, render: getter, filterValue: getter, excelValue: getter });
    const num = (key, label, getter, width = "100px") => ({
      key, label, width, align: "right",
      render: (r) => qty(getter(r)), filterValue: (r) => qty(getter(r)), excelValue: (r) => Number(getter(r) ?? 0), numFmt: "#,##0.###",
    });
    return [
      text("company_code", "Company", "80px", (r) => r.company_code ?? ""),
      text("vendor", "Vendor", "190px", (r) => [r.vendor_code, r.vendor_name].filter(Boolean).join(" — ")),
      text("po_number", "PO", "110px", (r) => `${r.po_number ?? ""}${r.line_number ? ` / ${r.line_number}` : ""}`),
      text("po_date", "PO Date", "100px", (r) => r.po_date ?? ""),
      text("material", "Material", "250px", (r) => [r.pace_code, r.material_name].filter(Boolean).join(" — ")),
      text("lot_number", "Lot", "70px", (r) => r.lot_number ?? ""),
      text("lot_delivery_date", "Lot Delivery", "100px", (r) => r.lot_delivery_date ?? ""),
      num("po_qty", "PO Qty", (r) => r.po_qty),
      text("po_uom", "PO UoM", "70px", (r) => r.po_uom ?? ""),
      num("delivered", "Delivered", (r) => r.delivered),
      num("in_transit", "In-transit", (r) => r.in_transit),
      num("open_qty", "Open PO", (r) => r.open_qty),
      num("knocked_off_qty", "Knocked off", (r) => r.knocked_off_qty),
      num("blocked_qty", "QA Blocked", (r) => r.blocked_qty),
      text("blocked_pct", "Blocked %", "80px", (r) => pct(r.blocked_qty, r.delivered)),
      text("line_status", "Status", "130px", (r) => String(r.line_status ?? "").replace(/_/g, " ")),
      {
        key: "actions", label: "Action", width: "190px", pinned: true,
        render: (r) => (r.row_kind === "LINE" && ACTIVE_LINE.has(r.line_status) && r.po_status === "CONFIRMED" ? (
          <span className="flex gap-1">
            <button type="button" disabled={busy} onClick={(e) => { e.stopPropagation(); void knockOffLine(r); }}
              className="rounded border border-amber-400 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50">Knock-off</button>
            {Number(r.delivered) === 0 ? (
              <button type="button" disabled={busy} onClick={(e) => { e.stopPropagation(); void cancelPo(r); }}
                className="rounded border border-rose-300 bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-50">Cancel PO</button>
            ) : null}
          </span>
        ) : ""),
        filterValue: () => "", excelValue: () => "",
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);
  // Common column picker (visibility + order, up to 3 saved layouts per user), same as Plan Feed. The Action column stays fixed.
  const [columnsOpen, setColumnsOpen] = useState(false);
  const layoutMessage = useCallback((message, tone) => pushToast({ message, tone }), []);
  const layout = useColumnLayouts("PO24_STATUS", columns, layoutMessage);
  const gridColumns = layout.columns;

  async function exportExcel() {
    setExporting(true);
    try {
      const { downloadColoredExcelFile } = await import("../../../../shared/downloadColoredExcelFile.js");
      await downloadColoredExcelFile({
        fileName: `po_status_${submitted?.date_from}_${submitted?.date_to}.xlsx`, sheetName: "PO Status",
        columns: gridColumns.filter((c) => c.key !== "actions"), rows,
        getCellValue: (row, column) => (typeof column.excelValue === "function" ? column.excelValue(row) : (row?.[column.key] ?? "")),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "PO_STATUS_EXPORT_FAILED");
    } finally {
      setExporting(false);
    }
  }

  const activeError = error || (reportQ.error instanceof Error ? reportQ.error.message : "");
  const notices = [
    ...(activeError ? [{ key: "po-status-error", tone: "error", message: activeError }] : []),
    ...(notice ? [{ key: "po-status-notice", tone: "success", message: notice }] : []),
  ];
  const actions = page === 1
    ? [{ key: "execute", label: "Execute", tone: "primary", onClick: execute }]
    : [
      { key: "back", label: "Back to Filters", onClick: () => setPage(1) },
      { key: "columns", label: `Columns${layout.activeLayoutName ? ` · ${layout.activeLayoutName}` : ""}`, onClick: () => setColumnsOpen(true) },
      { key: "export", label: exporting ? "Exporting..." : "Export Excel", onClick: () => void exportExcel(), disabled: exporting || rows.length === 0 },
      { key: "again", label: reportQ.isFetching ? "Executing..." : "Execute Again", tone: "primary", onClick: execute, disabled: reportQ.isFetching },
    ];

  return (
    <ErpScreenScaffold eyebrow="Procurement" title="PO Status" notices={notices} actions={actions}>
      {page === 1 ? (
        <ErpSectionCard eyebrow="Page 1" title="Selection Screen">
          <div className="flex flex-col gap-4">
            <div>
              <p className="mb-1.5 text-xs text-slate-500">Company</p>
              <div className="flex flex-wrap gap-1.5">
                {companies.length <= 1 ? (
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600">
                    {companies[0] ? `${companies[0].company_code} — ${companies[0].company_name ?? ""}` : "—"}
                  </span>
                ) : companies.map((c) => (
                  <button key={c.id} type="button" onClick={() => toggleCompany(String(c.id))} className={pill(effectiveCompanyIds.includes(String(c.id)))} title={c.company_name}>
                    {c.company_code}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-500">PO date range <span className="text-rose-500">*</span></label>
              <div className="flex items-center gap-1.5">
                <input type="date" className="rounded border border-slate-300 px-2 py-1 text-sm" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                <span className="text-slate-400">-</span>
                <input type="date" className="rounded border border-slate-300 px-2 py-1 text-sm" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </div>
            </div>
            <div>
              <p className="mb-1.5 text-xs text-slate-500">Show</p>
              <div className="flex gap-1.5">
                <button type="button" onClick={() => setOpenOnly(true)} className={pill(openOnly)}>Open POs only</button>
                <button type="button" onClick={() => setOpenOnly(false)} className={pill(!openOnly)}>All (incl. delivered, knocked off, cancelled)</button>
              </div>
            </div>
          </div>
        </ErpSectionCard>
      ) : (
        <ErpSectionCard eyebrow="Page 2" title={`PO Status (${submitted?.date_from} to ${submitted?.date_to})`}>
          <div className="mb-2 text-right text-xs text-slate-500">{reportQ.isLoading ? "Loading..." : `${rows.length} PO line${rows.length === 1 ? "" : "s"}`}</div>
          <ErpDenseGrid
            cellNavigate columnFilter searchBar rangeSelect virtualize
            columns={gridColumns} rows={rows} rowKey={(r) => r.row_key}
            maxHeight="calc(100vh - 280px)"
            emptyMessage={reportQ.isLoading ? "Loading..." : "No PO lines for this selection."}
          />
        </ErpSectionCard>
      )}
      <ErpColumnVisibilityDrawer
        visible={columnsOpen}
        title="PO Status Columns"
        {...layoutDrawerProps(layout)}
        onClose={() => setColumnsOpen(false)}
      />
    </ErpScreenScaffold>
  );
}
