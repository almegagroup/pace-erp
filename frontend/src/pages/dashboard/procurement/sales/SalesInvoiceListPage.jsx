/*
 * File-Path: frontend/src/pages/dashboard/procurement/sales/SalesInvoiceListPage.jsx
 * Domain: PROCUREMENT / Sales
 * Purpose: §113.15 Stage 3 — SO02 DO-selection queue (business
 *          owner decision, 2026-07-31: reuse this same page/TX-code for
 *          both SO- and STO-sourced dispatches rather than a separate STO
 *          page). Lists Delivery Orders, not directly SO/STO -- DOs not
 *          yet PGI'd (status CREATED) sort to the top as action items;
 *          DISPATCHED ones sort below by date. "Prepare Invoices" opens the
 *          §133.13 invoice-group grid -- not a duplicate DO-detail page.
 * Authority: Frontend
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import TransactionCompanySelector from "../../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../../components/inputs/transactionCompanyRuntime.js";
import QuickFilterInput from "../../../../components/inputs/QuickFilterInput.jsx";
import ErpPaginationStrip from "../../../../components/ErpPaginationStrip.jsx";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpMasterListTemplate from "../../../../components/templates/ErpMasterListTemplate.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { useErpScreenHotkeys } from "../../../../hooks/useErpScreenHotkeys.js";
import { openScreen, openScreenWithContext } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import { downloadCsvFile } from "../../../../shared/downloadTabularFile.js";
import { listDeliveryOrders } from "../procurementApi.js";

const LIMIT = 100;

// §133.16-A UI standard.
const DO_QUEUE_EXPORT_COLUMNS = [
  { key: "dc_number", label: "DO Number" },
  { key: "source_display", label: "Source" },
  { key: "source_document_number", label: "SO / STO Number" },
  { key: "customer_display", label: "Customer" },
  { key: "bill_to_display", label: "Bill-To" },
  { key: "ship_to_display", label: "Ship-To" },
  { key: "dc_date", label: "DO Date" },
  { key: "status", label: "Status" },
  { key: "total_value", label: "Total Value" },
  { key: "invoice_number", label: "Invoice Number" },
  { key: "invoice_date", label: "Invoice Date" },
  { key: "tally_invoice_number", label: "Tally Invoice No." },
  { key: "tally_invoice_date", label: "Tally Invoice Date" },
  { key: "inbound_number", label: "Inbound Number" },
];

function getStatusTone(status) {
  switch (String(status || "").toUpperCase()) {
    case "DISPATCHED": return "bg-emerald-100 text-emerald-800";
    case "CANCELLED": return "bg-rose-100 text-rose-800";
    case "CREATED":
    default: return "bg-amber-100 text-amber-800";
  }
}

export default function SalesInvoiceListPage() {
  const navigate = useNavigate();
  const { runtimeContext } = useMenu();
  const [rows, setRows] = useState([]);
  const [companyId, setCompanyId] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadTick, setReloadTick] = useState(0);

  useErpScreenHotkeys({
    refresh: { disabled: loading, perform: () => setReloadTick((tick) => tick + 1) },
  });
  const effectiveCompanyId = companyId || resolveDefaultTransactionCompanyId(runtimeContext);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedSearch(search.trim().toLowerCase());
    }, 250);
    return () => window.clearTimeout(timeoutId);
  }, [search]);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError("");
      try {
        // CREATED-first-then-by-date can't be expressed as a single
        // PostgREST .order() (it's not a plain column) -- fetched as one
        // batch (LIMIT capped well above realistic per-page volume, same
        // trade-off already made for listPOOrderGroupsHandler's own merge)
        // and sorted client-side, then paginated in memory.
        const data = await listDeliveryOrders({
          company_id: effectiveCompanyId || undefined,
          limit: 2000,
          offset: 0,
        });
        if (!active) return;
        const items = Array.isArray(data?.items) ? data.items : [];
        const sorted = [...items].sort((a, b) => {
          const aPending = a.status === "CREATED" ? 0 : 1;
          const bPending = b.status === "CREATED" ? 0 : 1;
          if (aPending !== bPending) return aPending - bPending;
          if (aPending === 0) return String(a.dc_date || "").localeCompare(String(b.dc_date || ""));
          return String(b.dc_date || "").localeCompare(String(a.dc_date || ""));
        });
        setRows(sorted);
      } catch (loadError) {
        if (!active) return;
        setRows([]);
        setError(loadError instanceof Error ? loadError.message : "PROCUREMENT_DO_QUEUE_LIST_FAILED");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [effectiveCompanyId, reloadTick]);

  const filteredRows = useMemo(() => {
    if (!debouncedSearch) return rows;
    return rows.filter((row) => {
      const haystack = [row.dc_number, row.source_document_number, row.customer_display, row.invoice_number, row.tally_invoice_number]
        .filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(debouncedSearch);
    });
  }, [debouncedSearch, rows]);

  const pagedRows = useMemo(
    () => filteredRows.slice((page - 1) * LIMIT, page * LIMIT),
    [filteredRows, page]
  );
  const pageTotal = filteredRows.length;
  const totalPages = Math.max(1, Math.ceil(pageTotal / LIMIT));
  const startIndex = pageTotal === 0 ? 0 : (page - 1) * LIMIT + 1;
  const endIndex = pageTotal === 0 ? 0 : Math.min(page * LIMIT, pageTotal);

  function openDoDetail(row) {
    openScreenWithContext(OPERATION_SCREENS.PROC_DO_DETAIL.screen_code, { id: row.id, refreshOnReturn: true });
    navigate(`/dashboard/procurement/delivery-orders/${encodeURIComponent(row.id)}`);
  }

  function openPgiInvoice(row) {
    // §133.13 -- routes to the new IBN-driven multi-invoice page, not the
    // legacy single-invoice PgiInvoiceCreatePage (still on disk, additive
    // pattern, reachable only via its own now-unlinked route).
    openScreenWithContext(OPERATION_SCREENS.PROC_INV_PGI_CREATE.screen_code, { dcId: row.id, refreshOnReturn: true });
    navigate("/dashboard/procurement/sales-invoices/pgi-groups");
  }

  function openInvoiceDetail(row) {
    if (!row.invoice_id) return;
    openScreenWithContext(OPERATION_SCREENS.PROC_INV_DETAIL.screen_code, { id: row.invoice_id, refreshOnReturn: true });
    navigate(`/dashboard/procurement/sales-invoices/${encodeURIComponent(row.invoice_id)}`);
  }

  function handleExport() {
    if (pagedRows.length === 0) return;
    downloadCsvFile({
      fileName: `do_pgi_queue_${effectiveCompanyId || "all"}_page${page}.csv`,
      columns: DO_QUEUE_EXPORT_COLUMNS,
      rows: pagedRows,
    });
  }

  return (
    <ErpMasterListTemplate
      eyebrow="Procurement"
      title="PGI & Invoice — Select Delivery Order"
      actions={[
        { key: "refresh", label: loading ? "Refreshing..." : "Refresh", tone: "neutral", onClick: () => setReloadTick((tick) => tick + 1) },
        { key: "do-list", label: "All DOs", tone: "neutral", onClick: () => { openScreen(OPERATION_SCREENS.PROC_DO_LIST.screen_code); navigate("/dashboard/procurement/delivery-orders"); } },
        { key: "export", label: "Export Excel", tone: "neutral", onClick: handleExport, disabled: pagedRows.length === 0 },
      ]}
      notices={error ? [{ key: "do-queue-error", tone: "error", message: error }] : []}
      filterSection={{
        eyebrow: "Search And Filter",
        title: "Select a completed Delivery Order; invoice rows are calculated next",
        children: (
          <div className="grid gap-3 xl:grid-cols-[220px_minmax(0,1fr)]">
            <TransactionCompanySelector
              runtimeContext={runtimeContext}
              value={companyId}
              onChange={(nextValue) => { setCompanyId(nextValue); setPage(1); }}
              label="Company"
            />
            <QuickFilterInput label="Search" value={search} onChange={setSearch} primaryFocus placeholder="DO number, SO/STO number, invoice number, or customer" />
          </div>
        ),
      }}
      listSection={{
        eyebrow: "Delivery Orders",
        title: loading ? "Loading delivery orders" : `${pageTotal} delivery order row${pageTotal === 1 ? "" : "s"}`,
        children: (
          <div className="grid gap-3">
            <ErpPaginationStrip page={page} setPage={setPage} totalPages={totalPages} startIndex={startIndex} endIndex={endIndex} totalItems={pageTotal} />
            <ErpDenseGrid
              cellNavigate
              columns={[
                { key: "dc_number", label: "DO Number", width: "140px" },
                { key: "source_display", label: "Source", width: "100px", render: (row) => (row.source_display === "SALES_ORDER" ? "Sales Order" : row.source_display === "STO" ? "STO" : "—") },
                { key: "source_document_number", label: "SO / STO Number", width: "140px", render: (row) => row.source_document_number || "—" },
                 { key: "customer_display", label: "Customer / Counterparty", render: (row) => row.customer_display || "—" },
                { key: "vehicle_number", label: "Truck", width: "120px", render: (row) => row.vehicle_number || "—" },
                { key: "transporter_display", label: "Transporter", render: (row) => row.transporter_display || "—" },
                { key: "lr_number", label: "LR Number", width: "110px", render: (row) => row.lr_number || "—" },
                { key: "lr_date", label: "LR Date", width: "110px", render: (row) => row.lr_date || "—" },
                { key: "dc_date", label: "DO Date", width: "110px" },
                {
                  key: "status",
                  label: "Status",
                  width: "130px",
                  render: (row) => <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${getStatusTone(row.status)}`}>{row.status === "CREATED" ? "PENDING PGI" : row.status}</span>,
                },
                 { key: "total_value", label: "DO Value", width: "120px", render: (row) => (Number.isFinite(Number(row.total_value)) ? Number(row.total_value).toFixed(2) : "-") },
                {
                  key: "actions",
                  label: "",
                  width: "150px",
                  render: (row) => row.status === "CREATED" ? (
                    <button
                      type="button"
                      onClick={(event) => { event.stopPropagation(); openPgiInvoice(row); }}
                      className="border border-sky-700 bg-sky-100 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-sky-950"
                    >
                      Prepare Invoices
                    </button>
                  ) : row.invoice_id ? (
                    <button
                      type="button"
                      onClick={(event) => { event.stopPropagation(); openInvoiceDetail(row); }}
                      className="border border-slate-400 bg-white px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-700"
                    >
                      Open Invoice
                    </button>
                  ) : "—",
                },
              ]}
              rows={pagedRows}
              rowKey={(row) => row.id}
              onRowActivate={openDoDetail}
              getRowProps={(row) => ({ onDoubleClick: () => openDoDetail(row), className: "cursor-pointer hover:bg-sky-50" })}
              emptyMessage={loading ? "Loading delivery orders..." : effectiveCompanyId ? "No delivery orders matched the current filter." : "No company resolved for this session."}
            />
          </div>
        ),
      }}
    />
  );
}
