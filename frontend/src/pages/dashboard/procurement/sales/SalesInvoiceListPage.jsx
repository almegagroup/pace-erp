/*
 * File-Path: frontend/src/pages/dashboard/procurement/sales/SalesInvoiceListPage.jsx
 * Domain: PROCUREMENT / Sales
 * Purpose: §113.15 Stage 3 — SO02 rebuilt as the DO / PGI queue (business
 *          owner decision, 2026-07-31: reuse this same page/TX-code for
 *          both SO- and STO-sourced dispatches rather than a separate STO
 *          page). Lists Delivery Orders, not directly SO/STO -- DOs not
 *          yet PGI'd (status CREATED) sort to the top as action items;
 *          DISPATCHED ones sort below by date. "PGI & INVOICE" on a
 *          pending row opens PgiInvoiceCreatePage for that DO.
 * Authority: Frontend
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import QuickFilterInput from "../../../../components/inputs/QuickFilterInput.jsx";
import ErpPaginationStrip from "../../../../components/ErpPaginationStrip.jsx";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpMasterListTemplate from "../../../../components/templates/ErpMasterListTemplate.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { useErpScreenHotkeys } from "../../../../hooks/useErpScreenHotkeys.js";
import { openScreen, openScreenWithContext } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import { listDeliveryOrders } from "../procurementApi.js";

const LIMIT = 100;

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
  const [companyId, setCompanyId] = useState(runtimeContext?.selectedCompanyId || "");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadTick, setReloadTick] = useState(0);

  useErpScreenHotkeys({
    refresh: { disabled: loading, perform: () => setReloadTick((tick) => tick + 1) },
  });

  useEffect(() => {
    setCompanyId(runtimeContext?.selectedCompanyId || "");
  }, [runtimeContext?.selectedCompanyId]);

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
          company_id: companyId || undefined,
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
  }, [companyId, reloadTick]);

  const companyOptions = useMemo(
    () => (runtimeContext?.availableCompanies ?? []).map((entry) => ({
      value: entry.id,
      label: entry.company_name || entry.company_code || entry.id,
    })),
    [runtimeContext?.availableCompanies]
  );

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
    openScreenWithContext(OPERATION_SCREENS.PROC_INV_PGI_CREATE.screen_code, { dcId: row.id, refreshOnReturn: true });
    navigate("/dashboard/procurement/sales-invoices/pgi/create");
  }

  function openInvoiceDetail(row) {
    if (!row.invoice_id) return;
    openScreenWithContext(OPERATION_SCREENS.PROC_INV_DETAIL.screen_code, { id: row.invoice_id, refreshOnReturn: true });
    navigate(`/dashboard/procurement/sales-invoices/${encodeURIComponent(row.invoice_id)}`);
  }

  return (
    <ErpMasterListTemplate
      eyebrow="Procurement"
      title="Delivery Order — PGI & Invoice Queue"
      actions={[
        { key: "refresh", label: loading ? "Refreshing..." : "Refresh", tone: "neutral", onClick: () => setReloadTick((tick) => tick + 1) },
        { key: "do-list", label: "All DOs", tone: "neutral", onClick: () => { openScreen(OPERATION_SCREENS.PROC_DO_LIST.screen_code); navigate("/dashboard/procurement/delivery-orders"); } },
      ]}
      notices={error ? [{ key: "do-queue-error", tone: "error", message: error }] : []}
      filterSection={{
        eyebrow: "Search And Filter",
        title: "Delivery orders awaiting PGI + Invoice (SO/STO)",
        children: (
          <div className="grid gap-3 xl:grid-cols-[220px_minmax(0,1fr)]">
            <label className="grid gap-1 text-[11px] font-medium text-slate-600">
              Company
              <select
                value={companyId}
                onChange={(event) => { setCompanyId(event.target.value); setPage(1); }}
                className="h-10 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
              >
                <option value="">ALL</option>
                {companyOptions.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
              </select>
            </label>
            <QuickFilterInput label="Search" value={search} onChange={setSearch} primaryFocus placeholder="DO number, SO/STO number, invoice number, or customer" />
          </div>
        ),
      }}
      listSection={{
        eyebrow: "DO Queue",
        title: loading ? "Loading delivery orders" : `${pageTotal} delivery order row${pageTotal === 1 ? "" : "s"}`,
        children: (
          <div className="grid gap-3">
            <ErpPaginationStrip page={page} setPage={setPage} totalPages={totalPages} startIndex={startIndex} endIndex={endIndex} totalItems={pageTotal} />
            <ErpDenseGrid
              columns={[
                { key: "dc_number", label: "DO Number", width: "140px" },
                { key: "source_display", label: "Source", width: "100px", render: (row) => (row.source_display === "SALES_ORDER" ? "Sales Order" : row.source_display === "STO" ? "STO" : "—") },
                { key: "source_document_number", label: "SO / STO Number", width: "140px", render: (row) => row.source_document_number || "—" },
                { key: "customer_display", label: "Customer / Counterparty", render: (row) => row.customer_display || "—" },
                { key: "dc_date", label: "DO Date", width: "110px" },
                {
                  key: "status",
                  label: "Status",
                  width: "130px",
                  render: (row) => <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${getStatusTone(row.status)}`}>{row.status === "CREATED" ? "PENDING PGI" : row.status}</span>,
                },
                { key: "total_value", label: "Total Value", width: "120px", render: (row) => (Number.isFinite(Number(row.total_value)) ? Number(row.total_value).toFixed(2) : "-") },
                { key: "invoice_number", label: "Invoice Number", width: "130px", render: (row) => row.invoice_number || "—" },
                { key: "invoice_date", label: "Invoice Date", width: "110px", render: (row) => row.invoice_date || "—" },
                { key: "tally_invoice_number", label: "Tally Invoice No.", width: "130px", render: (row) => row.tally_invoice_number || "—" },
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
                      PGI &amp; Invoice
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
              emptyMessage={loading ? "Loading delivery orders..." : "No delivery orders matched the current filter."}
            />
          </div>
        ),
      }}
    />
  );
}
