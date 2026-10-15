/*
 * File-Path: frontend/src/pages/dashboard/procurement/sales/DOListPage.jsx
 * Domain: PROCUREMENT / Sales
 * Purpose: §113 Stage 2 — Delivery Order list. Shared by SO and STO
 *          dispatches (dc_type SALES/STO). TX code SO03, GRP_ACL_SALES.
 * Authority: Frontend
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import QuickFilterInput from "../../../../components/inputs/QuickFilterInput.jsx";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import TransactionCompanySelector from "../../../../components/inputs/TransactionCompanySelector.jsx";
import { buildTransactionCompanyList, resolveDefaultTransactionCompanyId } from "../../../../components/inputs/transactionCompanyRuntime.js";
import ErpMasterListTemplate from "../../../../components/templates/ErpMasterListTemplate.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { useErpScreenHotkeys } from "../../../../hooks/useErpScreenHotkeys.js";
import { getActiveScreenContext, openScreen, updateActiveScreenContext } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import { listDeliveryOrders } from "../procurementApi.js";
import BulkDoUploadDrawer from "./BulkDoUploadDrawer.jsx";
import EditTransporterDetailsDrawer from "./EditTransporterDetailsDrawer.jsx";
import AplInvoiceCaseDrawer from "./AplInvoiceCaseDrawer.jsx";
import VdcTruckDispatchUploadDrawer from "./VdcTruckDispatchUploadDrawer.jsx";

// The register is loaded whole (no pagination): the server pages at most
// 200 DOs per request, so the list is fetched page by page and joined.
const FETCH_PAGE_SIZE = 200;

// Every date column of the register can drive the date range.
const DATE_FILTER_OPTIONS = [
  { value: "DC_DATE", label: "DO Date" },
  { value: "LR_DATE", label: "LR Date" },
  { value: "DISPATCH_DATE", label: "Dispatch Date" },
  { value: "TALLY_INVOICE_DATE", label: "Tally Invoice Date" },
];

// §133.16-A UI standard.
// Every dispatch detail a user enters -- on Create DO or Bulk DO Upload --
// is shown here, in front of the wide Bill-To/Ship-To text so it is visible
// without horizontal scrolling.
const DO_EXPORT_COLUMNS = [
  { key: "dc_number", label: "DO Number" },
  { key: "fo_number_display", label: "FO Number" },
  { key: "source_document_number", label: "SO / STO Number" },
  { key: "production_type_display", label: "Production Type" },
  { key: "dc_date", label: "DO Date" },
  { key: "transporter_display", label: "Transporter" },
  { key: "lr_number", label: "LR Number" },
  { key: "lr_date", label: "LR Date" },
  { key: "vehicle_number", label: "Truck Number" },
  { key: "dispatch_date", label: "Dispatch Date" },
  { key: "tally_invoice_number", label: "Tally Invoice Number" },
  { key: "tally_invoice_date", label: "Tally Invoice Date" },
  { key: "inbound_number", label: "Inbound Number" },
  { key: "apl_invoice", label: "APL Invoice" },
  { key: "status", label: "Status" },
  { key: "customer_display", label: "Bill-To" },
  { key: "ship_to_display", label: "Ship-To" },
  { key: "source_display", label: "Source" },
  { key: "dispatch_category", label: "Dispatch Category" },
  { key: "total_qty", label: "Total Qty" },
  { key: "total_value", label: "Total Value" },
];

const DO_SEARCH_COLUMN_KEYS = DO_EXPORT_COLUMNS.map((column) => column.key);

function doStatusTone(status) {
  switch (String(status || "").toUpperCase()) {
    case "DISPATCHED": return "bg-sky-100 text-sky-800";
    case "CLOSED": return "bg-emerald-100 text-emerald-800";
    case "CANCELLED": return "bg-rose-100 text-rose-800";
    case "CREATED":
    default: return "bg-slate-100 text-slate-700";
  }
}

export default function DOListPage() {
  const navigate = useNavigate();
  const { runtimeContext } = useMenu();
  const [restoredBulkUploadDraft] = useState(() => getActiveScreenContext()?.bulkDoUploadDraft ?? null);
  // Returning from Transporter Master remounts this page.  The Bulk DO draft
  // was previewed against a specific company; restoring the page on the
  // default company instead would re-check every FO/SO against the wrong
  // company and report them all as FO_SO_NOT_FOUND.
  const [companyId, setCompanyId] = useState(() => restoredBulkUploadDraft?.company_id ?? "");
  const [status, setStatus] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [dateField, setDateField] = useState("DC_DATE");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [bulkUploadOpen, setBulkUploadOpen] = useState(Boolean(restoredBulkUploadDraft));
  const [editTransporterOpen, setEditTransporterOpen] = useState(false);
  const [aplInvoiceCaseOpen, setAplInvoiceCaseOpen] = useState(false);
  const [vdcTruckDispatchOpen, setVdcTruckDispatchOpen] = useState(false);
  const effectiveCompanyId = companyId || resolveDefaultTransactionCompanyId(runtimeContext);

  // Server search runs on the whole register; wait for typing to pause.
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), 400);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  // A date range is applied only once both dates are given and in order.
  const dateRangeError = dateFrom && dateTo && dateFrom > dateTo ? "From Date is after To Date." : "";
  const dateRangeActive = Boolean(dateFrom && dateTo && !dateRangeError);

  const params = useMemo(
    () => ({
      company_id: effectiveCompanyId || undefined,
      status: status || undefined,
      search: search || undefined,
      ...(dateRangeActive ? { date_field: dateField, date_from: dateFrom, date_to: dateTo } : {}),
    }),
    [dateField, dateFrom, dateRangeActive, dateTo, effectiveCompanyId, search, status]
  );

  const doQuery = useQuery({
    queryKey: ["procurement", "delivery-orders", "all", params],
    queryFn: async () => {
      const items = [];
      let total = 0;
      // DEPENDENT: each request's offset follows the rows already received.
      for (let offset = 0; ; offset += FETCH_PAGE_SIZE) {
        const result = await listDeliveryOrders({ ...params, limit: FETCH_PAGE_SIZE, offset });
        const pageItems = Array.isArray(result?.items) ? result.items : [];
        total = Number(result?.total ?? pageItems.length);
        items.push(...pageItems);
        if (pageItems.length < FETCH_PAGE_SIZE || items.length >= total) break;
      }
      return { items, total };
    },
    enabled: Boolean(effectiveCompanyId),
  });

  const allRows = useMemo(() => (Array.isArray(doQuery.data?.items) ? doQuery.data.items : []), [doQuery.data]);
  const loading = doQuery.isLoading;

  const searchOptions = useMemo(() => {
    const values = new Set();
    for (const row of allRows) {
      for (const key of DO_SEARCH_COLUMN_KEYS) {
        const text = row[key];
        if (text) values.add(String(text));
      }
    }
    return [...values].sort();
  }, [allRows]);

  const total = allRows.length;
  const rows = allRows;

  useErpScreenHotkeys({
    refresh: { disabled: loading, perform: () => void doQuery.refetch() },
  });

  function openCreateDO() {
    openScreen(OPERATION_SCREENS.PROC_DO_CREATE.screen_code);
    navigate("/dashboard/procurement/delivery-orders/create");
  }

  function openDODetail(row) {
    openScreen(OPERATION_SCREENS.PROC_DO_DETAIL.screen_code, { context: { id: row.id } });
    navigate(`/dashboard/procurement/delivery-orders/${encodeURIComponent(row.id)}`);
  }

  // Exports exactly the loaded list: the whole register, or the filtered one.
  async function handleExport() {
    if (rows.length === 0) return;
    setExporting(true);
    setExportError("");
    try {
      const { downloadColoredExcelFile } = await import("../../../../shared/downloadColoredExcelFile.js");
      const now = new Date();
      const exportStamp = now.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
      const fileStamp = now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
      const company = buildTransactionCompanyList(runtimeContext).find((entry) => String(entry.id) === String(effectiveCompanyId));
      const companyCode = company?.company_code || "company";
      const dateLabel = DATE_FILTER_OPTIONS.find((option) => option.value === dateField)?.label ?? dateField;
      await downloadColoredExcelFile({
        fileName: `delivery_orders_${String(companyCode).replace(/[^A-Za-z0-9_-]+/g, "_")}_exported_${fileStamp}.xlsx`,
        sheetName: "Delivery Orders",
        columns: DO_EXPORT_COLUMNS,
        rows,
        preambleRows: [
          ["Report", "SO03 — Delivery Order Register"],
          ["Company", company ? [company.company_code, company.company_name].filter(Boolean).join(" — ") : "-"],
          ["Status", status || "All"],
          ["Date Filter", dateRangeActive ? `${dateLabel}: ${dateFrom} to ${dateTo}` : "None"],
          ...(search ? [["Search", search]] : []),
          ["Rows", rows.length],
          ["Export Date", `${exportStamp} IST`],
        ],
        getCellValue: (row, column) => {
          const value = row?.[column.key];
          if (column.key === "total_qty" || column.key === "total_value") return Number.isFinite(Number(value)) ? Number(value) : "";
          return value ?? "";
        },
      });
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "DO_EXPORT_FAILED");
    } finally {
      setExporting(false);
    }
  }

  function closeBulkUpload() {
    updateActiveScreenContext({ bulkDoUploadDraft: null });
    setBulkUploadOpen(false);
  }

  function openTransporterMasterForBulkUpload(draft) {
    updateActiveScreenContext({ bulkDoUploadDraft: draft });
    openScreen(OPERATION_SCREENS.PROC_TRANSPORTER_MASTER.screen_code);
  }

  return (
    <>
    <ErpMasterListTemplate
      eyebrow="Procurement"
      title="Delivery Order"
      actions={[
        { key: "refresh", label: loading ? "Refreshing..." : "Refresh", tone: "neutral", onClick: () => doQuery.refetch() },
        { key: "create", label: "Create DO", tone: "primary", onClick: openCreateDO },
        { key: "bulk-upload", label: "Bulk DO Upload", tone: "neutral", onClick: () => setBulkUploadOpen(true), disabled: !effectiveCompanyId },
        { key: "edit-transporter", label: "Edit Transporter Details", tone: "neutral", onClick: () => setEditTransporterOpen(true), disabled: !effectiveCompanyId },
        { key: "apl-invoice-case", label: "APL Invoice Case", tone: "neutral", onClick: () => setAplInvoiceCaseOpen(true), disabled: !effectiveCompanyId },
        { key: "truck-dispatch-upload", label: "Truck & Dispatch Upload", tone: "neutral", onClick: () => setVdcTruckDispatchOpen(true), disabled: !effectiveCompanyId },
        { key: "export", label: exporting ? "Exporting..." : "Export Excel", tone: "neutral", onClick: () => void handleExport(), disabled: exporting || rows.length === 0 },
      ]}
      notices={[
        ...(doQuery.error ? [{ key: "do-list-error", tone: "error", message: doQuery.error instanceof Error ? doQuery.error.message : "PROCUREMENT_DO_LIST_FAILED" }] : []),
        ...(exportError ? [{ key: "do-export-error", tone: "error", message: exportError }] : []),
        ...(dateRangeError ? [{ key: "do-date-error", tone: "warning", message: dateRangeError }] : []),
      ]}
      filterSection={{
        eyebrow: "Search And Filter",
        title: "Delivery orders dispatched from Sales Order or STO (§113 Stage 2)",
        children: (
          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
            <TransactionCompanySelector
              runtimeContext={runtimeContext}
              value={companyId}
              onChange={(value) => setCompanyId(value)}
              label="Company"
              hint=""
            />
            <label className="grid gap-1 text-[11px] font-medium text-slate-600">
              Date Column
              <select value={dateField} onChange={(event) => setDateField(event.target.value)} className="h-10 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500">
                {DATE_FILTER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-[11px] font-medium text-slate-600">
              From Date
              <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="h-10 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500" />
            </label>
            <label className="grid gap-1 text-[11px] font-medium text-slate-600">
              To Date
              <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="h-10 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500" />
            </label>
            <label className="grid gap-1 text-[11px] font-medium text-slate-600">
              Status
              <select value={status} onChange={(event) => setStatus(event.target.value)} className="h-10 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500">
                <option value="">ALL</option>
                {["CREATED", "DISPATCHED", "CLOSED", "CANCELLED"].map((entry) => <option key={entry} value={entry}>{entry}</option>)}
              </select>
            </label>
            <QuickFilterInput
              label="Search"
              value={searchInput}
              onChange={(value) => setSearchInput(value)}
              placeholder="Search every column: DO, SO/STO, customer, truck, total..."
              inputProps={{ list: "do-list-search-options" }}
            />
            <datalist id="do-list-search-options">
              {searchOptions.map((option) => <option key={option} value={option} />)}
            </datalist>
          </div>
        ),
      }}
      listSection={{
        eyebrow: "DO Register",
        title: loading ? "Loading delivery orders" : `${total} delivery order row${total === 1 ? "" : "s"}${dateRangeActive || status || search ? " (filtered)" : ""}`,
        children: (
          <div className="grid gap-3">
            {!effectiveCompanyId ? (
              <p className="text-slate-400 text-sm py-6 text-center">Select a company to view delivery orders.</p>
            ) : (
              <ErpDenseGrid
                cellNavigate
                columnFilter
                columns={[
                  { key: "dc_number", label: "DO Number", width: "120px" },
                  { key: "fo_number_display", label: "FO Number", width: "120px", render: (row) => row.fo_number_display || "—" },
                  { key: "source_document_number", label: "SO / STO Number", width: "130px", render: (row) => row.source_document_number || "—" },
                  { key: "production_type_display", label: "Production Type", width: "120px", render: (row) => row.production_type_display || "—" },
                  { key: "dc_date", label: "DO Date", width: "100px" },
                  { key: "transporter_display", label: "Transporter", width: "180px", render: (row) => row.transporter_display || "—" },
                  { key: "lr_number", label: "LR Number", width: "120px", render: (row) => row.lr_number || "—" },
                  { key: "lr_date", label: "LR Date", width: "100px", render: (row) => row.lr_date || "—" },
                  { key: "vehicle_number", label: "Truck Number", width: "120px", render: (row) => row.vehicle_number || "—" },
                  { key: "dispatch_date", label: "Dispatch Date", width: "110px", render: (row) => row.dispatch_date || "—" },
                  { key: "tally_invoice_number", label: "Tally Invoice Number", width: "150px", render: (row) => row.tally_invoice_number || "—" },
                  { key: "tally_invoice_date", label: "Tally Invoice Date", width: "120px", render: (row) => row.tally_invoice_date || "—" },
                  { key: "inbound_number", label: "Inbound Number", width: "120px", render: (row) => row.inbound_number || "—" },
                  { key: "apl_invoice", label: "APL Invoice", width: "130px", render: (row) => row.apl_invoice || "" },
                  {
                    key: "status",
                    label: "Status",
                    width: "130px",
                    render: (row) => <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${doStatusTone(row.status)}`}>{row.status}</span>,
                  },
                  { key: "customer_display", label: "Bill-To", width: "240px", render: (row) => row.customer_display || "—" },
                  { key: "ship_to_display", label: "Ship-To", width: "240px", render: (row) => row.ship_to_display || "—" },
                  { key: "source_display", label: "Source", width: "100px", render: (row) => (row.source_display === "SALES_ORDER" ? "Sales Order" : row.source_display === "STO" ? "STO" : "—") },
                  { key: "dispatch_category", label: "Dispatch Category", width: "140px", render: (row) => row.dispatch_category || "—" },
                  { key: "total_qty", label: "Total Qty", width: "100px", align: "right", render: (row) => Number(row.total_qty ?? 0).toFixed(2) },
                  { key: "total_value", label: "Total Value", width: "120px", render: (row) => (Number.isFinite(Number(row.total_value)) ? Number(row.total_value).toFixed(2) : "-") },
                ]}
                rows={rows}
                rowKey={(row) => row.id}
                onRowActivate={openDODetail}
                getRowProps={(row) => ({ onDoubleClick: () => openDODetail(row), className: "cursor-pointer hover:bg-sky-50" })}
                emptyMessage={loading ? "Loading delivery orders..." : "No delivery orders matched the current filter."}
                maxHeight="calc(100vh - 360px)"
                virtualize
              />
            )}
          </div>
        ),
      }}
    />
    {bulkUploadOpen ? (
      <BulkDoUploadDrawer
        companyId={effectiveCompanyId}
        initialDraft={restoredBulkUploadDraft}
        onClose={closeBulkUpload}
        onDraftRestored={() => updateActiveScreenContext({ bulkDoUploadDraft: null })}
        onOpenTransporterMaster={openTransporterMasterForBulkUpload}
        onSaved={() => doQuery.refetch()}
      />
    ) : null}
    {editTransporterOpen ? (
      <EditTransporterDetailsDrawer
        companyId={effectiveCompanyId}
        onClose={() => setEditTransporterOpen(false)}
        onSaved={() => void doQuery.refetch()}
      />
    ) : null}
    {aplInvoiceCaseOpen ? (
      <AplInvoiceCaseDrawer
        companyId={effectiveCompanyId}
        onClose={() => setAplInvoiceCaseOpen(false)}
        onSaved={() => void doQuery.refetch()}
      />
    ) : null}
    {vdcTruckDispatchOpen ? (
      <VdcTruckDispatchUploadDrawer
        companyId={effectiveCompanyId}
        onClose={() => setVdcTruckDispatchOpen(false)}
        onSaved={() => void doQuery.refetch()}
      />
    ) : null}
    </>
  );
}
