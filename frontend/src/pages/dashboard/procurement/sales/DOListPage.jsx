/*
 * File-Path: frontend/src/pages/dashboard/procurement/sales/DOListPage.jsx
 * Domain: PROCUREMENT / Sales
 * Purpose: §113 Stage 2 — Delivery Order list. Shared by SO and STO
 *          dispatches (dc_type SALES/STO). TX code SO03, GRP_ACL_SALES.
 * Authority: Frontend
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import QuickFilterInput from "../../../../components/inputs/QuickFilterInput.jsx";
import ErpPaginationStrip from "../../../../components/ErpPaginationStrip.jsx";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import TransactionCompanySelector from "../../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../../components/inputs/transactionCompanyRuntime.js";
import ErpMasterListTemplate from "../../../../components/templates/ErpMasterListTemplate.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { useErpScreenHotkeys } from "../../../../hooks/useErpScreenHotkeys.js";
import { openScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import { downloadCsvFile } from "../../../../shared/downloadTabularFile.js";
import { listDeliveryOrders } from "../procurementApi.js";

const LIMIT = 50;

// §133.16-A UI standard.
const DO_EXPORT_COLUMNS = [
  { key: "dc_number", label: "DO Number" },
  { key: "source_display", label: "Source" },
  { key: "source_document_number", label: "SO / STO Number" },
  { key: "customer_display", label: "Bill-To" },
  { key: "ship_to_display", label: "Ship-To" },
  { key: "dc_date", label: "DO Date" },
  { key: "vehicle_number", label: "Vehicle Number" },
  { key: "transporter_display", label: "Transporter" },
  { key: "lr_number", label: "LR Number" },
  { key: "status", label: "Status" },
  { key: "dispatch_category", label: "Dispatch Category" },
  { key: "total_qty", label: "Total Qty" },
  { key: "total_value", label: "Total Value" },
];

// Business owner ask (2026-09-04) -- this handler never had a search param
// (unlike SO01/§113.10), so this page mirrors SalesInvoiceListPage.jsx's
// already-established fetch-a-bounded-batch-then-filter-client-side pattern
// against this exact same listDeliveryOrders() call, rather than restricting
// the new autosuggest search to whatever 50 rows happen to be on the current
// server page.
const DO_FETCH_CAP = 2000;
const DO_SEARCH_COLUMN_KEYS = ["dc_number", "source_display", "source_document_number", "customer_display", "ship_to_display", "vehicle_number", "transporter_display", "lr_number", "status", "dispatch_category"];

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
  const [companyId, setCompanyId] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const effectiveCompanyId = companyId || resolveDefaultTransactionCompanyId(runtimeContext);

  // Business owner ask (2026-09-04) -- fetch a bounded larger batch once
  // (this handler has no server-side search param) and filter/paginate it
  // client-side, so the new autosuggest search covers more than one 50-row
  // server page. Company/status still narrow the fetch itself.
  const params = useMemo(
    () => ({ company_id: effectiveCompanyId || undefined, status: status || undefined, limit: DO_FETCH_CAP, offset: 0 }),
    [effectiveCompanyId, status]
  );

  const doQuery = useQuery({
    queryKey: ["procurement", "delivery-orders", params],
    queryFn: () => listDeliveryOrders(params),
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

  const filteredRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return allRows;
    return allRows.filter((row) => DO_SEARCH_COLUMN_KEYS.some((key) => String(row[key] ?? "").toLowerCase().includes(needle)));
  }, [allRows, search]);

  const total = filteredRows.length;
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));
  const startIndex = total === 0 ? 0 : (page - 1) * LIMIT + 1;
  const endIndex = total === 0 ? 0 : Math.min(page * LIMIT, total);
  const rows = useMemo(() => filteredRows.slice((page - 1) * LIMIT, page * LIMIT), [filteredRows, page]);

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

  function handleExport() {
    if (rows.length === 0) return;
    downloadCsvFile({
      fileName: `delivery_orders_${effectiveCompanyId || "all"}_page${page}.csv`,
      columns: DO_EXPORT_COLUMNS,
      rows,
    });
  }

  return (
    <ErpMasterListTemplate
      eyebrow="Procurement"
      title="Delivery Order"
      actions={[
        { key: "refresh", label: loading ? "Refreshing..." : "Refresh", tone: "neutral", onClick: () => doQuery.refetch() },
        { key: "create", label: "Create DO", tone: "primary", onClick: openCreateDO },
        { key: "export", label: "Export Excel", tone: "neutral", onClick: handleExport, disabled: rows.length === 0 },
      ]}
      notices={doQuery.error ? [{ key: "do-list-error", tone: "error", message: doQuery.error instanceof Error ? doQuery.error.message : "PROCUREMENT_DO_LIST_FAILED" }] : []}
      filterSection={{
        eyebrow: "Search And Filter",
        title: "Delivery orders dispatched from Sales Order or STO (§113 Stage 2)",
        children: (
          <div className="grid gap-3 md:grid-cols-3">
            <TransactionCompanySelector
              runtimeContext={runtimeContext}
              value={companyId}
              onChange={(value) => { setCompanyId(value); setPage(1); }}
              label="Company"
              hint=""
            />
            <label className="grid gap-1 text-[11px] font-medium text-slate-600">
              Status
              <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} className="h-10 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500">
                <option value="">ALL</option>
                {["CREATED", "DISPATCHED", "CLOSED", "CANCELLED"].map((entry) => <option key={entry} value={entry}>{entry}</option>)}
              </select>
            </label>
            <QuickFilterInput
              label="Search"
              value={search}
              onChange={(value) => { setSearch(value); setPage(1); }}
              placeholder="DO number, SO/STO number, customer, status..."
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
        title: loading ? "Loading delivery orders" : `${total} delivery order row${total === 1 ? "" : "s"}`,
        children: (
          <div className="grid gap-3">
            <ErpPaginationStrip page={page} setPage={setPage} totalPages={totalPages} startIndex={startIndex} endIndex={endIndex} totalItems={total} />
            {!effectiveCompanyId ? (
              <p className="text-slate-400 text-sm py-6 text-center">Select a company to view delivery orders.</p>
            ) : (
              <ErpDenseGrid
                cellNavigate
                columns={[
                  { key: "dc_number", label: "DO Number", width: "140px" },
                  { key: "source_display", label: "Source", width: "100px", render: (row) => (row.source_display === "SALES_ORDER" ? "Sales Order" : row.source_display === "STO" ? "STO" : "—") },
                  { key: "source_document_number", label: "SO / STO Number", width: "140px", render: (row) => row.source_document_number || "—" },
                  { key: "customer_display", label: "Bill-To", render: (row) => row.customer_display || "—" },
                  { key: "ship_to_display", label: "Ship-To", render: (row) => row.ship_to_display || "—" },
                  { key: "dc_date", label: "DO Date", width: "110px" },
                  { key: "vehicle_number", label: "Vehicle Number", width: "130px", render: (row) => row.vehicle_number || "—" },
                  { key: "transporter_display", label: "Transporter", render: (row) => row.transporter_display || "—" },
                  { key: "lr_number", label: "LR Number", width: "120px", render: (row) => row.lr_number || "—" },
                  {
                    key: "status",
                    label: "Status",
                    width: "130px",
                    render: (row) => <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${doStatusTone(row.status)}`}>{row.status}</span>,
                  },
                  { key: "dispatch_category", label: "Dispatch Category", width: "140px", render: (row) => row.dispatch_category || "—" },
                  { key: "total_qty", label: "Total Qty", width: "100px", align: "right", render: (row) => Number(row.total_qty ?? 0).toFixed(2) },
                  { key: "total_value", label: "Total Value", width: "120px", render: (row) => (Number.isFinite(Number(row.total_value)) ? Number(row.total_value).toFixed(2) : "-") },
                ]}
                rows={rows}
                rowKey={(row) => row.id}
                onRowActivate={openDODetail}
                getRowProps={(row) => ({ onDoubleClick: () => openDODetail(row), className: "cursor-pointer hover:bg-sky-50" })}
                emptyMessage={loading ? "Loading delivery orders..." : "No delivery orders matched the current filter."}
              />
            )}
          </div>
        ),
      }}
    />
  );
}
